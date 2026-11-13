// Writes cases/*.json. Expected values are written BY HAND here (drops), never computed by the engine,
// so the case file stays an independent judge. Re-run: node tools/make_cases.mjs
import { writeFileSync, mkdirSync } from "node:fs";
const X = 1_000_000;
const base = {
  id: "ebike-0001", item: "e-bike (Kaution)", deposit_xrp: 200, tranche_xrp: 20,
  due_at: "2026-11-14T18:00:00Z", grace_min: 30, dispute_window_h: 48,
  late_fee_xrp_per_hour: 5, late_fee_cap_xrp: 60,
  accessories: [{ name: "lock", value_xrp: 15 }, { name: "charger", value_xrp: 30 }, { name: "helmet", value_xrp: 25 }],
  cleaning_fee_xrp: 20,
  arbiter: { name: "Crypto Club Vienna desk" },
};
const noArbiter = { ...base, id: "ebike-0002", arbiter: null };
const fine = { ...base, id: "ebike-0003", tranche_xrp: 5 };
const DL = "2026-11-14T18:30:00Z"; // deadline = due + grace
const cases = [
  ["01-open-before-due", base, null, "2026-11-14T17:00:00Z", null, { status: "open", retention_drops: 0, tranches_to_lender: 0 }],
  ["02-open-at-deadline", base, null, DL, null, { status: "open", retention_drops: 0, tranches_to_lender: 0 }],
  ["03-overdue-90min-no-report", base, null, "2026-11-14T20:00:00Z", null, { status: "overdue", retention_drops: 0, tranches_to_lender: 0 }],
  ["04-overdue-5h-no-report", base, null, "2026-11-14T23:30:00Z", null, { status: "overdue", retention_drops: 20 * X, tranches_to_lender: 1 }],
  ["05-returned-on-time-clean", base, { returned_at: "2026-11-14T17:50:00Z" }, "2026-11-14T18:00:00Z", null, { status: "returned_clean", retention_drops: 0, tranches_to_lender: 0 }],
  ["06-returned-in-grace", base, { returned_at: "2026-11-14T18:10:00Z" }, "2026-11-14T19:00:00Z", null, { status: "returned_clean", retention_drops: 0, tranches_to_lender: 0 }],
  ["07-returned-2h-late-rounds-down", base, { returned_at: "2026-11-14T20:30:00Z" }, "2026-11-14T21:00:00Z", null, { status: "settled", retention_drops: 0, tranches_to_lender: 0 }],
  ["08-returned-4h-late", base, { returned_at: "2026-11-14T22:00:00Z" }, "2026-11-14T22:00:00Z", null, { status: "settled", retention_drops: 20 * X, tranches_to_lender: 1 }],
  ["09-returned-30h-late-capped", base, { returned_at: "2026-11-16T00:30:00Z" }, "2026-11-16T01:00:00Z", null, { status: "settled", retention_drops: 60 * X, tranches_to_lender: 3 }],
  ["10-missing-charger", base, { returned_at: "2026-11-14T17:00:00Z", missing: ["charger"] }, "2026-11-14T18:00:00Z", null, { status: "settled", retention_drops: 20 * X, tranches_to_lender: 1 }],
  ["11-missing-charger-and-lock", base, { returned_at: "2026-11-14T17:00:00Z", missing: ["charger", "lock"] }, "2026-11-14T18:00:00Z", null, { status: "settled", retention_drops: 40 * X, tranches_to_lender: 2 }],
  ["12-missing-unlisted-basket-is-zero", base, { returned_at: "2026-11-14T17:00:00Z", missing: ["basket"] }, "2026-11-14T18:00:00Z", null, { status: "returned_clean", retention_drops: 0, tranches_to_lender: 0 }],
  ["13-dirty", base, { returned_at: "2026-11-14T17:00:00Z", dirty: true }, "2026-11-14T18:00:00Z", null, { status: "settled", retention_drops: 20 * X, tranches_to_lender: 1 }],
  ["14-late4h-charger-dirty", base, { returned_at: "2026-11-14T22:00:00Z", missing: ["charger"], dirty: true }, "2026-11-14T22:00:00Z", null, { status: "settled", retention_drops: 60 * X, tranches_to_lender: 3 }],
  ["15-damage-agreed-50", base, { returned_at: "2026-11-14T17:00:00Z", damage: [{ desc: "scratched frame", claimed_xrp: 50, renter_agrees: true }] }, "2026-11-14T18:00:00Z", null, { status: "settled", retention_drops: 40 * X, tranches_to_lender: 2 }],
  ["16-damage-contested-awaits-arbiter", base, { returned_at: "2026-11-14T17:00:00Z", damage: [{ desc: "scratched frame", claimed_xrp: 50, renter_agrees: false }] }, "2026-11-14T18:00:00Z", null, { status: "awaiting_arbiter", retention_drops: 0, tranches_to_lender: 0 }],
  ["17-damage-arbiter-sets-40", base, { returned_at: "2026-11-14T17:00:00Z", damage: [{ desc: "scratched frame", claimed_xrp: 50, renter_agrees: false }] }, "2026-11-15T10:00:00Z", { for: "scratched frame", damage_xrp: 40 }, { status: "settled", retention_drops: 40 * X, tranches_to_lender: 2 }],
  ["18-damage-arbiter-above-claim-is-capped", base, { returned_at: "2026-11-14T17:00:00Z", damage: [{ desc: "scratched frame", claimed_xrp: 50, renter_agrees: false }] }, "2026-11-15T10:00:00Z", { for: "scratched frame", damage_xrp: 80 }, { status: "settled", retention_drops: 40 * X, tranches_to_lender: 2 }],
  ["19-contested-past-cancel-after-refunds", base, { returned_at: "2026-11-14T17:00:00Z", damage: [{ desc: "scratched frame", claimed_xrp: 50, renter_agrees: false }] }, "2026-11-16T18:30:00Z", null, { status: "expired_refund", retention_drops: 0, tranches_to_lender: 0 }],
  ["20-everything-capped-at-deposit", base, { returned_at: "2026-11-16T00:30:00Z", missing: ["charger", "lock", "helmet"], dirty: true, damage: [{ desc: "bent wheel", claimed_xrp: 100, renter_agrees: true }] }, "2026-11-16T01:00:00Z", null, { status: "settled", retention_drops: 200 * X, tranches_to_lender: 10 }],
  ["21-not-returned-agreed-forfeit", base, { not_returned: true, renter_agrees_not_returned: true }, "2026-11-14T21:30:00Z", null, { status: "forfeit", retention_drops: 200 * X, tranches_to_lender: 10 }],
  ["22-not-returned-contested-late-fee-only", base, { not_returned: true }, "2026-11-14T21:30:00Z", null, { status: "overdue", retention_drops: 0, tranches_to_lender: 0 }],
  ["23-not-returned-arbiter-confirms", base, { not_returned: true }, "2026-11-14T21:30:00Z", { not_returned_confirmed: true }, { status: "forfeit", retention_drops: 200 * X, tranches_to_lender: 10 }],
  ["24-no-arbiter-contested-damage-is-zero", noArbiter, { returned_at: "2026-11-14T17:00:00Z", damage: [{ desc: "dent", claimed_xrp: 50, renter_agrees: false }] }, "2026-11-14T18:00:00Z", null, { status: "returned_clean", retention_drops: 0, tranches_to_lender: 0 }],
  ["25-fine-tranches-2h-late", fine, { returned_at: "2026-11-14T20:30:00Z" }, "2026-11-14T21:00:00Z", null, { status: "settled", retention_drops: 10 * X, tranches_to_lender: 2 }],
  ["26-fine-tranches-dirty-and-lock", fine, { returned_at: "2026-11-14T17:00:00Z", dirty: true, missing: ["lock"] }, "2026-11-14T18:00:00Z", null, { status: "settled", retention_drops: 35 * X, tranches_to_lender: 7 }],
];
mkdirSync("cases", { recursive: true });
for (const [name, agreement, report, now, arbiter, expected] of cases)
  writeFileSync(`cases/${name}.json`, JSON.stringify({ name, agreement, report, now, arbiter, expected }, null, 2) + "\n");
writeFileSync("cases/99-bad-agreement-tranche-does-not-divide.json", JSON.stringify({ name: "99-bad-agreement", agreement: { ...base, id: "bad", tranche_xrp: 30 }, report: null, now: DL, arbiter: null, expected: { throws: "whole number of tranches" } }, null, 2) + "\n");
console.log(`${cases.length + 1} cases written`);
