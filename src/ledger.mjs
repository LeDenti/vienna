/**
 * vienna · which ledger holds the deposit. VIENNA_CHAIN=xrpl (default) | casper.
 * Every adapter exports the same five functions with the same semantics (docs/PORTING.md §1) plus
 * CHAIN, COIN, UNIT, fmt, balanceUnits, loadWallets, explorerTx, explorerAccount.
 */
export const CHAIN = process.env.VIENNA_CHAIN || "xrpl";
const adapters = { xrpl: "./ledger/xrpl.mjs", casper: "./ledger/casper.mjs" };
if (!adapters[CHAIN]) throw new Error(`VIENNA_CHAIN=${CHAIN}: expected one of ${Object.keys(adapters).join(", ")}`);
const m = await import(adapters[CHAIN]);
export const { COIN, UNIT, fmt, connect, loadWallets, balanceUnits, lockTranches, finishTranches, cancelTranches, openEscrows, waitPast, explorerTx, explorerAccount } = m;
