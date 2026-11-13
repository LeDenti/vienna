// Money in drops (1 XRP = 1 000 000 drops), always integers. No floats cross a boundary.
export const DROPS = 1_000_000;
export const toDrops = (xrp) => {
  if (typeof xrp === "string") xrp = Number(xrp);
  if (!Number.isFinite(xrp) || xrp < 0) throw new Error(`bad XRP amount: ${xrp}`);
  return Math.round(xrp * DROPS);
};
export const toXrp = (drops) => (drops / DROPS).toFixed(6).replace(/\.?0+$/, "");
