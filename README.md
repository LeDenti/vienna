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

## Run it

```
npm install
npm test
npm run demo -- late          # testnet; funds three wallets from the faucet, keeps them in state/demo.wallets.json
npm run serve                 # dashboard on http://localhost:8790 (reads state/*.json)
```

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

The rules engine and the case file do not depend on the ledger; only the adapter does. The plan for Solana, NEAR, Ethereum, Bitcoin and Casper, why none of them is built yet, what each port must keep and where each one bends a rule, is in [docs/PORTING.md](docs/PORTING.md). No port is listed here until it has its three measured runs.

## Prior work, disclosed

The author has built XRPL escrow prototypes before (an open-source payment-by-proof project). This repository was written from scratch during the hackathon: no code was copied; the crypto-condition encoder was rewritten from the specification and is checked against an independent library in the tests.

## Setup, environment, architecture, assumptions

**Setup.** Node 20 or later, `npm install`. No database, no build step, no account anywhere: `npm run demo -- late` asks the XRPL testnet faucet for three wallets and keeps their seeds in `state/demo.wallets.json` (git-ignored). `.env.example` lists the two variables (`XRPL_URL`, `PORT`); the defaults are the testnet and port 8790.

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

The oracle never holds funds. The renter signs the N `EscrowCreate`; the oracle signs `EscrowFinish` (it pays the fee) and, as a courtesy, the `EscrowCancel` after the deadline, which anyone else could send instead.

**Assumptions.** Native XRP on testnet; a 48 h dispute window in real life (75 s in the demo); the lender's report is taken as filed for late and missing items (priced in advance), while damage needs the renter or the arbiter; one tranche is the unit of retention; clocks are the ledger's close times (10 s resolution), not the oracle's.

## Layout

```
src/rules.mjs       the settlement rules (pure function)
src/condition.mjs   PREIMAGE-SHA-256 conditions, DER-encoded the way XRPL wants
src/ledger.mjs      XRPL: lock, finish, cancel, wait for CancelAfter
src/oracle.mjs      secrets, public records, decisions
bin/vienna.mjs      CLI and the three measured scenarios
bin/serve.mjs       dashboard (node:http, no framework)
web/index.html      the dashboard page
cases/*.json        the judge
measures/*.json     what actually happened on testnet, with hashes
```

MIT. Author: matter-x- (GitHub LeDenti).
