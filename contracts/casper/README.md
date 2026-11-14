# vienna on Casper: the escrow is a contract

Casper has no native escrow, so the deposit is held by `vienna_escrow`, a contract written for this
port. What it promises, and how to check it, is in the main README ("Measured on Casper testnet") and
in `docs/PORTING.md` §8. This folder:

```
vienna_escrow/contract/   the contract: init, lock, confirm, finish, cancel (Rust, no_std, VM1)
vienna_escrow/session/    vienna_lock: the renter's session code (lock → fund the purse → confirm, one deploy)
vienna_escrow/tests/      the four refusals + two happy paths on the real execution engine (cargo test)
build/                    the two wasm files actually installed / sent, with SHA256SUMS
build.sh                  cargo build → wasm-opt (lower post-MVP ops) → wasm-strip → wasm-validate
deployment.json           where the contract is on testnet: hash, install deploy, cost, commit, wasm hashes
```

## Build and test

```
./build.sh                                          # needs rustup target wasm32-unknown-unknown, binaryen, wabt
(cd vienna_escrow && cargo test -p vienna_escrow_tests)
```

`rustc` ≥ 1.82 emits bulk-memory and sign-extension instructions that `casper-wasmi` refuses
("Bulk memory operations are not supported"), including inside the precompiled `core`; `build.sh`
lowers them with binaryen and validates the result with every post-MVP feature disabled. The crate
uses `casper-contract` without its default `no-std-helpers` feature (which needs nightly) and brings
its own allocator and panic handler.

## Install (once, from a tagged commit)

```
VIENNA_CHAIN=casper node ../../bin/casper-install.mjs   # paid by the oracle key, writes deployment.json
```

`call()` creates a **locked** package (`storage::new_locked_contract`) and stores neither the package
hash nor the access URef anywhere: no version can be added, enabled or disabled, by anyone, ever. The
only named key left on the installer is the contract hash. `init` runs in the same deploy and creates
the two dictionaries in the contract's own context, so the installer never holds their write rights.

## One tranche on chain

| what | where | who can move it |
|---|---|---|
| record `((renter, lender, amount), (cancel_after_ms, sha256 condition, status))` | dictionary `tranches[<renter hash>:<id>]` | the contract only |
| the money | a purse created by the contract, named key `p:<renter hash>:<id>` | the contract only: `finish` → lender, `cancel` → renter |
| the renter's list of ids | dictionary `index[<renter hash>]` (count) and `index[<renter hash>:<n>]` | the contract only |

Status: 0 pending (purse created, not yet confirmed), 1 locked, 2 finished, 3 cancelled.
`finish` and `cancel` have no caller check at all. `lock` returns the new purse with **ADD rights
only**, which is how the renter's session funds it without ever being able to take from it.

Error codes (`User error: n`): 1 AlreadyExists · 2 NotFound · 3 BadStatus · 4 NotFunded · 5 WrongSecret ·
6 TooLate · 7 TooEarly · 8 BadAmount · 9 BadId · 10 BadKey · 11 AlreadyInitialised.

## Calling it from JavaScript

`casper-js-sdk` 5.3.1 passes the contract hash into `StoredContractByHash.hash` as given; the node
accepts only the bare 64-hex form there (what `casper-client` emits) and answers `Invalid params` to
`hash-…`. The execution result's `cost` is the payment limit; the charge on this testnet is
`limit − 75 % × (limit − consumed)`. Both are handled in `src/ledger/casper.mjs`.
