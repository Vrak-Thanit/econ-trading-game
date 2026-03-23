// src/lib/interestPolicy.ts

export function num(n: any) {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Reliability → interest multiplier
 *  - 100 reliability => 0.80x (cheaper)
 *  - 0 reliability   => 1.20x (more expensive)
 *
 * This matches the "5% base -> 4%" pattern you saw.
 */
export function reliabilityToMultiplier(reliability: number) {
  const r = clamp(num(reliability), 0, 100);
  // linear: r=100 => 0.8, r=0 => 1.2
  return 1.2 - 0.004 * r;
}

export function computeInterestPreview(args: {
  debt: number;
  baseRate: number;          // e.g. 0.05
  graceMult: number;         // 0 = free grace, 0.5 half interest, etc.
  roundNumber: number;       // the round being ended
  graceUntilRound: number;   // inclusive end of grace window
  reliability: number;
}) {
  const debt = Math.max(0, num(args.debt));
  const baseRate = Math.max(0, num(args.baseRate));
  const graceMult = Math.max(0, num(args.graceMult));
  const roundNumber = Math.floor(num(args.roundNumber));
  const graceUntilRound = Math.floor(num(args.graceUntilRound));
  const reliability = clamp(num(args.reliability), 0, 100);

  // Normal rate adjusted by reliability
  const relMult = reliabilityToMultiplier(reliability);
  let effectiveRate = baseRate * relMult;

  // ✅ IMPORTANT: grace is only meaningful when debt > 0
  // ✅ IMPORTANT: inclusive check so graceUntilRound=1 includes round 1
  const inGrace = debt > 0 && graceUntilRound >= 0 && roundNumber <= graceUntilRound;

  if (inGrace) {
    effectiveRate = effectiveRate * graceMult; // graceMult=0 => 0% interest
  }

  const interestDue = Math.max(0, Math.round(debt * effectiveRate));

  return {
    inGrace,
    effectiveRate,
    interestDue,
    relMult,
  };
}
