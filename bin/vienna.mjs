#!/usr/bin/env node
/**
 * vienna CLI.
 *   vienna settle <agreement.json> <report.json|-> [now ISO] [arbiter.json]   offline verdict
 *   vienna demo <clean|late|contested> [--tranches 5]                          measured flow on a testnet (VIENNA_CHAIN=xrpl|casper)
 *   vienna status <id>                                                         public record
 */
import { readFileSync, writeFileSync } from "node:fs";
import { settle } from "../src/rules.mjs";
import { toXrp } from "../src/money.mjs";
import * as oracle from "../src/oracle.mjs";
import * as L from "../src/ledger.mjs";

const [, , cmd, ...args] = process.argv;
const json = (p) => JSON.parse(readFileSync(p, "utf8"));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

if (cmd === "settle") {
  const [ag, rep, now, arb] = args;
  const v = settle(json(ag), rep && rep !== "-" ? json(rep) : null, now ?? new Date().toISOString(), arb ? json(arb) : null);
  console.log(JSON.stringify(v, null, 2));
} else if (cmd === "status") {
  console.log(JSON.stringify(oracle.record(args[0]), null, 2));
} else if (cmd === "demo") {
  await demo(args[0] ?? "late", Number((args.indexOf("--tranches") >= 0 && args[args.indexOf("--tranches") + 1]) || 5));
} else {
  console.error("usage: vienna settle|demo|status"); process.exit(2);
}

async function demo(scenario, n) {
  const T0 = Date.now();
  const client = await L.connect();
  // Three keys: the renter, the lender, the oracle (who also plays the arbiter's clerk here). The adapter funds them.
  const { renter, lender, oracle: orc } = await L.loadWallets(client, log);
  const bal = async () => ({ renter: L.fmt(await L.balanceUnits(client, renter.address)), lender: L.fmt(await L.balanceUnits(client, lender.address)), oracle: L.fmt(await L.balanceUnits(client, orc.address)) });
  const balancesBefore = await bal();
  log(`wallets on ${L.CHAIN}`, { renter: renter.address, lender: lender.address, oracle: orc.address }, balancesBefore);

  // The agreement, priced BEFORE the key changes hands. Short clocks so the whole year fits in minutes (per-ledger, see DEMO_CLOCKS).
  const due = new Date(T0 + L.DEMO_CLOCKS.due_s * 1000).toISOString();
  const id = `${L.CHAIN === "xrpl" ? "" : L.CHAIN + "-"}demo-${scenario}-${new Date(T0).toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`;
  // Amounts are in the agreement's coin (XRP on XRPL, CSPR on Casper); the rules count in millionths, whatever the coin.
  const agreement = {
    id, chain: L.CHAIN, coin: L.COIN, item: "e-bike, Saturday rental (Kaution)", renter: renter.address, lender: lender.address,
    deposit_xrp: 10 * n, tranche_xrp: 10, due_at: due, grace_s: 0, dispute_window_s: L.DEMO_CLOCKS.dispute_window_s,
    late_fee_xrp_per_hour: 10, late_fee_cap_xrp: 30,
    accessories: [{ name: "lock", value_xrp: 5 }, { name: "charger", value_xrp: 15 }],
    cleaning_fee_xrp: 10, arbiter: { name: "Crypto Club Vienna desk", address: orc.address },
  };
  const rec = oracle.register(agreement);
  const v0 = settle(agreement, null, T0);
  const cancelAfterMs = Date.parse(v0.cancel_after);
  log(`agreement ${id}: deposit ${agreement.deposit_xrp} ${L.COIN} in ${n} tranches of ${agreement.tranche_xrp}, due ${due}, cancel_after ${v0.cancel_after}`);

  // 1. Lock: N escrows from the renter, conditions from the oracle, cancel-after for everyone.
  const locked = await L.lockTranches(client, renter, lender.address, agreement.tranche_xrp * L.UNIT, rec.tranches.map((t) => t.condition), cancelAfterMs, id);
  oracle.update(id, (r) => locked.forEach((l, i) => { r.tranches[i].sequence = l.sequence; r.tranches[i].status = "locked"; r.tranches[i].tx.create = l.hash; }));
  log(`locked ${locked.length} tranches`, locked.map((l) => l.hash.slice(0, 8)).join(" "), await bal());

  // 2. The rental happens. Then the lender files a return report (or the arbiter rules).
  const measures = { scenario, id, chain: L.CHAIN, coin: L.COIN, wallets: { renter: renter.address, lender: lender.address, oracle: orc.address }, balances_before: balancesBefore, agreement, create: locked, finish: [], cancel: [], verdicts: [] };
  const apply = async (label) => {
    const { verdict, toFinish, toCancel } = oracle.decide(id, Date.now());
    measures.verdicts.push({ label, verdict });
    log(`${label}: ${verdict.status}, lender keeps ${toXrp(verdict.retention_drops)} ${L.COIN} = ${verdict.tranches_to_lender} tranche(s)`, verdict.lines.map((l) => `${l.kind} ${toXrp(l.drops)}`).join(", ") || "nothing", verdict.escalations.length ? `| escalated: ${verdict.escalations.map((e) => e.what).join(", ")}` : "");
    if (toFinish.length) {
      const f = await L.finishTranches(client, orc, renter.address, toFinish);
      oracle.update(id, (r) => toFinish.forEach((t, k) => { r.tranches[t.i].status = "to_lender"; r.tranches[t.i].tx.finish = f[k].hash; }));
      measures.finish.push(...f); log(`  finished ${f.length} tranche(s) to lender`, f.map((x) => x.hash.slice(0, 8)).join(" "));
    }
    if (toCancel.length) {
      const c = await L.cancelTranches(client, orc, renter.address, toCancel);
      oracle.update(id, (r) => r.tranches.filter((t) => toCancel.includes(t.sequence)).forEach((t, k) => { t.status = "to_renter"; t.tx.cancel = c[k].hash; }));
      measures.cancel.push(...c); log(`  cancelled ${c.length} tranche(s) back to renter`, c.map((x) => x.hash.slice(0, 8)).join(" "));
    }
    return verdict;
  };

  if (scenario === "clean") {
    oracle.update(id, (r) => { r.report = { returned_at: new Date().toISOString(), filed_by: lender.address }; });
    await apply("return report: on time, complete");
  } else if (scenario === "late") {
    await L.waitPast(client, Date.parse(due) + 8_000, (s) => log(`  renter is late… ${s}s`));
    oracle.update(id, (r) => { r.report = { returned_at: new Date().toISOString(), missing: ["charger", "basket"], filed_by: lender.address }; });
    await apply("return report: late, charger missing, 'basket' not in agreement");
  } else if (scenario === "contested") {
    oracle.update(id, (r) => { r.report = { returned_at: new Date().toISOString(), damage: [{ desc: "scratched frame", claimed_xrp: 30, renter_agrees: false }], filed_by: lender.address }; });
    await apply(`return report: damage claimed 30 ${L.COIN}, renter disagrees`);
    await new Promise((r) => setTimeout(r, 8_000));
    oracle.update(id, (r) => { r.arbiter = { for: "scratched frame", damage_xrp: 20, by: orc.address, signed_at: new Date().toISOString() }; });
    await apply(`arbiter verdict: 20 ${L.COIN}`);
  } else throw new Error(`unknown scenario ${scenario}`);

  // 3. After CancelAfter, whatever is still locked goes back. Anyone may send these; here the oracle does.
  await L.waitPast(client, cancelAfterMs, (s) => log(`  waiting for cancel_after… ${s}s`));
  await apply("after cancel_after");
  const left = await L.openEscrows(client, renter.address);
  measures.open_escrows_left = left.length;
  // What the chain charged per act, when the adapter reports it (Casper: consumed + 25% of the unused limit, in motes).
  const sum = (xs) => xs.reduce((a, x) => a + BigInt(x.charged ?? x.cost ?? 0), 0n);
  if (locked.some((l) => l.charged ?? l.cost)) measures.cost_units = { lock: String(sum(locked)), finish: String(sum(measures.finish)), cancel: String(sum(measures.cancel)), unit: `1e-${Math.log10(L.UNIT)} ${L.COIN}` };
  measures.balances = await bal();
  measures.record = oracle.record(id);
  measures.duration_s = Math.round((Date.now() - T0) / 1000);
  const out = `measures/${id}.json`;
  writeFileSync(out, JSON.stringify(measures, null, 2) + "\n");
  log(`done in ${measures.duration_s}s, escrows left: ${left.length}, balances`, measures.balances, `→ ${out}`);
  await client.disconnect();
}
