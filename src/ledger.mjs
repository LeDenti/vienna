/**
 * vienna · the XRP Ledger side. Testnet by default.
 * A deposit = N escrows ("tranches") from the renter to the lender, each with
 *   - a PREIMAGE-SHA-256 Condition whose secret only the oracle holds (so only the oracle's
 *     written verdict can move a tranche to the lender), and
 *   - a CancelAfter (so after the dispute window ANYONE can send every untouched tranche
 *     back to the renter: the refund needs nobody's goodwill).
 * Native XRP only: no trust line, no issuer, no freeze. Honest limit: tranche granularity.
 */
import xrpl from "xrpl";
import { finishFeeDrops } from "./condition.mjs";

export const TESTNET = process.env.XRPL_URL || "wss://s.altnet.rippletest.net:51233";
export const explorerTx = (hash) => `https://testnet.xrpl.org/transactions/${hash}`;
export const explorerAccount = (addr) => `https://testnet.xrpl.org/accounts/${addr}`;

export async function connect(url = TESTNET) {
  const client = new xrpl.Client(url);
  await client.connect();
  return client;
}

export const rippleTime = (ms) => xrpl.unixTimeToRippleTime(ms);

export async function balanceDrops(client, address) {
  try { return Math.round(Number(await client.getXrpBalance(address)) * 1_000_000); }
  catch { return 0; }
}

/** Fund (or top up) a testnet wallet from the faucet. */
export async function fundedWallet(client, seed) {
  if (seed) {
    const w = xrpl.Wallet.fromSeed(seed);
    const bal = await balanceDrops(client, w.address);
    if (bal >= 20_000_000) return w;
    await client.fundWallet(w);
    return w;
  }
  const { wallet } = await client.fundWallet();
  return wallet;
}

/** Sign and submit several transactions from one account in parallel, consecutive sequences. */
async function submitMany(client, wallet, txs) {
  if (!txs.length) return [];
  const first = await client.autofill({ ...txs[0], Account: wallet.address });
  const lastLedger = (await client.getLedgerIndex()) + 40;
  const signed = txs.map((tx, i) => wallet.sign({ ...tx, Account: wallet.address, Sequence: first.Sequence + i, Fee: tx.Fee ?? first.Fee, LastLedgerSequence: lastLedger }));
  const hashes = [];
  for (const s of signed) {
    const r = await client.submit(s.tx_blob);
    if (!String(r.result.engine_result).startsWith("tes") && r.result.engine_result !== "terQUEUED")
      throw new Error(`submit: ${r.result.engine_result} ${r.result.engine_result_message}`);
    hashes.push(s.hash);
  }
  const out = [];
  for (const [i, hash] of hashes.entries()) out.push({ ...(await waitValidated(client, hash, lastLedger)), sequence: first.Sequence + i });
  return out;
}

async function waitValidated(client, hash, lastLedger) {
  for (;;) {
    try {
      const r = await client.request({ command: "tx", transaction: hash });
      if (r.result.validated) {
        const code = r.result.meta?.TransactionResult;
        if (code !== "tesSUCCESS") throw new Error(`${hash}: ${code}`);
        return { hash, ledger: r.result.ledger_index, result: code };
      }
    } catch (e) { if (!/txnNotFound/.test(String(e.message ?? e)) && !(e.data?.error === "txnNotFound")) throw e; }
    if ((await client.getLedgerIndex()) > lastLedger) throw new Error(`${hash} not validated before ledger ${lastLedger}`);
    await new Promise((r) => setTimeout(r, 1000));
  }
}

/** Lock the deposit: one EscrowCreate per tranche. Returns [{sequence, hash, ledger}]. */
export async function lockTranches(client, renter, lenderAddress, trancheDrops, conditions, cancelAfterMs, memo) {
  const txs = conditions.map((condition) => ({
    TransactionType: "EscrowCreate", Destination: lenderAddress, Amount: String(trancheDrops),
    Condition: condition, CancelAfter: rippleTime(cancelAfterMs),
    Memos: [{ Memo: { MemoType: Buffer.from("vienna/deposit").toString("hex").toUpperCase(), MemoData: Buffer.from(memo).toString("hex").toUpperCase() } }],
  }));
  return submitMany(client, renter, txs);
}

/** Move tranches to the lender: EscrowFinish with the revealed secrets. Submitter = the oracle (pays the fee). */
export async function finishTranches(client, submitter, ownerAddress, tranches /* [{sequence, condition, fulfillment}] */) {
  const txs = tranches.map((t) => ({
    TransactionType: "EscrowFinish", Owner: ownerAddress, OfferSequence: t.sequence,
    Condition: t.condition, Fulfillment: t.fulfillment, Fee: finishFeeDrops(t.fulfillment),
  }));
  return submitMany(client, submitter, txs);
}

/** Send tranches back to the renter: EscrowCancel, allowed to anyone once CancelAfter has passed. */
export async function cancelTranches(client, submitter, ownerAddress, sequences) {
  const txs = sequences.map((seq) => ({ TransactionType: "EscrowCancel", Owner: ownerAddress, OfferSequence: seq }));
  return submitMany(client, submitter, txs);
}

/** Escrows an account still owns on the ledger. */
export async function openEscrows(client, address) {
  const r = await client.request({ command: "account_objects", account: address, type: "escrow", ledger_index: "validated" });
  return r.result.account_objects;
}

/** Wait until a validated ledger has closed strictly after the given unix ms. */
export async function waitPast(client, ms, onTick) {
  for (;;) {
    const l = await client.request({ command: "ledger", ledger_index: "validated" });
    const closeMs = xrpl.rippleTimeToUnixTime(l.result.ledger.close_time);
    if (closeMs > ms + 1000) return closeMs;
    onTick?.(Math.ceil((ms - closeMs) / 1000));
    await new Promise((r) => setTimeout(r, 2000));
  }
}
