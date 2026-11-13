//! The four refusals the port must keep (finish too late, cancel too early, wrong secret, double
//! spend) plus the two happy paths, run against the real execution engine with a controlled block time.
use casper_engine_test_support::{
    ExecuteRequestBuilder, LmdbWasmTestBuilder, TransferRequestBuilder, DEFAULT_ACCOUNT_ADDR,
    LOCAL_GENESIS_REQUEST,
};
use casper_types::{
    account::AccountHash, contracts::ContractHash, runtime_args, Key, StoredValue, URef, U512,
};
use sha2::{Digest, Sha256};

const CONTRACT_WASM: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../build/vienna_escrow.wasm");
const LOCK_WASM: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../build/vienna_lock.wasm");

const CANCEL_AFTER_MS: u64 = 100_000;
const TRANCHE: u64 = 10_000_000_000; // 10 CSPR

type Record = ((Key, Key, U512), (u64, [u8; 32], u8));

struct World {
    builder: LmdbWasmTestBuilder,
    contract: ContractHash,
    renter: AccountHash,   // the default genesis account
    lender: AccountHash,   // a fresh account, created by the first payment it receives
    stranger: AccountHash, // a funded third party: the "anyone" of finish / cancel
    preimage: [u8; 32],
    condition: [u8; 32],
}

fn world() -> World {
    let mut builder = LmdbWasmTestBuilder::default();
    builder.run_genesis(LOCAL_GENESIS_REQUEST.clone());
    let renter = *DEFAULT_ACCOUNT_ADDR;
    let lender = AccountHash::new([7u8; 32]);
    let stranger = AccountHash::new([9u8; 32]);
    let fund = TransferRequestBuilder::new(U512::from(1_000_000_000_000u64), stranger).with_initiator(renter).build();
    builder.transfer_and_commit(fund).expect_success();

    builder.exec(ExecuteRequestBuilder::standard(renter, CONTRACT_WASM, runtime_args! {}).build()).expect_success().commit();
    let contract = builder
        .get_named_keys_by_account_hash(renter)
        .get("vienna_escrow")
        .and_then(|k| k.into_hash_addr())
        .map(ContractHash::new)
        .expect("contract hash under the installer's named key");

    let preimage = [42u8; 32];
    let condition: [u8; 32] = Sha256::digest(preimage).into();
    World { builder, contract, renter, lender, stranger, preimage, condition }
}

impl World {
    fn lock(&mut self, id: &str, amount: u64) -> &mut LmdbWasmTestBuilder {
        let req = ExecuteRequestBuilder::standard(
            self.renter,
            LOCK_WASM,
            runtime_args! {
                "contract" => Key::Hash(self.contract.value()), "id" => id, "lender" => Key::Account(self.lender),
                "cancel_after_ms" => CANCEL_AFTER_MS, "condition" => self.condition, "amount" => U512::from(amount),
            },
        )
        .with_block_time(1_000)
        .build();
        self.builder.exec(req)
    }

    fn finish(&mut self, caller: AccountHash, id: &str, preimage: [u8; 32], at_ms: u64) -> &mut LmdbWasmTestBuilder {
        let req = ExecuteRequestBuilder::contract_call_by_hash(
            caller,
            self.contract.value().into(),
            "finish",
            runtime_args! { "renter" => Key::Account(self.renter), "id" => id, "preimage" => preimage },
        )
        .with_block_time(at_ms)
        .build();
        self.builder.exec(req)
    }

    fn cancel(&mut self, caller: AccountHash, id: &str, at_ms: u64) -> &mut LmdbWasmTestBuilder {
        let req = ExecuteRequestBuilder::contract_call_by_hash(
            caller,
            self.contract.value().into(),
            "cancel",
            runtime_args! { "renter" => Key::Account(self.renter), "id" => id },
        )
        .with_block_time(at_ms)
        .build();
        self.builder.exec(req)
    }

    fn record(&self, id: &str) -> Record {
        let keys = self.builder.get_named_keys_for_contract(self.contract.value().into());
        let dict: URef = keys.get("tranches").and_then(|k| k.into_uref()).expect("tranches dictionary");
        let key = format!("{}:{}", hex(self.renter.as_bytes()), id);
        match self.builder.query_dictionary_item(None, dict, &key).expect("record") {
            StoredValue::CLValue(v) => v.into_t().expect("record type"),
            other => panic!("unexpected stored value {other:?}"),
        }
    }

    fn purse_balance(&self, id: &str) -> U512 {
        let keys = self.builder.get_named_keys_for_contract(self.contract.value().into());
        let key = format!("p:{}:{}", hex(self.renter.as_bytes()), id);
        let purse = keys.get(&key).and_then(|k| k.into_uref()).expect("tranche purse");
        self.builder.get_purse_balance(purse)
    }

    fn balance(&self, account: AccountHash) -> U512 {
        // an account that has never received anything does not exist yet
        if self.builder.query(None, Key::Account(account), &[]).is_err() {
            return U512::zero();
        }
        let a = self.builder.get_account(account).expect("account");
        self.builder.get_purse_balance(a.main_purse())
    }

    fn user_error(&self) -> String {
        self.builder.get_error_message().unwrap_or_default()
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[test]
fn install_is_locked_and_keeps_no_access_key() {
    let w = world();
    let keys = w.builder.get_named_keys_by_account_hash(w.renter);
    assert!(keys.get("vienna_escrow").is_some());
    assert!(keys.iter().all(|(_, k)| k.into_uref().is_none()), "no access URef left in the installer's named keys: {keys:?}");
    let contract_keys = w.builder.get_named_keys_for_contract(w.contract.value().into());
    assert!(contract_keys.get("tranches").is_some() && contract_keys.get("index").is_some());
}

#[test]
fn lock_then_finish_with_the_secret_pays_the_lender() {
    let mut w = world();
    let before = w.balance(w.renter);
    w.lock("t/0", TRANCHE).expect_success().commit();
    assert_eq!(w.purse_balance("t/0"), U512::from(TRANCHE));
    assert_eq!(w.record("t/0").1 .2, 1, "locked");
    assert!(before - w.balance(w.renter) >= U512::from(TRANCHE), "renter paid the tranche (plus gas)");

    let pre = w.preimage;
    w.finish(w.stranger, "t/0", pre, CANCEL_AFTER_MS - 1).expect_success().commit();
    assert_eq!(w.balance(w.lender), U512::from(TRANCHE), "the lender, who never signed anything, got exactly the tranche");
    assert_eq!(w.purse_balance("t/0"), U512::zero());
    assert_eq!(w.record("t/0").1 .2, 2, "finished");
}

#[test]
fn lock_then_cancel_after_the_deadline_refunds_the_renter() {
    let mut w = world();
    w.lock("t/1", TRANCHE).expect_success().commit();
    let before = w.balance(w.renter);
    w.cancel(w.stranger, "t/1", CANCEL_AFTER_MS).expect_success().commit();
    assert_eq!(w.balance(w.renter), before + U512::from(TRANCHE), "refund paid by a stranger, the renter pays no gas");
    assert_eq!(w.balance(w.lender), U512::zero());
    assert_eq!(w.record("t/1").1 .2, 3, "cancelled");
}

#[test]
fn finish_too_late_is_refused() {
    let mut w = world();
    w.lock("t/2", TRANCHE).expect_success().commit();
    let pre = w.preimage;
    w.finish(w.stranger, "t/2", pre, CANCEL_AFTER_MS).expect_failure();
    assert!(w.user_error().contains("User error: 6"), "TooLate, got: {}", w.user_error());
    w.builder.commit();
    assert_eq!(w.purse_balance("t/2"), U512::from(TRANCHE));
}

#[test]
fn cancel_too_early_is_refused() {
    let mut w = world();
    w.lock("t/3", TRANCHE).expect_success().commit();
    w.cancel(w.stranger, "t/3", CANCEL_AFTER_MS - 1).expect_failure();
    assert!(w.user_error().contains("User error: 7"), "TooEarly, got: {}", w.user_error());
    w.builder.commit();
    assert_eq!(w.purse_balance("t/3"), U512::from(TRANCHE));
}

#[test]
fn wrong_secret_is_refused() {
    let mut w = world();
    w.lock("t/4", TRANCHE).expect_success().commit();
    w.finish(w.stranger, "t/4", [1u8; 32], 5_000).expect_failure();
    assert!(w.user_error().contains("User error: 5"), "WrongSecret, got: {}", w.user_error());
    w.builder.commit();
    assert_eq!(w.purse_balance("t/4"), U512::from(TRANCHE));
    assert_eq!(w.balance(w.lender), U512::zero());
}

#[test]
fn double_spend_is_refused() {
    let mut w = world();
    w.lock("t/5", TRANCHE).expect_success().commit();
    let pre = w.preimage;
    w.finish(w.stranger, "t/5", pre, 5_000).expect_success().commit();
    // a second finish, and a cancel after the deadline: the tranche is already paid.
    w.finish(w.stranger, "t/5", pre, 6_000).expect_failure();
    assert!(w.user_error().contains("User error: 3"), "BadStatus, got: {}", w.user_error());
    w.builder.commit();
    w.cancel(w.stranger, "t/5", CANCEL_AFTER_MS).expect_failure();
    assert!(w.user_error().contains("User error: 3"), "BadStatus, got: {}", w.user_error());
    w.builder.commit();
    assert_eq!(w.balance(w.lender), U512::from(TRANCHE));
    // and the same id cannot be locked twice by the same renter
    w.lock("t/5", TRANCHE).expect_failure();
    assert!(w.user_error().contains("User error: 1"), "AlreadyExists, got: {}", w.user_error());
}
