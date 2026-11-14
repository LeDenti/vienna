# vienna — a deposit you get back automatically

**Everyday rental deposits (the Austrian *Kaution*) as tranche escrows on the XRP Ledger, settled by rules written before the rental and judged by a case file.**

Built solo, remotely, in 24 hours at the proximata × HOIV × START Vienna hackathon *Building Better Worlds* (Vienna, 13–14 November 2026), crypto track with Crypto Club Vienna: *Bringing crypto to everyday life*.

**Demo video (2:33):** https://youtu.be/wWH-zqQhDpI — every terminal line and screenshot in it comes from the testnet runs in [`measures/`](measures/).

> Rent an e-bike for a Saturday in Vienna and the shop blocks €200 on your card for up to a week. No credit card: no bike. A scratch at the end: a chargeback fight nobody wins.
> With **vienna** the €200 sits in five escrows of €40 on the ledger. Only the written rules can move one to the shop. After the deadline, *anyone* can send the rest back to you — the refund needs nobody's goodwill, not even ours.

## What it does

1. **Before the key changes hands**, lender and renter agree a priced sheet (`agreement`): deposit, tranche size, due time and grace, late fee per hour and its cap, the value of each accessory, the cleaning fee, the name of an arbiter for contested damage.
2. **Lock**: the renter sends N `EscrowCreate` transactions to the lender, one per tranche. Each carries a `PREIMAGE-SHA-256` condition whose secret only the oracle holds, and a `CancelAfter` = due + grace + dispute window.
3. **Return**: the lender files a return report (time, missing items, dirty, damage). The renter agrees or not.
4. **Settle**: the oracle applies [`src/rules.mjs`](src/rules.mjs) and reveals the secrets of exactly the tranches the lender may keep (`EscrowFinish`). It cannot reveal more than the rules say, and it cannot touch the rest.
5. **Refund**: once `CancelAfter` has passed, anyone (renter, lender, oracle, a stranger) sends `EscrowCancel` for every untouched tranche. The XRP goes back to the renter. No signature of the lender or of the oracle is needed.

The rules fit on one screen and are **argued, not hidden**:

- The deposit is the renter's money. Every doubt is settled in the renter's favour: an item not listed in the agreement is worth **0** ("not found" beats "guessed"), retention is rounded **down** to whole tranches, a contested damage without an arbiter verdict before the deadline costs the renter nothing.
- Everything the lender can keep was **priced before** the rental.
- Only one thing needs a human: a damage the renter disputes. It goes to the named arbiter, with the ledger's deadline. **Silence = refund.**

## The judge: a case file

[`cases/`](cases/) holds 27 cases written by hand (agreement, report, moment, expected verdict to the drop). `npm test` replays them all through the rules, plus a differential test of the crypto-condition encoder against `five-bells-condition` on 50 random secrets. Change a rule, and the case file tells you what you broke.

```
npm install
npm test            # 28 tests: 27 cases + condition encoder
node bin/vienna.mjs settle cases/14-late4h-charger-dirty.json   # (see usage below)
```

## Measured on the XRPL testnet

Three scenarios run end to end with real transactions (`node bin/vienna.mjs demo <clean|late|contested>`). Each run writes `measures/<id>.json` with every hash. Clocks are shortened so a rental fits in three minutes; the rules are the same ones the case file judges.

| scenario | what happened | lender kept | renter got back | transactions | wall time | measures |
|---|---|---|---|---|---|---|
| `clean` | returned on time, complete | 0 × 10 XRP | 5 × 10 XRP | 5 create · 0 finish · 5 cancel | 115 s | [demo-clean-20261113131551](measures/demo-clean-20261113131551.json) |
| `late` | 1 h late + charger missing + "basket" not in agreement | 2 × 10 XRP | 3 × 10 XRP | 5 create · 2 finish · 3 cancel | 109 s | [demo-late-20261113131339](measures/demo-late-20261113131339.json) |
| `contested` | damage 30 claimed, renter disagrees, arbiter sets 20 | 2 × 10 XRP | 3 × 10 XRP | 5 create · 2 finish · 3 cancel | 111 s | [demo-contested-20261113131747](measures/demo-contested-20261113131747.json) |

The `late` run, tranche by tranche (renter `rnriRKH8Xtay54dVq8Eyqk4FnHfbpQRqVj`, lender `rNXMUw8BYUJMNf1KxsTukPniTcZiqtPaGp`):

| tranche | EscrowCreate | outcome | transaction |
|---|---|---|---|
| 1 | [CC80FB9B5D…](https://testnet.xrpl.org/transactions/CC80FB9B5D462278DA1CBAAC6A2F3BD790B3D68E6A2DA889E1D6062860E4B694) | kept by lender (EscrowFinish) | [8D4EC77CB1…](https://testnet.xrpl.org/transactions/8D4EC77CB1E92E13D75BFA7F1598E99495AFD51A96936543937F537E6BA78624) |
| 2 | [176B4D15E0…](https://testnet.xrpl.org/transactions/176B4D15E0A5BCB21CECD4A47426B514525B4D4A873A4278F09A41BD0D60B786) | kept by lender (EscrowFinish) | [BF90C0AB6B…](https://testnet.xrpl.org/transactions/BF90C0AB6B3B89753A1D7A44976EBF423B4228CBF1272DC99F3ED6BFC9B5B4BB) |
| 3 | [622B273441…](https://testnet.xrpl.org/transactions/622B27344198F86FE407F6E1D40927100175FA6CD4E494E5C6DC881813DD46B5) | back to renter (EscrowCancel) | [0EA9C6D95B…](https://testnet.xrpl.org/transactions/0EA9C6D95BD77F4F70C8B96FCF69508444C1BA85E3CC4870D9A7B05E38754F12) |
| 4 | [019AA7D78D…](https://testnet.xrpl.org/transactions/019AA7D78DEA1F73AC0B3D3AC261CC66C9B07BEBF19DDE193E07ED3F74764A6D) | back to renter (EscrowCancel) | [033700C55E…](https://testnet.xrpl.org/transactions/033700C55EB57EC8A4816234EE6C64CC1BF9E865DE52601A3C236FA1B39E08CD) |
| 5 | [6206F72840…](https://testnet.xrpl.org/transactions/6206F728409A52667C9B01EC6BC5CA9B0F7055C942405C4834E95FFDFB0575EA) | back to renter (EscrowCancel) | [26A42E1C06…](https://testnet.xrpl.org/transactions/26A42E1C06B93ED6D675E71A61653205A0D70589BF422A8DE513CA0FA26CDF10) |


Every tranche is visible on the explorer: renter account, five `EscrowCreate`, the `EscrowFinish` the rules allowed, the `EscrowCancel` after the deadline.

## Measured on Casper testnet

Casper has no native escrow, so the port adds one contract, [`vienna_escrow`](contracts/casper/README.md), and keeps everything else: `VIENNA_CHAIN=casper node bin/vienna.mjs demo <clean|late|contested>` runs the same oracle, the same rules and the same five ledger calls (lock, finish, cancel, open escrows, wait past) on `casper-test`, protocol 2.2.4. Each run writes `measures/casper-<id>.json` with every deploy hash, the gas consumed and charged per act, and balances before and after.

**The contract, once.** Built from the tagged commit [`casper-contract-v1`](https://github.com/LeDenti/vienna/tree/casper-contract-v1) (`208f924`), wasm sha256 `2e1b870b…fcc8679` (50 075 bytes, [`contracts/casper/build/SHA256SUMS`](contracts/casper/build/SHA256SUMS)), installed by deploy [73e14cfc…c6b761](https://testnet.cspr.live/deploy/73e14cfc70e6a5e6d78cd86cf68bbe3b2c1c1299857cdf12ac056b0f01c6b761) in block 9 826 086: contract `hash-bb8a6f16da3e03bcf4f4eeca0e837e248b1e119dc8af807582acdcb3f0dc68da`, package `21ffc8c8…7ca10a`, `lock_status: Locked`, one version, no groups. Gas: 74.964 CSPR consumed, 81.223 CSPR charged out of a 100 CSPR limit (the testnet refunds 75 % of the unused limit). The installer's account keeps one named key, the contract hash; the package's access URef is held by nobody. All of it is in [`contracts/casper/deployment.json`](contracts/casper/deployment.json).

| scenario | what happened | lender kept | renter got back | deploys | gas charged (lock / finish / cancel) | wall time | measures |
|---|---|---|---|---|---|---|---|
| `clean` | returned on time, complete | 0 × 10 CSPR | 5 × 10 CSPR | 5 lock · 0 finish · 5 cancel | 23.988 / 0 / 15.313 CSPR | 388 s | [casper-demo-clean-20261114054541](measures/casper-demo-clean-20261114054541.json) |
| `late` | 1 h late + charger missing + "basket" not in agreement | 2 × 10 CSPR | 3 × 10 CSPR | 5 lock · 2 finish · 3 cancel | 23.963 / 6.129 / 9.185 CSPR | 365 s | [casper-demo-late-20261114053936](measures/casper-demo-late-20261114053936.json) |
| `contested` | damage 30 claimed, renter disagrees, arbiter sets 20 | 2 × 10 CSPR | 3 × 10 CSPR | 5 lock · 2 finish · 3 cancel | 24.071 / 6.139 / 9.199 CSPR | 380 s | [casper-demo-contested-20261114055208](measures/casper-demo-contested-20261114055208.json) |

The `late` run, tranche by tranche (renter `016730125b7597bb51b19f76aa0394450e00c0ecc58d3392d41a8df8c411c2b15e`, lender `01edb8c5eb956b8853aeb406725aaab199308d077f13901f94ed5c764b489a07ae`):

| tranche | lock (vienna_lock deploy) | charged | outcome | deploy | charged |
|---|---|---|---|---|---|
| 1 | [be3834710b…](https://testnet.cspr.live/deploy/be3834710b2c1e787dfda40663b1de90bbc484961942da6e469dbb2850aa790c) | 4.793 CSPR | kept by lender (`finish`) | [88b5602f42…](https://testnet.cspr.live/deploy/88b5602f42ec4286343fd6aaaf12cff72b6bb479642cea939212a459739be3c0) | 3.064 CSPR |
| 2 | [de91893b1f…](https://testnet.cspr.live/deploy/de91893b1f50dd62cd826c342a196897090dd41c8303959e7d8067b49b662348) | 4.793 CSPR | kept by lender (`finish`) | [3869eaea74…](https://testnet.cspr.live/deploy/3869eaea74c255b85f4c0b3e37d155d24abf797caf58490f82cbff94d3c02753) | 3.064 CSPR |
| 3 | [f7948fa9bb…](https://testnet.cspr.live/deploy/f7948fa9bb4add81e78572b8e09cfd594dd297a5a248117896e81b230bdc2cb4) | 4.793 CSPR | back to renter (`cancel`) | [9d4747ca13…](https://testnet.cspr.live/deploy/9d4747ca130d22bb16d0a1bb85d7ffecc939da79ee83bbbb5e0ad0c60b20d094) | 3.062 CSPR |
| 4 | [20bac3b147…](https://testnet.cspr.live/deploy/20bac3b147ea88648447007cedb72372582d45b47d6f53dad6c52e98d33c6bab) | 4.793 CSPR | back to renter (`cancel`) | [dabcfff461…](https://testnet.cspr.live/deploy/dabcfff461dc2c9b8f29145412fa89ce3a4472422c05c533f9ebb8ca9af41d4d) | 3.062 CSPR |
| 5 | [0d20d9d3e2…](https://testnet.cspr.live/deploy/0d20d9d3e2ed70060c304a53f45e4c516659be0c3c597b318d525f3b3a661345) | 4.793 CSPR | back to renter (`cancel`) | [c0296af968…](https://testnet.cspr.live/deploy/c0296af96812f0394d17016f68ee40f6fd7d8787d8ba928ea46c70dbfb247e96) | 3.062 CSPR |

Balances of the `late` run, in CSPR: renter 205 → 161.0374 (−43.9626 = 20 kept by the lender + 23.9626 of gas for five locks), lender 10 → 30, oracle 464.2068 → 448.893 (−15.3138 = two finishes 6.129 + three cancels 9.185). Nothing is left in the contract: `openEscrows` returns zero after each run.

Every act is one deploy, visible on the explorer with its `vienna_lock` session or its `finish` / `cancel` entry point, its arguments and its cost. Gas figures are what the account was actually charged: consumed plus 25 % of the unused limit, as the testnet chainspec refunds 75 % of it; the explorer's "cost" column shows the limit.

**Limits of this port, honestly.**

- **The deposit is held by a contract, not by the ledger.** On XRPL nobody wrote the code that holds the money. Here somebody did (this repository), and the renter trusts that code: that it pays the lender only against the right secret before the deadline, and refunds after it. The contract is immutable (locked package, no access key kept, no admin entry point, `finish` and `cancel` check no caller), the four refusals are tested on the real execution engine, and the installed wasm hash is in `deployment.json`, but immutable is not the same as right. An audit is the missing piece, not a flag.
- **Casper's gas is a fixed floor per act, not a market.** Every lock pays one purse creation (2.5 CSPR of host cost on this chainspec), every payout one transfer to an account (2.5 CSPR): the five locks, two finishes and three cancels of the `late` run cost 39.28 CSPR in gas against a 50 CSPR deposit (4.79 per lock, 3.06 per finish or cancel), where XRPL charged under 0.01 XRP. For an everyday deposit the tranche would have to be far larger than 10 CSPR, or the tranche count far smaller, for the gas to be a rounding error. Mainnet gas prices differ from the testnet's `gas price 1`; nothing here measures mainnet.
- **The install was paid once, by the oracle key.** 81.22 CSPR charged for 50 kB of wasm; that cost is per contract, not per rental, and is not in the per-scenario table.
- **The lock is two steps inside one deploy.** The renter's session code calls `lock` (which creates the purse and returns it with ADD rights only), funds it from the renter's main purse, then calls `confirm`. The three steps happen in one deploy, which succeeds or reverts whole; the renter never signs anything that could leave the money half-way.
- **Clocks.** Block timestamps on this testnet move in steps of several seconds and a deploy took about 7 s to execute in these runs (five locks in 37 s), so the demo's due date and dispute window are 150 s and 180 s instead of XRPL's 25 s and 75 s. The rules are the same; only the demo's clock is slower.
- **Not measured:** mainnet, a wallet-signed lock (the demo signs with a key file), what happens when the lender's account does not exist yet (the demo funds it with 10 CSPR first), and anything about CSPR's price against the euro, which is the renter's risk as on XRPL.

## Run it

```
npm install
npm test
npm run demo -- late          # XRPL testnet; funds three wallets from the faucet, keeps them in state/demo.wallets.json
npm run serve                 # dashboard on http://localhost:8790 (reads state/*.json)

VIENNA_CHAIN=casper npm run demo -- late   # Casper testnet; keys in state/demo.casper.wallets.json, see "Measured on Casper testnet"
VIENNA_CHAIN=casper npm run serve          # same dashboard, links point at testnet.cspr.live
```

`VIENNA_CHAIN` (default `xrpl`) picks the adapter in `src/ledger/`; the rules, the oracle, the CLI and the dashboard do not change.

CLI:

```
vienna settle <agreement.json> <report.json|-> [now ISO] [arbiter.json]   offline verdict, no network
vienna demo <clean|late|contested> [--tranches 5]                          measured flow on testnet
vienna status <id>                                                         public record of a rental
```

## Why the XRP Ledger, and why native XRP

- Escrows with crypto-conditions and `CancelAfter` are **ledger primitives**: no contract to audit, no admin key, the refund path is enforced by validators.
- Native XRP needs no trust line and cannot be frozen by an issuer. A euro stablecoin would be the everyday choice, but on XRPL token escrows need the issuer to opt in (`AllowTrustLineLocking`); the main euro and dollar issuers had not at the time of writing. Measured, not assumed: see *Limits*.
- Fees: five `EscrowCreate` + two `EscrowFinish` + three `EscrowCancel` cost under 0.01 XRP in total.

## Limits, honestly

- **Tranche granularity.** The lender is paid in whole tranches, rounded down; up to one tranche of a legitimate claim is lost to rounding. Smaller tranches cost one more transaction and 0.2 XRP of owner reserve each (returned at the end).
- **The oracle is a trusted party for the *keep* side.** It can only move tranches to the lender by revealing secrets, and only as the rules dictate — but a dishonest oracle could reveal secrets it should not. It can never block a refund. A real deployment would split the secret between oracle and arbiter (threshold condition) or publish verdicts for audit.
- **The report is the lender's word; the agreement is the only price list.** Damage needs the renter's agreement or an arbiter. Late and missing items are taken from the report as filed: a lying lender can keep up to what the agreement already priced, never more.
- **Native XRP, not euros.** Price risk during a weekend is the renter's. Token escrows exist on XRPL (XLS-85) but need the issuer's flag.
- **Not legal advice.** Austrian consumer law on deposits is not encoded here; the rules are a demonstration of *how* such terms could be enforced, not *which* terms are lawful.
- **Secrets live in `state/*.secrets.json`** on the oracle's machine, never committed. Lose them and nothing can move to the lender; the renter's refund is unaffected.

## Other ledgers

The rules engine and the case file do not depend on the ledger; only the adapter does. Casper is the first port, built on the `casper` branch: see "Measured on Casper testnet" above and [contracts/casper/README.md](contracts/casper/README.md). The plan for Solana, NEAR, Ethereum and Bitcoin, what each port must keep and where each one bends a rule, and what the Casper port taught, is in [docs/PORTING.md](docs/PORTING.md). No port is listed here until it has its three measured runs.

## Prior work, disclosed

The author has built XRPL escrow prototypes before (an open-source payment-by-proof project). This repository was written from scratch during the hackathon: no code was copied; the crypto-condition encoder was rewritten from the specification and is checked against an independent library in the tests.

## Setup, environment, architecture, assumptions

**Setup.** Node 20 or later, `npm install`. No database, no build step, no account anywhere: `npm run demo -- late` asks the XRPL testnet faucet for three wallets and keeps their seeds in `state/demo.wallets.json` (git-ignored). `.env.example` lists the variables (`XRPL_URL`, `PORT`, `VIENNA_CHAIN`, `CASPER_RPC_URL`); the defaults are the testnets, XRPL and port 8790.

**Casper toolchain** (only to rebuild or re-test the contract; the committed `contracts/casper/build/*.wasm` and the JS adapter need none of it). Versions used for the measured runs: rustc/cargo 1.99.1 stable with target `wasm32-unknown-unknown` (rustup 1.29.2); crates `casper-contract` 5.1.1 (without default features), `casper-types` 6.1.0, `sha2` 0.10.9, `wee_alloc` 0.4.5; tests on `casper-engine-test-support` 8.1.1 and `casper-execution-engine` 8.1.1; binaryen `wasm-opt` 133 and wabt 1.0.42 for `build.sh`; `casper-js-sdk` 5.3.1 in Node 26.12.1 for the adapter; `casper-client` 5.0.1 was installed but is used only to double-check deploys by hand. Testnet `casper-test`, protocol 2.2.4, legacy account/contract model (`enable_addressable_entity = false`), public RPC `https://node.testnet.casper.network/rpc`.

**Architecture.** Four small modules and no framework:

```
agreement.json ─┐
return report  ─┼─▶ rules.mjs (pure) ─▶ verdict: tranches_to_lender, lines, escalations
arbiter verdict ┘          ▲
                           │ judged by cases/*.json (npm test)
oracle.mjs ── holds one secret per tranche; on a verdict reveals exactly k of them
ledger.mjs ── EscrowCreate ×N (Condition + CancelAfter) · EscrowFinish (fulfilment) · EscrowCancel (anyone)
serve.mjs  ── dashboard reading state/*.json (public records only)
```

The oracle never holds funds. The renter signs the N `EscrowCreate`; the oracle signs `EscrowFinish` (it pays the fee) and, as a courtesy, the `EscrowCancel` after the deadline, which anyone else could send instead. On Casper the same five calls go through `contracts/casper/vienna_escrow`: the renter signs N `vienna_lock` deploys (one purse per tranche, held by the contract), the oracle signs `finish` with the raw secret and `cancel` after the deadline, which anyone else could send instead.

**Assumptions.** Native XRP on testnet; a 48 h dispute window in real life (75 s in the demo); the lender's report is taken as filed for late and missing items (priced in advance), while damage needs the renter or the arbiter; one tranche is the unit of retention; clocks are the ledger's close times (10 s resolution), not the oracle's.

## Layout

```
src/rules.mjs       the settlement rules (pure function)
src/condition.mjs   PREIMAGE-SHA-256 conditions, DER-encoded the way XRPL wants
src/ledger.mjs      picks the adapter from VIENNA_CHAIN
src/ledger/xrpl.mjs XRPL: EscrowCreate, EscrowFinish, EscrowCancel, wait for CancelAfter
src/ledger/casper.mjs Casper: the same five functions on the vienna_escrow contract
src/oracle.mjs      secrets, public records, decisions
bin/vienna.mjs      CLI and the three measured scenarios
bin/serve.mjs       dashboard (node:http, no framework)
bin/casper-install.mjs installs the Casper contract once, writes contracts/casper/deployment.json
web/index.html      the dashboard page
contracts/casper/   the Casper contract, its session code, engine tests, built wasm (see its README)
cases/*.json        the judge
measures/*.json     what actually happened on testnet, with hashes
```

MIT. Author: matter-x- (GitHub LeDenti).
