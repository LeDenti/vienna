/**
 * vienna · the settlement rules of an everyday deposit.
 *
 * Pure function: (agreement, report, now) -> verdict. No ledger, no clock of its own,
 * no network. The case file in ../cases/ is its judge: every case there is replayed by
 * `npm test` and the verdict must match to the drop.
 *
 * Principles written down so they can be argued with:
 *  1. The deposit is the renter's money. Every doubt is settled in the renter's favour:
 *     an item not listed in the agreement is worth 0 ("not found" beats "guessed"),
 *     retention is rounded DOWN to whole tranches, a contested damage with no arbiter
 *     verdict before the deadline costs the renter nothing.
 *  2. Everything the lender can keep was priced BEFORE the rental, in the agreement:
 *     late fee per hour and its cap, the value of each accessory, the cleaning fee.
 *  3. Only one thing needs a human: a damage the renter does not agree with. That goes
 *     to the arbiter named in the agreement, with a deadline. Silence = refund.
 */
import { toDrops } from "./money.mjs";

const HOUR_MS = 3_600_000;

/** Validate and normalise an agreement. Throws on nonsense, never guesses. */
export function normaliseAgreement(a) {
  const deposit = toDrops(a.deposit_xrp);
  const tranche = toDrops(a.tranche_xrp);
  if (tranche <= 0) throw new Error("tranche_xrp must be > 0");
  if (deposit % tranche !== 0) throw new Error("deposit_xrp must be a whole number of tranches");
  const n = deposit / tranche;
  if (n < 1 || n > 50) throw new Error("between 1 and 50 tranches");
  const due = Date.parse(a.due_at);
  if (Number.isNaN(due)) throw new Error("due_at must be an ISO date");
  return {
    id: String(a.id),
    item: String(a.item ?? "item"),
    deposit,
    tranche,
    tranches: n,
    due,
    graceMs: a.grace_s != null ? a.grace_s * 1000 : (a.grace_min ?? 0) * 60_000,
    disputeWindowMs: a.dispute_window_s != null ? a.dispute_window_s * 1000 : (a.dispute_window_h ?? 48) * HOUR_MS,
    lateFeePerHour: toDrops(a.late_fee_xrp_per_hour ?? 0),
    lateFeeCap: a.late_fee_cap_xrp == null ? deposit : toDrops(a.late_fee_cap_xrp),
    accessories: Object.fromEntries((a.accessories ?? []).map((x) => [x.name, toDrops(x.value_xrp)])),
    cleaningFee: toDrops(a.cleaning_fee_xrp ?? 0),
    arbiter: a.arbiter ?? null,
  };
}

/**
 * Decide what the lender keeps.
 * @param {object} agreementIn  see cases/*.json
 * @param {object|null} report  the lender's return report, or null if nothing filed yet
 * @param {string|number} now   ISO date or ms; the moment the question is asked
 * @param {object|null} arbiter optional arbiter verdict { damage_xrp, signed_at }
 */
export function settle(agreementIn, report, now, arbiter = null) {
  const A = normaliseAgreement(agreementIn);
  const t = typeof now === "number" ? now : Date.parse(now);
  const deadline = A.due + A.graceMs;            // after this, the return is late
  const cancelAfter = deadline + A.disputeWindowMs; // after this, the ledger gives everything back
  const lines = [];
  const escalations = [];
  const notes = [];

  const verdict = (status, retention) => {
    retention = Math.min(retention, A.deposit);
    const tranchesToLender = Math.floor(retention / A.tranche);
    const kept = tranchesToLender * A.tranche;
    if (kept !== retention) notes.push(`rounded down from ${retention} to ${kept} drops (whole tranches, renter never overpays)`);
    return {
      id: A.id, status, now: new Date(t).toISOString(),
      deadline: new Date(deadline).toISOString(), cancel_after: new Date(cancelAfter).toISOString(),
      retention_drops: kept, tranches_to_lender: tranchesToLender,
      tranches_to_renter: A.tranches - tranchesToLender, refund_drops: A.deposit - kept,
      lines, escalations, notes,
    };
  };

  // 1. Past the ledger's own deadline: nothing can be kept any more, whatever was filed.
  if (t >= cancelAfter) {
    notes.push("cancel_after passed: the escrows can be cancelled by anyone, the deposit returns in full");
    return verdict("expired_refund", 0);
  }

  // 2. Nothing filed yet.
  if (!report) {
    if (t <= deadline) return verdict("open", 0);
    // Late and not yet reported: the renter owes the running late fee, nothing else is known.
    const hours = Math.ceil((t - deadline) / HOUR_MS);
    const fee = Math.min(A.lateFeeCap, hours * A.lateFeePerHour);
    if (fee > 0) lines.push({ kind: "late", drops: fee, basis: `${hours} h past ${new Date(deadline).toISOString()} x ${A.lateFeePerHour} drops/h, cap ${A.lateFeeCap}` });
    return verdict("overdue", fee);
  }

  // 3. A return report exists.
  const returnedAt = report.returned_at ? Date.parse(report.returned_at) : null;
  if (returnedAt == null) {
    // Reported as never returned: the deposit covers it, up to the deposit. Still priced by the agreement.
    const hours = Math.ceil((t - deadline) / HOUR_MS);
    const fee = Math.max(0, Math.min(A.lateFeeCap, hours * A.lateFeePerHour));
    if (fee > 0) lines.push({ kind: "late", drops: fee, basis: `not returned, ${hours} h late` });
    let total = fee;
    if (report.not_returned === true) {
      lines.push({ kind: "not_returned", drops: A.deposit, basis: "item declared not returned by lender" });
      if (!report.renter_agrees_not_returned) {
        escalations.push({ what: "not_returned", to: "arbiter", reason: "renter has not agreed; arbiter must confirm before cancel_after" });
        if (!arbiter?.not_returned_confirmed) { lines.pop(); notes.push("not_returned contested and unconfirmed: nothing kept for it"); }
        else total = A.deposit;
      } else total = A.deposit;
    }
    return verdict(total >= A.deposit ? "forfeit" : "overdue", total);
  }

  let total = 0;
  // 3a. Late fee, from the schedule.
  if (returnedAt > deadline) {
    const hours = Math.ceil((returnedAt - deadline) / HOUR_MS);
    const fee = Math.min(A.lateFeeCap, hours * A.lateFeePerHour);
    if (fee > 0) { lines.push({ kind: "late", drops: fee, basis: `${hours} h late x ${A.lateFeePerHour} drops/h, cap ${A.lateFeeCap}` }); total += fee; }
  }
  // 3b. Missing accessories, only those priced in the agreement.
  for (const name of report.missing ?? []) {
    const v = A.accessories[name];
    if (v == null) { notes.push(`missing "${name}" is not in the agreement: worth 0 (not found beats guessed)`); continue; }
    lines.push({ kind: "missing", drops: v, basis: `accessory "${name}" priced in agreement` }); total += v;
  }
  // 3c. Cleaning, if priced.
  if (report.dirty) {
    if (A.cleaningFee > 0) { lines.push({ kind: "cleaning", drops: A.cleaningFee, basis: "cleaning fee priced in agreement" }); total += A.cleaningFee; }
    else notes.push("dirty reported but no cleaning fee in agreement: 0");
  }
  // 3d. Damage: agreed by the renter, or decided by the arbiter. Never by the lender alone.
  for (const d of report.damage ?? []) {
    const claimed = toDrops(d.claimed_xrp ?? 0);
    if (d.renter_agrees === true) {
      lines.push({ kind: "damage", drops: claimed, basis: `"${d.desc}" agreed by renter` }); total += claimed; continue;
    }
    if (!A.arbiter) { notes.push(`damage "${d.desc}" contested and no arbiter in agreement: 0`); continue; }
    if (arbiter && arbiter.damage_xrp != null && arbiter.for === (d.desc ?? "")) {
      const amt = Math.min(claimed, toDrops(arbiter.damage_xrp));
      lines.push({ kind: "damage", drops: amt, basis: `"${d.desc}" set by arbiter ${A.arbiter.name ?? ""} at ${arbiter.damage_xrp} XRP (claim capped)` }); total += amt;
    } else {
      escalations.push({ what: `damage:${d.desc}`, to: A.arbiter.name ?? "arbiter", claimed_drops: claimed, deadline: new Date(cancelAfter).toISOString(), reason: "renter does not agree; silence before cancel_after = refund" });
    }
  }
  const status = escalations.length ? "awaiting_arbiter" : total === 0 ? "returned_clean" : "settled";
  return verdict(status, total);
}
