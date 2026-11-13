// PREIMAGE-SHA-256 crypto-conditions (RFC draft-thomas-crypto-conditions), the only type XRPL escrows accept.
// Written from the spec; test/condition.test.mjs checks it against five-bells-condition.
import { createHash, randomBytes } from "node:crypto";

const der = (tag, body) => {
  if (body.length > 127) throw new Error("preimage too long for this encoder (<=127 bytes)");
  return Buffer.concat([Buffer.from([tag, body.length]), body]);
};

/** condition/fulfillment hex pair for a fresh 32-byte secret. */
export function newCondition(preimage = randomBytes(32)) {
  const digest = createHash("sha256").update(preimage).digest();
  // Condition: A0 <len> { 80 20 <fingerprint> 81 01 <cost> }  cost = preimage length
  const condition = der(0xa0, Buffer.concat([der(0x80, digest), der(0x81, Buffer.from([preimage.length]))]));
  // Fulfillment: A0 <len> { 80 <n> <preimage> }
  const fulfillment = der(0xa0, der(0x80, preimage));
  return { condition: condition.toString("hex").toUpperCase(), fulfillment: fulfillment.toString("hex").toUpperCase(), preimage: preimage.toString("hex") };
}

/** Minimum fee of a conditional EscrowFinish: 330 drops + 10 per 16 bytes of fulfillment, plus a margin. */
export const finishFeeDrops = (fulfillmentHex) => String(330 + 10 * Math.ceil(fulfillmentHex.length / 2 / 16) + 100);
