export type IncomeTier = "HIGH" | "MIDDLE" | "POOR";

export function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

export function num(x: any) {
  const v = Number(x);
  return Number.isFinite(v) ? v : 0;
}

export function tierBaseLimit(tier: IncomeTier) {
  // You can adjust these numbers anytime
  if (tier === "HIGH") return 800;
  if (tier === "MIDDLE") return 600;
  return 500; // POOR
}

export function tierThreshold(tier: IncomeTier) {
  // Use starting cash as threshold (your design)
  if (tier === "HIGH") return 2000;
  if (tier === "MIDDLE") return 1000;
  return 500;
}

// ✅ The key: limit uses NetCash = cash - debt, so borrowing can't inflate it.
export function computeMaxDebt(params: {
  incomeTier: IncomeTier;
  cash: number;
  debt: number;
  reliability: number; // 0..100
}) {
  const base = tierBaseLimit(params.incomeTier);
  const threshold = tierThreshold(params.incomeTier);

  const netCash = params.cash - params.debt; // ✅ stable vs borrow exploit
  const extra = Math.max(0, netCash - threshold);

  // "More netCash → more credit", but controlled:
  // extraCredit = 30% of netCash above threshold
  const extraCredit = 0.3 * extra;

  // Cap extra credit so it doesn't explode (2× base max extra)
  const cappedExtra = Math.min(extraCredit, base * 2);

  // Reliability factor: 0.6..1.0
  const rel = clamp(params.reliability, 0, 100);
  const relFactor = 0.6 + 0.4 * (rel / 100);

  const maxDebt = (base + cappedExtra) * relFactor;
  return Math.floor(maxDebt);
}

export function computeBorrowable(params: {
  incomeTier: IncomeTier;
  cash: number;
  debt: number;
  reliability: number;
}) {
  const maxDebt = computeMaxDebt(params);
  return Math.max(0, maxDebt - Math.floor(params.debt));
}
