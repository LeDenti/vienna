//! vienna on Casper: the deposit of a rental, one purse per tranche.
//!
//! Casper has no native escrow, so this contract is the escrow. It is installed as a *locked*
//! package (no upgrade possible, no access key kept) and has no admin, no owner, no pause switch.
//!
//! One tranche = one record under `tranches[<renter account hash hex>:<id>]` plus one purse under the
//! named key `p:<same key>`, created by the contract itself (`system::create_purse`) so that only
//! this code can move it.
//!
//! - `lock(id, lender, cancel_after_ms, condition, amount) -> URef`: called by the renter (through the
//!   `vienna_lock` session). Creates the record and the purse, returns the purse with ADD rights only,
//!   so the caller can fund it and nothing else.
//! - `confirm(id)`: checks the purse holds at least `amount`, marks the tranche locked.
//! - `finish(renter, id, preimage)`: **anyone**. sha256(preimage) must equal `condition` and the block
//!   time must be strictly before `cancel_after_ms`. Pays `amount` to the lender.
//! - `cancel(renter, id)`: **anyone**. Block time must be at or after `cancel_after_ms`. Pays the purse
//!   back to the renter. The oracle holding the secret cannot block this: it needs no secret.
//!
//! Status: 0 pending (purse created, not confirmed), 1 locked, 2 finished (lender paid), 3 cancelled
//! (renter refunded). Effects are written before the transfer in `finish` and `cancel`.
#![no_std]
#![no_main]

extern crate alloc;

use alloc::{format, string::String, vec, vec::Vec};
use casper_contract::{
    contract_api::{runtime, storage, system},
    unwrap_or_revert::UnwrapOrRevert,
};
use casper_types::{
    account::AccountHash, addressable_entity::EntityEntryPoint, runtime_args, ApiError, CLType,
    CLValue, EntryPointAccess, EntryPointPayment, EntryPointType, EntryPoints, Key, Parameter,
    URef, U512,
};
use sha2::{Digest, Sha256};

const DICT_TRANCHES: &str = "tranches";
const DICT_INDEX: &str = "index";
const KEY_CONTRACT: &str = "vienna_escrow";

const ARG_ID: &str = "id";
const ARG_RENTER: &str = "renter";
const ARG_LENDER: &str = "lender";
const ARG_CANCEL_AFTER: &str = "cancel_after_ms";
const ARG_CONDITION: &str = "condition";
const ARG_AMOUNT: &str = "amount";
const ARG_PREIMAGE: &str = "preimage";

pub const STATUS_PENDING: u8 = 0;
pub const STATUS_LOCKED: u8 = 1;
pub const STATUS_FINISHED: u8 = 2;
pub const STATUS_CANCELLED: u8 = 3;

const MAX_ID_LEN: usize = 60;

/// `((renter, lender, amount), (cancel_after_ms, condition, status))`: plain CL tuples so that any
/// client can read a tranche with `state_get_dictionary_item` and no custom decoder.
pub type Record = ((Key, Key, U512), (u64, [u8; 32], u8));

#[repr(u16)]
pub enum Error {
    AlreadyExists = 1,
    NotFound = 2,
    BadStatus = 3,
    NotFunded = 4,
    WrongSecret = 5,
    TooLate = 6,
    TooEarly = 7,
    BadAmount = 8,
    BadId = 9,
    BadKey = 10,
    AlreadyInitialised = 11,
}

impl From<Error> for ApiError {
    fn from(e: Error) -> ApiError {
        ApiError::User(e as u16)
    }
}

fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push(DIGITS[(b >> 4) as usize] as char);
        s.push(DIGITS[(b & 0x0f) as usize] as char);
    }
    s
}

fn tranche_key(renter: AccountHash, id: &str) -> String {
    format!("{}:{}", hex(renter.as_bytes()), id)
}

fn dictionary(name: &str) -> URef {
    runtime::get_key(name)
        .unwrap_or_revert_with(Error::NotFound)
        .into_uref()
        .unwrap_or_revert_with(Error::NotFound)
}

fn read_record(key: &str) -> Option<Record> {
    storage::dictionary_get(dictionary(DICT_TRANCHES), key).unwrap_or_revert()
}

fn write_record(key: &str, record: Record) {
    storage::dictionary_put(dictionary(DICT_TRANCHES), key, record)
}

fn purse_of(key: &str) -> URef {
    runtime::get_key(&format!("p:{}", key))
        .unwrap_or_revert_with(Error::NotFound)
        .into_uref()
        .unwrap_or_revert_with(Error::NotFound)
}

fn arg_id() -> String {
    let id: String = runtime::get_named_arg(ARG_ID);
    if id.is_empty() || id.len() > MAX_ID_LEN || !id.bytes().all(|b| b.is_ascii_graphic() && b != b':') {
        runtime::revert(Error::BadId);
    }
    id
}

fn arg_account(name: &str) -> (Key, AccountHash) {
    let key: Key = runtime::get_named_arg(name);
    let hash = key.into_account().unwrap_or_revert_with(Error::BadKey);
    (key, hash)
}

fn now_ms() -> u64 {
    runtime::get_blocktime().into()
}

/// One-off, called by the installer inside the install deploy: the dictionaries must be created in
/// the contract's own context so that only the contract holds their write rights.
#[no_mangle]
pub extern "C" fn init() {
    if runtime::has_key(DICT_TRANCHES) {
        runtime::revert(Error::AlreadyInitialised);
    }
    storage::new_dictionary(DICT_TRANCHES).unwrap_or_revert();
    storage::new_dictionary(DICT_INDEX).unwrap_or_revert();
}

#[no_mangle]
pub extern "C" fn lock() {
    let id = arg_id();
    let (lender, _) = arg_account(ARG_LENDER);
    let cancel_after: u64 = runtime::get_named_arg(ARG_CANCEL_AFTER);
    let condition: [u8; 32] = runtime::get_named_arg(ARG_CONDITION);
    let amount: U512 = runtime::get_named_arg(ARG_AMOUNT);
    if amount.is_zero() {
        runtime::revert(Error::BadAmount);
    }
    let renter = runtime::get_caller();
    let key = tranche_key(renter, &id);
    if read_record(&key).is_some() {
        runtime::revert(Error::AlreadyExists);
    }

    let purse = system::create_purse();
    runtime::put_key(&format!("p:{}", key), purse.into());
    write_record(&key, ((Key::Account(renter), lender, amount), (cancel_after, condition, STATUS_PENDING)));

    // Per-renter index, so a client can list a renter's tranches without knowing their ids.
    let index = dictionary(DICT_INDEX);
    let renter_hex = hex(renter.as_bytes());
    let n: u32 = storage::dictionary_get(index, &renter_hex).unwrap_or_revert().unwrap_or(0);
    storage::dictionary_put(index, &format!("{}:{}", renter_hex, n), id);
    storage::dictionary_put(index, &renter_hex, n + 1);

    runtime::ret(CLValue::from_t(purse.into_add()).unwrap_or_revert());
}

#[no_mangle]
pub extern "C" fn confirm() {
    let id = arg_id();
    let key = tranche_key(runtime::get_caller(), &id);
    let mut record = read_record(&key).unwrap_or_revert_with(Error::NotFound);
    if record.1 .2 != STATUS_PENDING {
        runtime::revert(Error::BadStatus);
    }
    let balance = system::get_purse_balance(purse_of(&key)).unwrap_or_revert();
    if balance < record.0 .2 {
        runtime::revert(Error::NotFunded);
    }
    record.1 .2 = STATUS_LOCKED;
    write_record(&key, record);
}

#[no_mangle]
pub extern "C" fn finish() {
    let (_, renter) = arg_account(ARG_RENTER);
    let id = arg_id();
    let preimage: [u8; 32] = runtime::get_named_arg(ARG_PREIMAGE);
    let key = tranche_key(renter, &id);
    let mut record = read_record(&key).unwrap_or_revert_with(Error::NotFound);
    if record.1 .2 != STATUS_LOCKED {
        runtime::revert(Error::BadStatus);
    }
    if Sha256::digest(preimage).as_slice() != record.1 .1 {
        runtime::revert(Error::WrongSecret);
    }
    if now_ms() >= record.1 .0 {
        runtime::revert(Error::TooLate);
    }
    let lender = record.0 .1.into_account().unwrap_or_revert_with(Error::BadKey);
    let amount = record.0 .2;
    record.1 .2 = STATUS_FINISHED;
    write_record(&key, record);
    system::transfer_from_purse_to_account(purse_of(&key), lender, amount, None).unwrap_or_revert();
}

#[no_mangle]
pub extern "C" fn cancel() {
    let (_, renter) = arg_account(ARG_RENTER);
    let id = arg_id();
    let key = tranche_key(renter, &id);
    let mut record = read_record(&key).unwrap_or_revert_with(Error::NotFound);
    if record.1 .2 != STATUS_PENDING && record.1 .2 != STATUS_LOCKED {
        runtime::revert(Error::BadStatus);
    }
    if now_ms() < record.1 .0 {
        runtime::revert(Error::TooEarly);
    }
    record.1 .2 = STATUS_CANCELLED;
    write_record(&key, record);
    let purse = purse_of(&key);
    let balance = system::get_purse_balance(purse).unwrap_or_revert();
    if !balance.is_zero() {
        system::transfer_from_purse_to_account(purse, renter, balance, None).unwrap_or_revert();
    }
}

fn entry_point(name: &str, args: Vec<Parameter>, ret: CLType) -> EntityEntryPoint {
    EntityEntryPoint::new(name, args, ret, EntryPointAccess::Public, EntryPointType::Called, EntryPointPayment::Caller)
}

/// Install: a locked package (no upgrade), no access key kept anywhere, `init` run in the same deploy.
#[no_mangle]
pub extern "C" fn call() {
    let mut entry_points = EntryPoints::new();
    entry_points.add_entry_point(entry_point("init", vec![], CLType::Unit));
    entry_points.add_entry_point(entry_point(
        "lock",
        vec![
            Parameter::new(ARG_ID, CLType::String),
            Parameter::new(ARG_LENDER, CLType::Key),
            Parameter::new(ARG_CANCEL_AFTER, CLType::U64),
            Parameter::new(ARG_CONDITION, CLType::ByteArray(32)),
            Parameter::new(ARG_AMOUNT, CLType::U512),
        ],
        CLType::URef,
    ));
    entry_points.add_entry_point(entry_point("confirm", vec![Parameter::new(ARG_ID, CLType::String)], CLType::Unit));
    entry_points.add_entry_point(entry_point(
        "finish",
        vec![
            Parameter::new(ARG_RENTER, CLType::Key),
            Parameter::new(ARG_ID, CLType::String),
            Parameter::new(ARG_PREIMAGE, CLType::ByteArray(32)),
        ],
        CLType::Unit,
    ));
    entry_points.add_entry_point(entry_point(
        "cancel",
        vec![Parameter::new(ARG_RENTER, CLType::Key), Parameter::new(ARG_ID, CLType::String)],
        CLType::Unit,
    ));

    // hash_name = None and uref_name = None: neither the package hash nor the access URef is stored in
    // the installer's named keys. The package is locked, so no version can ever be added or disabled.
    let (contract_hash, _version) = storage::new_locked_contract(entry_points, None, None, None, None);
    runtime::put_key(KEY_CONTRACT, Key::Hash(contract_hash.value()));
    runtime::call_contract::<()>(contract_hash, "init", runtime_args! {});
}

// Stable-toolchain no_std runtime: casper-contract's own handlers need nightly features.
#[global_allocator]
static ALLOC: wee_alloc::WeeAlloc = wee_alloc::WeeAlloc::INIT;

#[panic_handler]
fn panic(_info: &core::panic::PanicInfo) -> ! {
    core::arch::wasm32::unreachable()
}

