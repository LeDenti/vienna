/**
 * vienna · the Casper side (testnet, protocol 2.x, legacy Deploy + VM1 contract).
 * Casper has no native escrow: the deposit is held by `contracts/casper/vienna_escrow`, an immutable
 * contract (locked package, no access key kept) with one purse per tranche. Same five functions and the
 * same semantics as the XRPL adapter:
 *   lockTranches   one `vienna_lock` session deploy per tranche, signed by the renter
 *   finishTranches `finish(renter, id, preimage)` by anyone holding the secret, before cancel_after
 *   cancelTranches `cancel(renter, id)` by anyone, at or after cancel_after
 *   openEscrows    the contract's per-renter index, tranches still pending or locked
 *   waitPast       the chain's own block timestamps
 * Units: motes (1 CSPR = 1e9 motes). Costs: what the chain charged, read from the execution result.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import sdk from "casper-js-sdk";
import { digestOf, preimageOf } from "../condition.mjs";

const { RpcClient, HttpHandler, PrivateKey, PublicKey, KeyAlgorithm, Deploy, DeployHeader, ExecutableDeployItem, StoredContractByHash,
  ContractHash, Args, CLValue, Key, PurseIdentifier, Duration, makeCsprTransferDeploy } = sdk;

export const CHAIN = "casper";
export const COIN = "CSPR";
export const UNIT = 1_000_000_000; // motes per CSPR
export const CHAIN_NAME = process.env.CASPER_CHAIN_NAME || "casper-test";
export const RPC_URL = process.env.CASPER_RPC_URL || "https://node.testnet.casper.network/rpc";
export const WALLETS_FILE = new URL("../../state/demo.casper.wallets.json", import.meta.url).pathname;
const ROOT = new URL("../../", import.meta.url).pathname;
const DEPLOYMENT_FILE = `${ROOT}contracts/casper/deployment.json`;
const LOCK_WASM = `${ROOT}contracts/casper/build/vienna_lock.wasm`;

export const explorerTx = (hash) => `https://testnet.cspr.live/deploy/${hash}`;
export const explorerAccount = (addr) => `https://testnet.cspr.live/account/${addr}`;

/** Gas limits per act, in motes. The chain charges what is consumed plus 25% of the unused limit (testnet: refund 75%). */
export const PAYMENT = {
  install: BigInt(process.env.CASPER_PAY_INSTALL || 100n * BigInt(UNIT)),
  lock: BigInt(process.env.CASPER_PAY_LOCK || 5n * BigInt(UNIT)),
  finish: BigInt(process.env.CASPER_PAY_FINISH || 3_500_000_000n),
  cancel: BigInt(process.env.CASPER_PAY_CANCEL || 3_500_000_000n),
  transfer: 100_000_000n, // native transfer: fixed 0.1 CSPR
};

export async function connect(url = RPC_URL) {
  const rpc = new RpcClient(new HttpHandler(url));
  const status = await rpc.getStatus();
  if (status.chainSpecName !== CHAIN_NAME) throw new Error(`rpc is on ${status.chainSpecName}, expected ${CHAIN_NAME}`);
  return { rpc, url, chainName: status.chainSpecName, contract: contractHash(), disconnect: async () => {} };
}

/** Demo clocks: a deploy takes 10 to 30 s to execute here, five of them must fit before the due date. */
export const DEMO_CLOCKS = { due_s: 150, dispute_window_s: 180 };
/** Testnet chainspec: refund_handling = refund 75/100, so a deploy is charged consumed + 25% of the unused limit. */
export const REFUND_RATIO = [75n, 100n];

export function contractHash() {
  if (process.env.CASPER_CONTRACT) return process.env.CASPER_CONTRACT;
  return existsSync(DEPLOYMENT_FILE) ? JSON.parse(readFileSync(DEPLOYMENT_FILE, "utf8")).contract_hash : null;
}

/** A wallet = an ed25519 key. `address` is the public key hex (what the explorer and the faucet use). */
export function walletFromPem(pem) {
  const key = PrivateKey.fromPem(pem, KeyAlgorithm.ED25519);
  return { key, publicKey: key.publicKey, address: key.publicKey.toHex(), accountHash: key.publicKey.accountHash().toPrefixedString(), pem };
}
export const accountHashOf = (publicKeyHex) => PublicKey.fromHex(publicKeyHex).accountHash().toPrefixedString();

export async function balanceUnits(client, publicKeyHex) {
  try { return BigInt((await client.rpc.queryLatestBalance(PurseIdentifier.fromPublicKey(PublicKey.fromHex(publicKeyHex)))).balance.toString()); }
  catch (e) { if (/Purse not found|not found/i.test(String(e.message ?? e))) return 0n; throw e; }
}

/**
 * The three demo keys live in state/demo.casper.wallets.json (git-ignored, generated once).
 * There is no faucet API: the oracle key is funded by a human on testnet.cspr.live, then it tops up the others.
 */
export async function loadWallets(client, log = () => {}) {
  if (!existsSync(WALLETS_FILE)) {
    const out = {};
    for (const role of ["renter", "lender", "oracle"]) { const k = PrivateKey.generate(KeyAlgorithm.ED25519); out[role] = { private_key_pem: k.toPem(), public_key: k.publicKey.toHex(), account_hash: k.publicKey.accountHash().toPrefixedString() }; }
    writeFileSync(WALLETS_FILE, JSON.stringify(out, null, 2) + "\n");
  }
  const saved = JSON.parse(readFileSync(WALLETS_FILE, "utf8"));
  const w = Object.fromEntries(Object.entries(saved).map(([role, v]) => [role, walletFromPem(v.private_key_pem)]));
  const need = { renter: 150n * BigInt(UNIT), lender: 5n * BigInt(UNIT), oracle: 60n * BigInt(UNIT) };
  const bal = Object.fromEntries(await Promise.all(Object.keys(w).map(async (r) => [r, await balanceUnits(client, w[r].address)])));
  if (bal.oracle < need.oracle) throw new Error(`oracle ${w.oracle.address} has ${fmt(bal.oracle)} CSPR; fund it on https://testnet.cspr.live/tools/faucet (needs ${fmt(need.oracle + need.renter + need.lender)} CSPR for all three)`);
  for (const role of ["renter", "lender"]) {
    if (bal[role] >= need[role]) continue;
    const amount = need[role] - bal[role] + 5n * BigInt(UNIT);
    log(`funding ${role} with ${fmt(amount)} CSPR from the oracle`);
    await transfer(client, w.oracle, w[role].address, amount);
  }
  return w;
}

export const fmt = (motes) => (Number(motes) / UNIT).toFixed(4).replace(/\.?0+$/, "");

/** Native CSPR transfer (used only to split the faucet's grant between the demo keys). */
export async function transfer(client, from, toPublicKeyHex, motes) {
  const deploy = makeCsprTransferDeploy({ senderPublicKeyHex: from.address, recipientPublicKeyHex: toPublicKeyHex, transferAmount: String(motes), chainName: client.chainName });
  deploy.sign(from.key);
  return send(client, deploy, "transfer");
}

function makeDeploy(signer, session, paymentMotes, ttlMs = 30 * 60 * 1000) {
  const header = DeployHeader.default();
  header.account = signer.publicKey;
  header.chainName = CHAIN_NAME;
  header.ttl = new Duration(ttlMs);
  const deploy = Deploy.makeDeploy(header, ExecutableDeployItem.standardPayment(String(paymentMotes)), session);
  deploy.sign(signer.key);
  return deploy;
}

function contractCall(entryPoint, args) {
  const item = new ExecutableDeployItem();
  // The node wants the bare 64-hex hash here (as casper-client sends it); the SDK would pass "hash-…" through and get "Invalid params".
  item.storedContractByHash = new StoredContractByHash(ContractHash.newContract(contractHash().replace(/^(hash|contract)-/, "")), entryPoint, Args.fromMap(args));
  return item;
}

/** Submit, wait for execution, return {hash, block, cost (= the limit on payment_limited chains), consumed, limit, charged, error?}. Throws if the chain reports an error. */
export async function send(client, deploy, label, timeoutMs = 240_000) {
  const { deployHash } = await client.rpc.putDeploy(deploy);
  const hash = deployHash.toHex();
  const r = await client.rpc.waitForDeploy(deploy, timeoutMs);
  const raw = r.rawJSON?.execution_info?.execution_result ?? {};
  const v = raw.Version2 ?? raw.Version1?.Success ?? raw.Version1?.Failure ?? raw;
  const typed = r.executionInfo?.executionResult ?? {}; // the SDK's own parse, as a fallback
  const out = {
    label, hash, block: r.rawJSON?.execution_info?.block_height ?? r.executionInfo?.blockHeight ?? null,
    cost: String(v.cost ?? typed.cost ?? ""), consumed: String(v.consumed ?? typed.consumed ?? ""), limit: String(v.limit ?? typed.limit ?? ""),
    explorer: explorerTx(hash),
  };
  if (out.limit && out.consumed) { // what the account actually paid, once the refund is applied
    const unused = BigInt(out.limit) - BigInt(out.consumed);
    out.charged = String(BigInt(out.limit) - (unused * REFUND_RATIO[0]) / REFUND_RATIO[1]);
  }
  const error = v.error_message ?? raw.Version1?.Failure?.error_message ?? typed.errorMessage ?? null;
  if (error) { out.error = error; throw Object.assign(new Error(`${label} ${hash}: ${error}`), { result: out }); }
  return out;
}

const byteArray32 = (buf) => CLValue.newCLByteArray(new Uint8Array(buf));
const accountKey = (publicKeyHex) => CLValue.newCLKey(Key.newKey(accountHashOf(publicKeyHex)));

/** Lock the deposit: one `vienna_lock` session deploy per tranche, from the renter. Returns [{sequence: id, hash, block, cost}]. */
export async function lockTranches(client, renter, lenderAddress, trancheMotes, conditions, cancelAfterMs, memo) {
  const wasm = new Uint8Array(readFileSync(LOCK_WASM));
  const out = [];
  for (const [i, condition] of conditions.entries()) {
    const id = `${memo}/${i}`;
    const args = Args.fromMap({
      contract: CLValue.newCLKey(Key.newKey(contractHash())), id: CLValue.newCLString(id), lender: accountKey(lenderAddress),
      cancel_after_ms: CLValue.newCLUint64(Math.floor(cancelAfterMs)), condition: byteArray32(digestOf(condition)), amount: CLValue.newCLUInt512(String(trancheMotes)),
    });
    const deploy = makeDeploy(renter, ExecutableDeployItem.newModuleBytes(wasm, args), PAYMENT.lock);
    out.push({ ...(await send(client, deploy, "lock")), sequence: id });
  }
  return out;
}

/** Move tranches to the lender: `finish` with the revealed preimages. Submitter = whoever holds the secret (the oracle). */
export async function finishTranches(client, submitter, ownerAddress, tranches /* [{sequence, condition, fulfillment}] */) {
  const out = [];
  for (const t of tranches) {
    const session = contractCall("finish", { renter: accountKey(ownerAddress), id: CLValue.newCLString(t.sequence), preimage: byteArray32(preimageOf(t.fulfillment)) });
    out.push({ ...(await send(client, makeDeploy(submitter, session, PAYMENT.finish), "finish")), sequence: t.sequence });
  }
  return out;
}

/** Send tranches back to the renter: `cancel`, allowed to anyone once cancel_after has passed. */
export async function cancelTranches(client, submitter, ownerAddress, ids) {
  const out = [];
  for (const id of ids) {
    const session = contractCall("cancel", { renter: accountKey(ownerAddress), id: CLValue.newCLString(id) });
    out.push({ ...(await send(client, makeDeploy(submitter, session, PAYMENT.cancel), "cancel")), sequence: id });
  }
  return out;
}

async function dictionary(client, name) {
  const r = await client.rpc.queryLatestGlobalState(contractHash(), []);
  const nk = (r.rawJSON?.stored_value?.Contract?.named_keys ?? []).find((k) => k.name === name);
  if (!nk) throw new Error(`contract has no named key ${name}`);
  return nk.key;
}
async function dictGet(client, seed, key) {
  try { return (await client.rpc.getDictionaryItem(null, seed, key)).rawJSON?.stored_value?.CLValue?.parsed ?? null; }
  catch (e) { if (/not found|ValueNotFound|-32003/i.test(String(e.message ?? e))) return null; throw e; }
}

/** Tranches of a renter still held by the contract (status pending or locked), read from the on-chain index. */
export async function openEscrows(client, publicKeyHex) {
  const renterHex = accountHashOf(publicKeyHex).replace("account-hash-", "");
  const [index, tranches] = await Promise.all([dictionary(client, "index"), dictionary(client, "tranches")]);
  const n = Number((await dictGet(client, index, renterHex)) ?? 0);
  const open = [];
  for (let i = 0; i < n; i++) {
    const id = await dictGet(client, index, `${renterHex}:${i}`);
    const rec = await dictGet(client, tranches, `${renterHex}:${id}`);
    if (!rec) continue;
    const [[renter, lender, amount], [cancel_after_ms, condition, status]] = rec;
    if (status === 0 || status === 1) open.push({ id, renter: renter.Account, lender: lender.Account, amount, cancel_after_ms, condition, status });
  }
  return open;
}

/** Wait until the latest block's timestamp is strictly after the given unix ms. */
export async function waitPast(client, ms, onTick) {
  for (;;) {
    const b = await client.rpc.getLatestBlock();
    const t = Date.parse(b.rawJSON?.block?.Version2?.header?.timestamp ?? b.rawJSON?.block?.Version1?.header?.timestamp ?? b.block.timestamp?.toJSON?.() ?? b.block.timestamp);
    if (t > ms + 1000) return t;
    onTick?.(Math.ceil((ms - t) / 1000));
    await new Promise((r) => setTimeout(r, 4000));
  }
}

/** Install the contract (the deployer pays; nothing of it is kept but the contract hash under its named key `vienna_escrow`). */
export async function installContract(client, deployer, wasmPath) {
  const wasm = new Uint8Array(readFileSync(wasmPath));
  const deploy = makeDeploy(deployer, ExecutableDeployItem.newModuleBytes(wasm, Args.fromMap({})), PAYMENT.install, 60 * 60 * 1000);
  const res = await send(client, deploy, "install", 600_000);
  const acct = await client.rpc.queryLatestGlobalState(accountHashOf(deployer.address), []);
  const nk = (acct.rawJSON?.stored_value?.Account?.named_keys ?? []).find((k) => k.name === "vienna_escrow");
  if (!nk) throw new Error("install succeeded but no vienna_escrow named key on the deployer account");
  return { ...res, contract_hash: nk.key };
}
