export function baseLimitByTier(tier: string) {
  if (tier === "HIGH") return 1500;
  if (tier === "MIDDLE") return 1000;
  return 800; // POOR
}

export function cashBaseByTier(tier: string) {
  if (tier === "HIGH") return 2000;
  if (tier === "MIDDLE") return 1000;
  return 500; // POOR
}

export function boostCapByTier(tier: string) {
  if (tier === "HIGH") return 1000;
  if (tier === "MIDDLE") return 700;
  return 500; // POOR
}

export function reliabilityFactor(rel: number) {
  if (rel >= 80) return 1.2;
  if (rel >= 50) return 1.0;
  return 0.7;
}

// Combined B + "cash strength" idea (no inventory valuation)
export function computeBorrowLimit(params: {
  incomeTier: string;
  cash: number;
  reliability: number;
}) {
  const tier = params.incomeTier ?? "MIDDLE";
  const cash = Number(params.cash ?? 0);
  const rel = Number(params.reliability ?? 100);

  const base = baseLimitByTier(tier);

  const cashBase = cashBaseByTier(tier);
  const extraCash = Math.max(0, cash - cashBase);
  const rawBoost = extraCash * 0.3; // 30% of extra cash becomes extra credit
  const boost = Math.min(rawBoost, boostCapByTier(tier));

  const factor = reliabilityFactor(rel);

  return Math.round((base + boost) * factor);
}
