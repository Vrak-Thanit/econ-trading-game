import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "./firebase";

export const SHAPES = ["circle", "rectangle", "protractor", "equilateral", "triangle"] as const;
export type Shape = (typeof SHAPES)[number];
export type DemandMap = Record<Shape, number>;
export type PriceMap = Record<Shape, number>;

export type EconomyMode = "BOOM" | "NORMAL" | "SLOW";

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}
function roundInt(n: number) {
  return Math.round(Number.isFinite(n) ? n : 0);
}

export async function getSalesByShape(gameId: string, roundNumber: number): Promise<DemandMap> {
  const ref = collection(db, "games", gameId, "sales");
  const q = query(ref, where("roundNumber", "==", roundNumber));
  const snap = await getDocs(q);

  const out: any = {};
  for (const s of SHAPES) out[s] = 0;

  const toInt0 = (v: any) => {
    const n = Math.floor(Number(v));
    return Number.isFinite(n) ? Math.max(0, n) : 0;
  };

  snap.forEach((d) => {
    const row = d.data() as any;

    // shape might be stored as: shape OR item (some UIs write item)
    const shape = (row.shape ?? row.item) as Shape;
    if (!SHAPES.includes(shape)) return;

    // ✅ Prefer qtySold (so "delivered but not sold" can set qtySold = 0)
    // Fallbacks for older docs:
    const qtySold =
      row.qtySold ??            // NEW (recommended)
      row.acceptedQty ??        // your current field
      row.qty ??                // some UIs store this
      row.quantity ??           // extra fallback
      0;

    out[shape] += toInt0(qtySold);
  });

  return out as DemandMap;
}


/**
 * Suggest next-round demand based on last-round sales + economy mode.
 * - Uses last round SALES (acceptedQty) as the core signal
 * - Adds economy adjustment
 * - Small noise (-2..+2) optional, but kept tiny
 * - Smooths with last demand to avoid wild jumps
 */
export function suggestDemand(params: {
  lastSales: DemandMap;
  lastDemand: DemandMap;
  mode: EconomyMode;
  noise?: boolean;
}): DemandMap {
  const { lastSales, lastDemand, mode, noise = true } = params;

  const modeFactor = mode === "BOOM" ? 0.2 : mode === "SLOW" ? -0.15 : 0.05;

  const out: any = {};
  for (const s of SHAPES) {
    const S = Number(lastSales[s] ?? 0);
    const Dprev = Number(lastDemand[s] ?? 0);

    const n = noise ? (Math.floor(Math.random() * 5) - 2) : 0; // -2..+2
    const raw = S * (1 + modeFactor) + n;

    // smooth: 70% old demand + 30% new raw (stable classroom behavior)
    const smoothed = 0.7 * Dprev + 0.3 * raw;

    out[s] = clamp(roundInt(smoothed), 0, 9999);
  }

  return out as DemandMap;
}

/**
 * Compute next-round prices from base prices, next demand, and last sales.
 * ratio = demand_next / max(1, sales_last)
 * multiplier = clamp(0.6..1.6, 1 + k*(ratio-1))
 */
export function computeNextPrices(params: {
  basePrices: PriceMap;
  demandNext: DemandMap;
  salesLast: DemandMap;
  k?: number;        // sensitivity
  minMult?: number;  // price floor
  maxMult?: number;  // price cap
}): PriceMap {
  const { basePrices, demandNext, salesLast, k = 0.4, minMult = 0.6, maxMult = 1.6 } = params;

  const out: any = {};
  for (const s of SHAPES) {
    const Pbase = Number(basePrices[s] ?? 0);
    const Dn = Number(demandNext[s] ?? 0);
    const Sl = Number(salesLast[s] ?? 0);

    const ratio = Dn / Math.max(1, Sl);
    const mult = clamp(1 + k * (ratio - 1), minMult, maxMult);

    out[s] = Math.max(0, roundInt(Pbase * mult));
  }

  return out as PriceMap;
}
