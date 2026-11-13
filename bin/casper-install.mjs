#!/usr/bin/env node
/**
 * Install vienna_escrow on the Casper testnet from the committed build, paid by the oracle key.
 * Writes contracts/casper/deployment.json: contract hash, install deploy, cost, commit, wasm hashes.
 *   VIENNA_CHAIN=casper node bin/casper-install.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import * as C from "../src/ledger/casper.mjs";

const ROOT = new URL("../", import.meta.url).pathname;
const wasm = `${ROOT}contracts/casper/build/vienna_escrow.wasm`;
const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
const git = (cmd) => execSync(`git ${cmd}`, { cwd: ROOT }).toString().trim();

const client = await C.connect();
const w = await C.loadWallets(client, console.log);
const before = await C.balanceUnits(client, w.oracle.address);
console.log(`installing ${wasm} (${readFileSync(wasm).length} bytes) from ${w.oracle.address}, balance ${C.fmt(before)} CSPR, limit ${C.fmt(C.PAYMENT.install)} CSPR`);
const res = await C.installContract(client, w.oracle, wasm);
const after = await C.balanceUnits(client, w.oracle.address);
const out = {
  chain: client.chainName, rpc: client.url, contract_hash: res.contract_hash, installer: w.oracle.address,
  install_deploy: res.hash, explorer: res.explorer, block: res.block,
  cost_motes: res.cost, consumed_motes: res.consumed, limit_motes: res.limit, charged_motes: String(before - after),
  commit: git("rev-parse HEAD"), tag: git("describe --tags --exact-match 2>/dev/null || echo untagged"),
  wasm_sha256: { vienna_escrow: sha(wasm), vienna_lock: sha(`${ROOT}contracts/casper/build/vienna_lock.wasm`) },
  installed_at: new Date().toISOString(),
};
writeFileSync(`${ROOT}contracts/casper/deployment.json`, JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify(out, null, 2));
