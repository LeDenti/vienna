# Porting vienna to other ledgers

vienna was built on the XRP Ledger because its escrows are native: a
conditional, time-boxed deposit needs no contract, and the automatic refund is
enforced by the ledger itself. This page is the plan for running the same
deposit on three ledgers that do not have native escrows: Solana, NEAR and
Casper. It is written before the work, so that the result can be checked
against it.

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

## 6. Casper (last)

**Starting point.** None: no contract, no toolchain on the build machine.

**Work.**
1. Toolchain: Rust `wasm32-unknown-unknown`, `casper-contract` /
   `casper-types` crates, `casper-client`; a testnet account funded by the
   cspr.live testnet faucet.
2. Contract `vienna_escrow` (one session + one stored contract):
   - `lock(id, lender, cancel_after_ms, condition: [u8;32])` payable: moves the
     attached CSPR into a purse created per tranche (`system::create_purse`),
     stores `{renter, lender, amount, cancel_after, condition, status}` under
     a named key / dictionary entry `tranche:<renter>:<id>`;
   - `finish(id, preimage)`: `sha2::Sha256` over the preimage (no_std) must
     equal `condition`, `runtime::get_blocktime()` must be `< cancel_after`,
     then `system::transfer_from_purse_to_account(purse, lender, amount)`;
   - `cancel(id)`: `get_blocktime() >= cancel_after`, transfer back to the
     renter. Both entry points are public (no caller check).
3. `src/ledger/casper.mjs` on `casper-js-sdk`: deploys per tranche, wait for
   execution results, read the dictionary for `openEscrows`.
4. Gas: Casper charges the full payment amount of a deploy, not the gas used.
   The README reports the real cost per act; this is the main UX limit of
   this port.
5. Measures: `measures/casper-<id>.json`, links
   `https://testnet.cspr.live/deploy/<hash>`.

**Done when:** same criteria. Limits: contract upgradeability (use an
immutable contract installed without a package upgrade group), deploy cost.

**Estimate:** 6 hours or more; the first ledger where the contract is written
from scratch and the toolchain is not installed.

## 7. Order, branches, and how the README grows

- One branch per ledger: `solana`, `near`, `casper`. Each is merged into
  `main` only when its "done when" list is complete.
- The adapter is chosen by `VIENNA_CHAIN=xrpl|solana|near|casper` (default
  `xrpl`) in `.env`; `bin/vienna.mjs demo` and the dashboard read it.
- The README keeps one "Measured on …" table per ledger and one limits
  paragraph per ledger. No port is listed until it has its three measured runs.

## 8. Out of scope

- Stablecoin or token versions: like XRP on XRPL, each port uses the native
  coin only (SOL, NEAR, CSPR). Tokens would add an issuer and a freeze key to
  the trust model; that is a different product.
- Bridges between the four deposits.
- Any change to the rules or to the case file to make a port easier: the
  cases are the contract, the ledgers adapt to them.
