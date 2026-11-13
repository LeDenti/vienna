/**
 * vienna · the oracle. It holds the secrets of the tranches and applies the written rules.
 * It can move a tranche to the lender only by revealing a secret, and only when the rules say so.
 * It cannot touch the refund: that is the ledger's CancelAfter, open to anyone.
 * State: state/<id>.json (public record) and state/<id>.secrets.json (never committed).
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { newCondition } from "./condition.mjs";
import { settle, normaliseAgreement } from "./rules.mjs";

const DIR = new URL("../state/", import.meta.url).pathname;
const pub = (id) => `${DIR}${id}.json`;
const sec = (id) => `${DIR}${id}.secrets.json`;
const load = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null);
const save = (p, o) => { mkdirSync(DIR, { recursive: true }); writeFileSync(p, JSON.stringify(o, null, 2) + "\n"); };

/** Register a rental: mint one condition per tranche, keep the secrets, return the public record. */
export function register(agreement) {
  const A = normaliseAgreement(agreement);
  const pairs = Array.from({ length: A.tranches }, () => newCondition());
  const record = {
    agreement, tranches: pairs.map((p, i) => ({ i, condition: p.condition, sequence: null, status: "unlocked", tx: {} })),
    report: null, arbiter: null, verdicts: [], created_at: new Date().toISOString(),
  };
  save(pub(A.id), record);
  save(sec(A.id), { fulfillments: pairs.map((p) => p.fulfillment) });
  return record;
}

export const record = (id) => load(pub(id));
export function update(id, fn) { const r = load(pub(id)); fn(r); save(pub(id), r); return r; }

/** Apply the rules now. Returns the verdict plus the tranches to finish (with secrets revealed) and to cancel. */
export function decide(id, now = Date.now()) {
  const r = load(pub(id));
  const v = settle(r.agreement, r.report, now, r.arbiter);
  r.verdicts.push(v);
  save(pub(id), r);
  const secrets = load(sec(id)).fulfillments;
  const locked = r.tranches.filter((t) => t.status === "locked");
  const alreadyToLender = r.tranches.filter((t) => t.status === "to_lender").length;
  const stillOwed = Math.max(0, v.tranches_to_lender - alreadyToLender);
  const toFinish = v.status === "expired_refund" ? [] : locked.slice(0, stillOwed).map((t) => ({ ...t, fulfillment: secrets[t.i] }));
  const pastCancel = now >= Date.parse(v.cancel_after);
  const toCancel = pastCancel ? locked.filter((t) => !toFinish.some((f) => f.i === t.i)).map((t) => t.sequence) : [];
  return { verdict: v, toFinish, toCancel };
}
