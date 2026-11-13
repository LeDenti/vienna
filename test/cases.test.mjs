import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { settle } from "../src/rules.mjs";

const files = readdirSync("cases").filter((f) => f.endsWith(".json")).sort();
assert.ok(files.length >= 20, "case file present");
for (const f of files) {
  const c = JSON.parse(readFileSync(`cases/${f}`, "utf8"));
  test(`case ${c.name}`, () => {
    if (c.expected.throws) {
      assert.throws(() => settle(c.agreement, c.report, c.now, c.arbiter), new RegExp(c.expected.throws));
      return;
    }
    const v = settle(c.agreement, c.report, c.now, c.arbiter);
    assert.equal(v.status, c.expected.status, `status (${JSON.stringify(v.lines)} ${v.notes})`);
    assert.equal(v.retention_drops, c.expected.retention_drops, "retention_drops");
    assert.equal(v.tranches_to_lender, c.expected.tranches_to_lender, "tranches_to_lender");
    assert.equal(v.tranches_to_lender + v.tranches_to_renter, (c.agreement.deposit_xrp / c.agreement.tranche_xrp), "tranches add up");
    assert.equal(v.refund_drops + v.retention_drops, c.agreement.deposit_xrp * 1_000_000, "money adds up");
  });
}
