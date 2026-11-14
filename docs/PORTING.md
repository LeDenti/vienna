# Porting vienna to other ledgers

vienna was built on the XRP Ledger because its escrows are native: a
conditional, time-boxed deposit needs no contract, and the automatic refund is
enforced by the ledger itself. This page is the plan for running the same
deposit on five ledgers that do not have native escrows: Solana, NEAR,
Ethereum, Bitcoin and Casper. It is written before the work, so that the
result can be checked against it, and it says first why none of them is built
yet.

## 0. Why only XRPL today

- **The hackathon lasts 24 hours and the jury scores one feature running
  live.** One deposit measured three times on a real testnet, with every hash
  in the README, is worth more than five half-measured ones. The ports are
  listed below with the same "done when" bar, and none is announced before it
  passes it.
- **The pitch is the native escrow.** On XRPL nobody wrote the code that holds
  the money: the ledger did. Every other ledger here holds the deposit in a
  program somebody wrote and somebody can upgrade. That is a different promise
  to the renter, and it has to be stated per ledger, not hidden behind a
  "multi-chain" badge.
- **Each port is measured, not assumed.** Three real runs, balances before and
  after, explorer links, gas or fees actually paid. That is 3 to 6 hours per
  ledger (§4 to §8), after the submission.
- **Two of the five cannot keep every rule.** Bitcoin has no way to force the
  destination of a payment without a signature, so "anyone can finish, anyone
  can refund" becomes "the lender finishes, the renter refunds" (§7). The
  plan says where a port bends a rule rather than pretending it does not.
- This section was written before any port existed. Casper has since been
  built on its branch (§8); the bar above did not move, and the README lists
  it only with its three measured runs.

## 1. What does not change

Everything that decides *how much* is kept and *who gets it* is independent of
the ledger:

| Part | File | Status |
|---|---|---|
| Rules engine `settle()` | `src/rules.mjs` | unchanged |
| The 27-case file and its replay test | `cases/`, `test/cases.test.mjs` | unchanged, must stay green on every port |
| Oracle: secrets, k reveals per verdict, never blocks a refund | `src/oracle.mjs` | unchanged except the secret format (see §3) |
| CLI and dashboard | `bin/`, `web/` | unchanged, a `--chain` flag added |

Only the ledger adapter changes. Its contract is five functions, and every
port must keep their semantics exactly:

| Function | Semantics every port must keep |
|---|---|
| `lockTranches(renter, lender, trancheAmount, conditions[], cancelAfter)` | one escrow per tranche, native coin only, hash + cancel-after on each |
| `finishTranches(submitter, owner, tranches[])` | **anyone** holding the secret can finish; funds go to the lender; refused once cancel-after has passed |
| `cancelTranches(submitter, owner, ids[])` | **anyone** can cancel once cancel-after has passed; funds go back to the renter; refused before |
| `openEscrows(address)` | list what is still locked, so the dashboard and the measures can prove the end state |
| `waitPast(time)` | wait on the ledger's own clock, not the machine's |

No partial amounts, no admin key that could move a tranche, no pause switch.
If a chain cannot give one of these, the port is not done and the README says
which line is missing.

## 2. What changes: the trust model, said plainly

On XRPL the deposit is held by the ledger. On Solana, NEAR and Casper it is
held by a **program**. The renter then trusts that program's code and whoever
can upgrade it. Each port must therefore:

- deploy from a tagged commit of the program source, with the build hash in the README;
- name the upgrade authority (or state that it was revoked / the contract is immutable);
- keep the per-tranche escrow as a separate account or record, so one tranche cannot touch another;
- keep *finish* and *cancel* permissionless (no `only_owner`), exactly like `EscrowFinish` / `EscrowCancel`.

The measured demo must show the three runs (`late`, `clean`, `contested`) with
explorer links, like the XRPL table in the README.

## 3. Secrets and conditions

XRPL wants a PREIMAGE-SHA-256 crypto-condition (DER-encoded, `src/condition.mjs`).
The other three only need the sha256 digest of a 32-byte secret. The oracle keeps
storing `{condition, fulfillment, preimage}`; the adapters pick what they need:

| Ledger | What is stored on-chain | What *finish* carries |
|---|---|---|
| XRPL | DER condition | DER fulfillment |
| Solana | `[u8; 32]` = sha256(preimage) | raw 32-byte preimage |
| NEAR | sha256 hex (64 chars) | preimage as hex |
| Ethereum | `bytes32` = sha256(preimage) | `bytes32` preimage |
| Bitcoin | sha256 digest inside the script | preimage pushed in the witness |
| Casper | 32-byte sha256 | raw preimage |

`test/condition.test.mjs` gets one case per ledger: the digest the adapter
submits must equal sha256 of the preimage the oracle will reveal.

## 4. Solana (first)

**Starting point.** The author's `dareskro_escrow` program is already on devnet
(`6NoVNiHvEsagkYYobHjrwQgkqL5xHp5zGStZK4YtdPSu`, Anchor, MIT) with exactly the
instructions needed: `create(id, destination, amount, finish_after,
cancel_after, condition: Option<[u8;32]>, memos)`, `finish(fulfillment)`,
`cancel()`, `close()`. `finish` is refused after `cancel_after`, `cancel` is
refused before it, both are permissionless, the lamports sit in the escrow
PDA itself. Prior work, disclosed as such; vienna adds no instruction to it.

**Work.**
1. `src/ledger/solana.mjs`: the five functions above on top of
   `@coral-xyz/anchor` + `@solana/web3.js`, devnet. One `create` per tranche
   with `id = tranche index`, `destination = lender`, `condition = sha256(preimage)`,
   `cancel_after = unix seconds`, memo `vienna/deposit:<agreement id>`.
   Batch the N creates in one transaction when they fit (5 tranches fit).
2. `finishTranches`: one `finish(preimage)` per tranche to pay, signed by the
   oracle's wallet (any wallet works; the oracle pays the fee).
3. `cancelTranches`: `cancel()` per untouched tranche after `cancel_after`,
   then `close()` to return the rent to the renter.
4. `waitPast`: poll `getBlockTime(slot)` of the latest finalized slot.
5. Wallets: three devnet keypairs under `state/demo.solana.wallets.json`
   (git-ignored), funded once by `solana airdrop` or faucet.solana.com.
6. Fee: the program charges a per-act fee held by a `FeeConfig` account
   (devnet: 0 bps + 0.0005 SOL floor). The README states it; the deposit
   amount itself is never touched.
7. Measures: `measures/solana-<id>.json` with signatures, explorer links
   `https://explorer.solana.com/tx/<sig>?cluster=devnet`, balances before/after.

**Done when:** `npm test` green (28 + the new condition case), three measured
runs, README section "Measured on Solana devnet" with the tranche table, and
the limits paragraph (program-held funds, upgrade authority = the author's
devnet key, not revoked).

**Estimate:** 3 to 4 hours, the program being already deployed.

## 5. NEAR (second)

**Starting point.** The author's `dareskro-v2.testnet` contract (Rust,
`near-sdk`) has `create(destination, finish_after, cancel_after, condition:
Option<sha256 hex>, memos)` payable with the attached deposit, `create_batch`,
`finish(id, fulfillment)` and `cancel(id)`; times are `env::block_timestamp()`
nanoseconds. Same semantics as above.

**Work.**
1. `src/ledger/near.mjs` on `near-api-js`, testnet. `lockTranches` =
   one `create_batch` call with N items and the full deposit attached (the
   contract splits it per item), or N `create` calls if the batch is refused.
2. `finish(id, preimageHex)` from the oracle's account; `cancel(id)` from
   anyone after `cancel_after`.
3. `waitPast`: poll the latest block's timestamp.
4. Accounts: three testnet sub-accounts created with `near account create-account`
   funded by the faucet; keys in `state/demo.near.wallets.json` (git-ignored).
5. Gas: each call needs ~30 TGas; the adapter attaches it and the README
   reports the actual gas burnt per act from the receipts.
6. Measures: `measures/near-<id>.json`, links
   `https://testnet.nearblocks.io/txns/<hash>`.

**Done when:** same criteria as Solana. Limits to state: contract has an
`admin` and a `migrate` method (upgradeable by the author's key).

**Estimate:** 3 to 4 hours.

## 6. Ethereum (third)

**Starting point.** No prior contract, but the shortest path of the three
written from scratch: Solidity, Sepolia, and a contract that can be made
**immutable** (no owner, no proxy, no pause), which gives the best trust
model after a native escrow.

**Contract `ViennaEscrow.sol`** (one file, no inheritance):

```solidity
struct Tranche { address renter; address lender; uint96 amount;
                 uint64 cancelAfter; bytes32 condition; uint8 status; }
mapping(bytes32 => Tranche) public tranches;   // key = keccak(renter, agreementId, index)

function lock(bytes32 agreementId, uint8 index, address lender,
              uint64 cancelAfter, bytes32 condition) external payable;
function finish(bytes32 key, bytes32 preimage) external;   // anyone; sha256(preimage) == condition; block.timestamp < cancelAfter
function cancel(bytes32 key) external;                     // anyone; block.timestamp >= cancelAfter
```

`finish` pays `lender` with `call{value: amount}("")`, `cancel` pays
`renter`; both set `status` before paying (checks-effects-interactions) and
emit `Finished` / `Cancelled` with the key and the amount. No `selfdestruct`,
no admin function at all: the deployed bytecode is the whole promise.

**Work.**
1. Contract + Foundry tests (`forge test`): the 27 cases replayed through the
   rules engine do not change; the Solidity tests cover the four refusals
   (finish too late, cancel too early, wrong preimage, double spend).
2. Deploy on Sepolia from a tagged commit; README carries the address, the
   deployment transaction and the verified source on Etherscan.
3. `src/ledger/ethereum.mjs` on `ethers` v6: `lock` ×N (one transaction per
   tranche, or a `lockMany` helper if gas allows), `finish`, `cancel`,
   `openEscrows` by reading the mapping, `waitPast` on `block.timestamp`.
4. Wallets: three Sepolia keys in `state/demo.ethereum.wallets.json`
   (git-ignored), funded by a faucet.
5. Measures: `measures/ethereum-<id>.json`, links
   `https://sepolia.etherscan.io/tx/<hash>`, gas paid per act in the README.

**Done when:** same criteria as Solana, plus "contract immutable" verified by
the absence of any owner or upgrade function in the verified source.

**Estimate:** 3 hours.

## 7. Bitcoin (fourth), where one rule bends

**Starting point.** No contracts, only Script. The deposit becomes one
**UTXO per tranche** locked by a hash-time-locked script (HTLC), on signet.

**Script per tranche** (taproot script path, two leaves):

```
leaf "finish":  OP_SHA256 <condition> OP_EQUALVERIFY <lender_pubkey> OP_CHECKSIG
leaf "cancel":  <cancel_after> OP_CHECKLOCKTIMEVERIFY OP_DROP <renter_pubkey> OP_CHECKSIG
```

**What Bitcoin cannot give, said before the work.** Without a signature,
Script cannot force *where* the coins go: a "finish" leaf that only checks the
preimage would let whoever sees the preimage in the mempool send the tranche
to themselves. So:

| vienna rule | On Bitcoin |
|---|---|
| anyone can finish with the secret | **the lender** finishes: the oracle gives the lender the preimage, the lender signs |
| anyone can refund after cancel-after | **the renter** refunds with their key; to keep "silence = refund", the renter holds a **pre-signed refund transaction** (nLockTime = cancel-after) that anyone can broadcast |
| oracle cannot block a refund | kept: the refund leaf has no hash check |
| one escrow per tranche | kept: one UTXO per tranche, so partial retention stays at tranche granularity |

The README of this port must show these four lines; the deposit is weaker
than on XRPL and the plan says so rather than hiding it behind "HTLC".

**Work.**
1. `bitcoinjs-lib` + a signet node or a public signet API (mempool.space
   signet): build the taproot address per tranche, fund N outputs in one
   transaction, keep the pre-signed refund transactions in the renter's state
   file.
2. `finishTranches`: lender-signed spend of the "finish" leaf with the
   preimage in the witness; `cancelTranches`: broadcast the pre-signed refund
   (or a fresh renter-signed spend) once the locktime has passed.
3. `waitPast`: median-time-past of the tip (BIP 113), not wall clock.
4. Fees: one spend per tranche; the README reports sat/vB and the total paid,
   which is the main UX limit (five tranches = five spends).
5. Measures: `measures/bitcoin-<id>.json`, links
   `https://mempool.space/signet/tx/<txid>`.

**Done when:** three measured runs on signet, the table above in the README,
and the `cases` test still green (the rules engine is untouched; only who
signs changes).

**Estimate:** 5 to 6 hours.

## 8. Casper (built first, on the `casper` branch)

**Starting point.** No contract and no toolchain: rustup and cargo were
present, nothing Casper-specific was. (Deviation: `casper-client` 5.0.1 turned
out to be installed already; it was used only to double-check deploys.)

**Planned work, and what was actually done.**
1. Toolchain: as planned, plus two things the plan did not foresee.
   `casper-contract` 5.1.1 with its default `no-std-helpers` feature needs
   nightly Rust; it is built without default features, with `wee_alloc` as the
   allocator and the crate's own panic handler. And `rustc` 1.99 emits
   bulk-memory and sign-extension instructions, even inside the precompiled
   `core`, that `casper-wasmi` refuses at install
   (`Bulk memory operations are not supported`); `contracts/casper/build.sh`
   lowers them with binaryen `wasm-opt` and validates the wasm as MVP-only.
   Testnet accounts are generated locally (`state/demo.casper.wallets.json`,
   git-ignored); the cspr.live faucet needs a human and a wallet, so the
   oracle key was funded by a transfer from the author's wallet.
2. Contract `vienna_escrow`: the four promises hold (`finish` needs
   `sha256(preimage) == condition` and `blocktime < cancel_after`; `cancel`
   needs `blocktime >= cancel_after`; both public, no caller check; locked
   package, no access key kept). Two deviations in the mechanics:
   - **`lock` is not "payable".** VM1 contracts cannot receive CSPR with a
     call, and a purse read from a dictionary carries no access rights. So
     `lock` creates the purse itself (one `create_purse`, 2.5 CSPR of gas on
     this testnet), keeps its URef in a contract named key `p:<renter>:<id>`,
     records the tranche as *pending*, and returns the purse with **ADD rights
     only**; the renter's session code `vienna_lock` transfers the amount into
     it and calls `confirm`, which checks the purse balance and marks the
     tranche *locked*. One deploy for the renter, atomic, and a single purse
     creation instead of two.
   - An `init` entry point creates the two dictionaries in the contract's own
     context during the install deploy, so the installer never holds their
     write rights; a per-renter `index` dictionary gives `openEscrows`
     something to iterate.
   Unit tests run on the real execution engine with a controlled block time
   (`casper-engine-test-support`): finish too late, cancel too early, wrong
   secret, double spend, plus the two happy paths and the absence of any
   access key after install. Seven tests, all green.
3. `src/ledger/casper.mjs` on `casper-js-sdk` 5.3.1: as planned. One deploy
   per tranche for each of lock, finish, cancel; `openEscrows` reads the
   contract's named keys and dictionaries; `waitPast` watches block
   timestamps. The condition stays the XRPL PREIMAGE-SHA-256 DER structure
   inside vienna; the adapter sends the 32-byte digest it contains and, on
   finish, the raw 32-byte preimage (tested in `test/condition.test.mjs`).
4. Gas: the plan said "Casper charges the full payment amount". Wrong for
   this testnet: its chainspec has `pricing_handling = payment_limited`,
   `refund_handling = refund 75/100`, `fee_handling = burn`, so a deploy is
   charged what it consumed plus a quarter of what it reserved and did not
   use. The expensive items are fixed host costs, not computation:
   `create_purse` 2.5 CSPR, `transfer_from_purse_to_account` 2.5 CSPR,
   `call_contract` 0.3 CSPR, storage about 1.12 CSPR per kB (the 50 kB
   contract costs about 56 CSPR to install). Real numbers in the README.
5. Measures: as planned, `measures/casper-<id>.json`, links
   `https://testnet.cspr.live/deploy/<hash>`. Done.

   Two more things only the live chain taught. The SDK copies the contract
   hash as given into `StoredContractByHash.hash`; the node wants the bare
   64-hex form (what `casper-client` sends) and answers `Invalid params`
   otherwise, which the engine tests could not show. And the execution
   result's `cost` is the payment limit, not the charge: the adapter computes
   `charged = limit − 75 % × (limit − consumed)` and the measures sum that.
6. Demo clocks: five sequential deploys at about 7 s each do not fit in XRPL's
   25 s due date, so each adapter exports its own `DEMO_CLOCKS` (Casper: due
   in 150 s, dispute window 180 s; XRPL unchanged). The rules do not change.

**Measured** (14 November 2026, `casper-test`, protocol 2.2.4; every hash in
`measures/casper-*.json` and the README). Install: 74.964 CSPR consumed,
81.223 charged. Per act, charged: lock 4.79 to 4.81 CSPR, finish 3.06 to 3.07,
cancel 3.06 to 3.07. The `late` run (5 locks, 2 finishes, 3 cancels) cost
39.28 CSPR of gas for a 50 CSPR deposit and took 365 s wall time; `clean`
388 s, `contested` 380 s. The first `late` attempt failed on the hash spelling
above after its five locks had landed; its tranches were refunded by `cancel`
after `cancel_after` by the same code anyone could run, which is the refund
promise working as written, and that attempt is not counted as a measure.

**Time.** Contract, session code, engine tests, adapter and `VIENNA_CHAIN`
wiring: about one hour (the first commit on the branch is 55 minutes after the
plan commit, on an otherwise idle machine where the crates were cached). Then
about six hours blocked overnight on funding: the testnet faucet needs a
human, a Casper Wallet account and a transfer. Install plus the failed attempt,
the fix, the refund and the three measured runs: 30 minutes. The 6-hour
estimate was wrong in both directions: the code was faster, the money slower.

**Done when:** same criteria as the other ledgers. The limits that remain are
the ones the plan named (funds held by a contract rather than the ledger,
install cost charged once) plus the per-act gas floor the testnet chainspec
sets, which no contract design can go below.

## 9. Order, branches, and how the README grows

- Planned order: Solana, NEAR (both have a deployed prior contract), then
  Ethereum (shortest from scratch, immutable), then Bitcoin (one rule bends),
  then Casper (no toolchain). Actual order: Casper went first, because it was the port asked for
  first (§8). One branch per ledger: `solana`, `near`,
  `ethereum`, `bitcoin`, `casper`. Each is merged into `main` only when its
  "done when" list is complete.
- The adapter is chosen by `VIENNA_CHAIN=xrpl|solana|near|ethereum|bitcoin|casper` (default
  `xrpl`) in `.env`; `src/ledger.mjs` imports `src/ledger/<chain>.mjs`,
  `bin/vienna.mjs demo` and the dashboard read it. Each agreement records
  `chain` and `coin`, so records of different ledgers coexist in `state/`.
- The README keeps one "Measured on …" table per ledger and one limits
  paragraph per ledger. No port is listed until it has its three measured runs.

## 10. Out of scope

- Stablecoin or token versions: like XRP on XRPL, each port uses the native
  coin only (SOL, NEAR, ETH, BTC, CSPR). Tokens would add an issuer and a freeze key to
  the trust model; that is a different product.
- Bridges between the four deposits.
- Any change to the rules or to the case file to make a port easier: the
  cases are the contract, the ledgers adapt to them.
