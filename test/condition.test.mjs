import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import cc from "five-bells-condition";
import { newCondition } from "../src/condition.mjs";

test("condition encoding matches five-bells-condition on 50 random secrets", () => {
  for (let i = 0; i < 50; i++) {
    const p = randomBytes(32);
    const ours = newCondition(p);
    const f = new cc.PreimageSha256();
    f.setPreimage(p);
    assert.equal(ours.condition, f.getConditionBinary().toString("hex").toUpperCase());
    assert.equal(ours.fulfillment, f.serializeBinary().toString("hex").toUpperCase());
    const back = cc.fromFulfillmentBinary(Buffer.from(ours.fulfillment, "hex"));
    assert.equal(back.getConditionBinary().toString("hex").toUpperCase(), ours.condition);
    assert.ok(back.validate());
  }
});
