//! Session code run by the renter to lock one tranche in one deploy:
//! open the record (the contract creates the purse and returns it with ADD rights only),
//! move `amount` from the renter's main purse into it, confirm.
//! If any step fails the whole deploy reverts and nothing is moved.
#![no_std]
#![no_main]

extern crate alloc;

use alloc::string::String;
use casper_contract::{
    contract_api::{account, runtime, system},
    unwrap_or_revert::UnwrapOrRevert,
};
use casper_types::{contracts::ContractHash, runtime_args, ApiError, Key, URef, U512};

#[no_mangle]
pub extern "C" fn call() {
    let contract: Key = runtime::get_named_arg("contract");
    let contract = ContractHash::new(contract.into_hash_addr().unwrap_or_revert_with(ApiError::User(10)));
    let id: String = runtime::get_named_arg("id");
    let lender: Key = runtime::get_named_arg("lender");
    let cancel_after_ms: u64 = runtime::get_named_arg("cancel_after_ms");
    let condition: [u8; 32] = runtime::get_named_arg("condition");
    let amount: U512 = runtime::get_named_arg("amount");

    let purse: URef = runtime::call_contract(
        contract,
        "lock",
        runtime_args! {
            "id" => id.clone(), "lender" => lender, "cancel_after_ms" => cancel_after_ms,
            "condition" => condition, "amount" => amount,
        },
    );
    system::transfer_from_purse_to_purse(account::get_main_purse(), purse, amount, None).unwrap_or_revert();
    runtime::call_contract::<()>(contract, "confirm", runtime_args! { "id" => id });
}

// Stable-toolchain no_std runtime: casper-contract's own handlers need nightly features.
#[global_allocator]
static ALLOC: wee_alloc::WeeAlloc = wee_alloc::WeeAlloc::INIT;

#[panic_handler]
fn panic(_info: &core::panic::PanicInfo) -> ! {
    core::arch::wasm32::unreachable()
}

