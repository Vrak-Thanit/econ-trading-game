// src/ui/TeacherControls.tsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { db } from "../lib/firebase";
import {
  doc,
  onSnapshot,
  updateDoc,
  writeBatch,
  getDoc,
  collection,
  getDocs,
  serverTimestamp,
} from "firebase/firestore";

import { getLatestOrdersForRound } from "../lib/getLatestOrders";
import {
  SHAPES,
  type DemandMap,
  type EconomyMode,
  getSalesByShape,
  suggestDemand,
  computeNextPrices,
} from "../lib/roundEconomy";

import { computeInterestPreview } from "../lib/interestPolicy";


type ItemPrice = { buy?: number | null; rent?: number | null };
type ItemPrices = Record<string, ItemPrice>;

type GameDoc = {
  phase?: string;
  roundNumber?: number;
  finePerUnit?: number;

  baseInterestRate?: number;
  graceRateMultiplier?: number;

  shapeBasePrices?: Record<string, number>;

  // NOTE: these might be stored in different formats depending on your older data
  itemBasePrices?: any;
  itemPrices?: any;

  economyTotalCash?: number;
  economyBaselineCash?: number;
  economyIncomeIndex?: number;
  economyItemMult?: number;
  economyMode?: EconomyMode | string;

  activeAuctionId?: string | null;

  teamBaseState?: Record<
    string,
    {
      cash: number;
      debt: number;
      reliability: number;
      inventory: Record<string, number>;
      graceUntilRound?: number;
    }
  >;

  currentRound?: {
    demand?: Record<string, number>;
    remainingDemand?: Record<string, number>;
    prices?: Record<string, number>;
  };

  createdAt?: any;
  clonedFrom?: string;
};

function num(n: any) {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}

function zeroDemand(): DemandMap {
  const o: any = {};
  for (const s of SHAPES) o[s] = 0;
  return o as DemandMap;
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function toNumOrNull(v: any): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function formatPrice(v: number | null | undefined) {
  return v === null || v === undefined ? "N/A" : String(Math.round(v));
}

function normalizeShapeMap(raw: any, defaultVal: number) {
  const out: Record<string, number> = {};
  for (const s of SHAPES) out[s] = num(raw?.[s] ?? defaultVal);
  return out;
}

/**
 * Normalize item prices into:
 * {
 *   compass: { buy: 1000, rent: 330 },
 *   labor: { buy: null, rent: 300 }
 * }
 *
 * Supports older formats too:
 * 1) flat: { compass: 1000 }  -> treated as buy only
 * 2) dotted: { "compass.buy": 1000, "compass.rent": 330 }
 * 3) nested: { compass: { buy: 1000, rent: 330 } }
 */
function normalizeItemPrices(raw: any): ItemPrices {
  const out: ItemPrices = {};
  if (!raw || typeof raw !== "object") return out;

  const keys = Object.keys(raw);

  // dotted keys style
  const hasDotKeys = keys.some((k) => k.includes("."));
  if (hasDotKeys) {
    for (const k of keys) {
      const [item, field] = k.split(".");
      if (!item || (field !== "buy" && field !== "rent")) continue;
      out[item] = out[item] ?? {};
      out[item][field] = toNumOrNull(raw[k]);
    }
    return out;
  }

  // nested or flat
  for (const item of keys) {
    const v = raw[item];
    if (v && typeof v === "object" && !Array.isArray(v)) {
      out[item] = {
        buy: toNumOrNull(v.buy),
        rent: toNumOrNull(v.rent),
      };
    } else {
      // flat number => treat as buy only
      out[item] = { buy: toNumOrNull(v), rent: null };
    }
  }

  return out;
}

/**
 * Item prices move with overall cash in economy (proxy for aggregate income),
 * smoothed and capped to base ±20%.
 */
function computeNextItemPrices(opts: {
  baseItemPrices: ItemPrices;
  prevItemPrices: ItemPrices;
  totalCashNow: number;
  baselineTotalCash: number;
  alpha?: number;
  smooth?: number;
  minMult?: number;
  maxMult?: number;
}) {
  const {
    baseItemPrices,
    prevItemPrices,
    totalCashNow,
    baselineTotalCash,
    alpha = 0.35,
    smooth = 0.4,
    minMult = 0.8,
    maxMult = 1.2,
  } = opts;

  const baseTotal = baselineTotalCash > 0 ? baselineTotalCash : 1;
  const incomeIndex = totalCashNow / baseTotal;

  let mult = 1 + alpha * (incomeIndex - 1);
  mult = clamp(mult, minMult, maxMult);

  const next: ItemPrices = {};

  for (const item of Object.keys(baseItemPrices || {})) {
    const baseBuy = toNumOrNull(baseItemPrices[item]?.buy);
    const baseRent = toNumOrNull(baseItemPrices[item]?.rent);

    const prevBuy = toNumOrNull(prevItemPrices?.[item]?.buy) ?? baseBuy;
    const prevRent = toNumOrNull(prevItemPrices?.[item]?.rent) ?? baseRent;

    next[item] = next[item] ?? {};

    // BUY
    if (baseBuy === null) {
      next[item].buy = null;
    } else {
      const target = baseBuy * mult;
      let n = (prevBuy ?? baseBuy) * (1 - smooth) + target * smooth;
      n = clamp(n, baseBuy * minMult, baseBuy * maxMult);
      next[item].buy = Math.round(n);
    }

    // RENT
    if (baseRent === null) {
      next[item].rent = null;
    } else {
      const target = baseRent * mult;
      let n = (prevRent ?? baseRent) * (1 - smooth) + target * smooth;
      n = clamp(n, baseRent * minMult, baseRent * maxMult);
      next[item].rent = Math.round(n);
    }
  }

  return { nextItemPrices: next, incomeIndex, mult };
}

/**
 * Delete an entire subcollection in safe batches (Firestore batch limit = 500).
 */
async function deleteCollectionInBatches(colRef: any) {
  const snap = await getDocs(colRef);
  const docs = snap.docs;

  const CHUNK = 450;
  for (let i = 0; i < docs.length; i += CHUNK) {
    const batch = writeBatch(db);
    docs.slice(i, i + CHUNK).forEach((d: any) => batch.delete(d.ref));
    await batch.commit();
  }
}



/**
 * Clones /games/TEMPLATE into /games/{newGameId}
 */
async function cloneGameFromTemplate(newGameId: string) {
  const templateId = "TEMPLATE";

  if (!newGameId || newGameId.trim().length < 3) {
    throw new Error("Please enter a valid new gameId (at least 3 characters).");
  }
  newGameId = newGameId.trim();

  const templateRef = doc(db, "games", templateId);
  const newGameRef = doc(db, "games", newGameId);

  const templateSnap = await getDoc(templateRef);
  if (!templateSnap.exists()) throw new Error("TEMPLATE game doc not found.");

  const newGameSnap = await getDoc(newGameRef);
  if (newGameSnap.exists()) {
    throw new Error(`Game "${newGameId}" already exists. Choose another ID.`);
  }

  const t = templateSnap.data() as any;

  const templateTeamsRef = collection(db, "games", templateId, "teams");
  const teamsSnap = await getDocs(templateTeamsRef);

  const baseDemand = normalizeShapeMap(t?.currentRound?.demand, 0);

  const basePrices =
    t?.shapeBasePrices || t?.currentRound?.prices
      ? normalizeShapeMap(t?.shapeBasePrices ?? t?.currentRound?.prices, 0)
      : normalizeShapeMap(null, 0);

  const baseItemPrices = normalizeItemPrices(t?.itemBasePrices ?? t?.itemPrices ?? {});
  const baseItemCur = Object.keys(baseItemPrices).length > 0 ? baseItemPrices : normalizeItemPrices({});

  {
    const batch = writeBatch(db);
    batch.set(newGameRef, {
      ...t,
      phase: "INTERVAL",
      roundNumber: 0,
      activeAuctionId: null,
      economyMode: "NORMAL",

      currentRound: {
        demand: baseDemand,
        remainingDemand: baseDemand,
        prices: basePrices,
      },

      itemPrices: baseItemCur,

      economyTotalCash: 0,
      economyBaselineCash: 0,
      economyIncomeIndex: 1,
      economyItemMult: 1,

      createdAt: serverTimestamp(),
      clonedFrom: templateId,
    });

    await batch.commit();
  }

  const teamDocs = teamsSnap.docs;
  const CHUNK = 450;
  for (let i = 0; i < teamDocs.length; i += CHUNK) {
    const batch = writeBatch(db);
    const slice = teamDocs.slice(i, i + CHUNK);

    slice.forEach((teamDoc) => {
      const teamId = teamDoc.id;
      const teamData = teamDoc.data() as any;

      const newTeamRef = doc(db, "games", newGameId, "teams", teamId);
      batch.set(newTeamRef, {
        ...teamData,
        deliveredThisRound: zeroDemand(),
        finesPaid: 0,
        interestAccrued: 0,
        lastInterest: 0,
        lastInterestRound: -1,
        createdAt: serverTimestamp(),
      });
    });

    await batch.commit();
  }

  {
    const batch = writeBatch(db);
    const logRef = doc(collection(db, "games", newGameId, "logs"));
    batch.set(logRef, {
      type: "GAME_CREATED",
      createdAt: serverTimestamp(),
      message: `Game created from TEMPLATE: ${newGameId}`,
    });
    await batch.commit();
  }

  return { newGameId, teamsCopied: teamsSnap.size };
}

export default function TeacherControls({ gameId }: { gameId: string }) {
  const navigate = useNavigate();

  const [game, setGame] = useState<GameDoc | null>(null);
  const [draftDemand, setDraftDemand] = useState<DemandMap>(() => zeroDemand());

  const [err, setErr] = useState<string | null>(null);

  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const [mode, setMode] = useState<EconomyMode>("NORMAL");
  const [suggestMsg, setSuggestMsg] = useState<string | null>(null);

  const [jumpTo, setJumpTo] = useState<number>(0);
  

  const [newGameId, setNewGameId] = useState("");

  useEffect(() => {
    setErr(null);
    const ref = doc(db, "games", gameId);

    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) {
          setGame(null);
          setErr("Game not found.");
          return;
        }

        const data = snap.data() as GameDoc;
        setGame(data);

        const d = (data.currentRound?.demand ?? {}) as Record<string, number>;
        const normalized: any = {};
        for (const s of SHAPES) normalized[s] = num(d[s] ?? 0);

        if (!dirty) setDraftDemand(normalized as DemandMap);
      },
      (e) => setErr(e.message)
    );

    return () => unsub();
  }, [gameId, dirty]);

  const phase = game?.phase ?? "-";
  const round = game?.roundNumber ?? 0;

  const canStartRound = phase === "INTERVAL";
  const canEndRound = phase === "LIVE";

  const rows = useMemo(() => {
    return SHAPES.map((s) => ({
      shape: s,
      demand: num(draftDemand[s] ?? 0),
      remaining: num(game?.currentRound?.remainingDemand?.[s] ?? 0),
      price: num(game?.currentRound?.prices?.[s] ?? 0),
    }));
  }, [draftDemand, game]);

  const itemPriceRows = useMemo(() => {
    const base = normalizeItemPrices(game?.itemBasePrices);
    const cur = normalizeItemPrices(game?.itemPrices ?? game?.itemBasePrices);

    const names = Array.from(new Set([...Object.keys(base), ...Object.keys(cur)])).sort();

    return names.map((name) => ({
      name,
      buy: cur[name]?.buy ?? null,
      rent: cur[name]?.rent ?? null,
      baseBuy: base[name]?.buy ?? null,
      baseRent: base[name]?.rent ?? null,
    }));
  }, [game]);

    // ✅ Close round without settlement (LIVE -> INTERVAL)
  async function closeRoundNoSettle() {
    setErr(null);
    setSaveMsg(null);

    try {
      const gameRef = doc(db, "games", gameId);
      const snap = await getDoc(gameRef);
      if (!snap.exists()) throw new Error("Game not found");

      const g = snap.data() as any;
      if (String(g.phase ?? "") !== "LIVE") throw new Error("Close Round is only allowed during LIVE phase");

      await updateDoc(gameRef, {
        phase: "INTERVAL",
        roundClosedAt: serverTimestamp(),
      });

      // optional log
      const batch = writeBatch(db);
      const logRef = doc(collection(db, "games", gameId, "logs"));
      batch.set(logRef, {
        type: "ROUND_CLOSED_NO_SETTLE",
        roundNumber: Number(g.roundNumber ?? 0),
        createdAt: serverTimestamp(),
        message: `Teacher closed round without settlement (LIVE→INTERVAL).`,
      });
      await batch.commit();

      setSaveMsg("Round closed ✅ Now accept student work during INTERVAL.");
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    }
  }
  
  async function deleteAllOrders() {
    setErr(null);
    setSaveMsg(null);

    const ok = window.confirm(
      "Delete ALL orders?\n\nThis will wipe /games/{gameId}/orders.\nThis requires Firestore rules allowing teacher delete.\n\nContinue?"
    );
    if (!ok) return;

    try {
      await deleteCollectionInBatches(collection(db, "games", gameId, "orders"));

      const batch = writeBatch(db);
      const logRef = doc(collection(db, "games", gameId, "logs"));
      batch.set(logRef, {
        type: "ORDERS_DELETED",
        createdAt: serverTimestamp(),
        message: `Teacher deleted ALL orders (wipe).`,
      });
      await batch.commit();

      setSaveMsg("All orders deleted ✅");
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    }
  }

  async function deleteAllTrades() {
    setErr(null);
    setSaveMsg(null);

    const ok = window.confirm(
      "Delete ALL trades?\n\nThis will wipe /games/{gameId}/trades.\nThis requires Firestore rules allowing teacher delete.\n\nContinue?"
    );
    if (!ok) return;

    try {
      await deleteCollectionInBatches(collection(db, "games", gameId, "trades"));

      const batch = writeBatch(db);
      const logRef = doc(collection(db, "games", gameId, "logs"));
      batch.set(logRef, {
        type: "TRADES_DELETED",
        createdAt: serverTimestamp(),
        message: `Teacher deleted ALL trades (wipe).`,
      });
      await batch.commit();

      setSaveMsg("All trades deleted ✅");
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    }
  }

  async function endRoundSettlement() {
    setErr(null);

    try {
      const gameRef = doc(db, "games", gameId);
      const gameSnap = await getDoc(gameRef);
      if (!gameSnap.exists()) throw new Error("Game not found");

      const g = gameSnap.data() as any;
      if (g.phase !== "LIVE") throw new Error("End Round only allowed in LIVE phase");

      const roundNumber = Number(g.roundNumber ?? 0);
      const finePerUnit = Number(g.finePerUnit ?? 50);

      const baseRate = Number(g.baseInterestRate ?? 0.05);
      const graceMult = Number(g.graceRateMultiplier ?? 0);

      const latestOrders = await getLatestOrdersForRound(gameId, roundNumber);

      const orderedByTeam: Record<string, number> = {};
      for (const o of latestOrders) {
        orderedByTeam[o.teamId] = (orderedByTeam[o.teamId] ?? 0) + Number(o.plannedQty ?? 0);
      }

      const teamsRef = collection(db, "games", gameId, "teams");
      const teamsSnap = await getDocs(teamsRef);

      const batch = writeBatch(db);
      const summaryLines: string[] = [];

      teamsSnap.forEach((t) => {
        const teamId = t.id;
        const data = t.data() as any;

        const deliveredMap = data.deliveredThisRound ?? {};
        let deliveredTotal = 0;
        for (const s of SHAPES) deliveredTotal += Number(deliveredMap?.[s] ?? 0);

        const orderedTotal = Number(orderedByTeam[teamId] ?? 0);
        const shortfall = Math.max(0, orderedTotal - deliveredTotal);
        const fine = shortfall * finePerUnit;

        const prevReliability = Number(data.reliability ?? 100);
        const shortfallRate = shortfall / Math.max(1, orderedTotal);
        const drop = Math.round(shortfallRate * 20);
        const newReliability = Math.max(0, Math.min(100, prevReliability - drop));

        const prevCash = Number(data.cash ?? 0);
        const prevFines = Number(data.finesPaid ?? 0);

        const debt = Number(data.debt ?? 0);
        const graceUntilRound = Number(data.graceUntilRound ?? -1);
        const prevInterestAccrued = Number(data.interestAccrued ?? 0);

        const preview = computeInterestPreview({
          debt,
          baseRate,
          graceMult,
          roundNumber,
          graceUntilRound,
          reliability: prevReliability,
        });

        const interestDue = Number(preview.interestDue ?? 0);
        const newDebt = debt + interestDue;

        const teamRef = doc(db, "games", gameId, "teams", teamId);
        batch.update(teamRef, {
          cash: prevCash - fine,
          reliability: newReliability,
          finesPaid: prevFines + fine,

          debt: newDebt,
          interestAccrued: prevInterestAccrued + interestDue,
          lastInterest: interestDue,
          lastInterestRound: roundNumber,

          deliveredThisRound: zeroDemand(),
        });

        if (orderedTotal > 0 || deliveredTotal > 0 || debt > 0) {
          summaryLines.push(
            `${teamId}: ordered ${orderedTotal}, delivered ${deliveredTotal}, shortfall ${shortfall}, fine ${fine}, interest ${interestDue} (${(
              preview.effectiveRate * 100
            ).toFixed(1)}%${preview.inGrace ? ", grace" : ""}), debt ${debt}→${newDebt}, reliability ${prevReliability}→${newReliability}`
          );
        }
      });

      batch.update(gameRef, { phase: "INTERVAL" });

      const logRef = doc(collection(db, "games", gameId, "logs"));
      batch.set(logRef, {
        type: "ROUND_END",
        roundNumber,
        createdAt: serverTimestamp(),
        message: `End Round ${roundNumber}\n` + summaryLines.join("\n"),
      });

      await batch.commit();
      alert("Round ended + fines + interest applied ✅");
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    }
  }

  async function resetValuesOnly() {
    // ✅ NEW: confirmation guard
    const ok = window.confirm(
      `RESET VALUES ONLY?\n\nGame: ${gameId}\n\nThis will:\n- Set phase=INTERVAL\n- Set roundNumber=0\n- Reset demand/prices/itemPrices to base\n- Reset every team's cash/debt/reliability/inventory to teamBaseState\n- Clear deliveredThisRound/fines/interest\n\nContinue?`
    );
    if (!ok) return;

    setErr(null);
    setSaveMsg(null);
    setSuggestMsg(null);

    try {
      const gameRef = doc(db, "games", gameId);
      const snap = await getDoc(gameRef);
      if (!snap.exists()) throw new Error("Game not found");

      const g = snap.data() as GameDoc;

      if (!g.shapeBasePrices) throw new Error("Missing shapeBasePrices in game doc.");
      if (!g.itemBasePrices) throw new Error("Missing itemBasePrices in game doc.");
      if (!g.teamBaseState) throw new Error("Missing teamBaseState in game doc.");

      const baseDemand = zeroDemand();
      const baseItems = normalizeItemPrices(g.itemBasePrices);

      const batch = writeBatch(db);

      batch.update(gameRef, {
        phase: "INTERVAL",
        roundNumber: 0,
        economyMode: "NORMAL",
        "currentRound.demand": baseDemand,
        "currentRound.remainingDemand": baseDemand,
        "currentRound.prices": g.shapeBasePrices,
        itemPrices: baseItems,

        economyTotalCash: 0,
        economyBaselineCash: 0,
        economyIncomeIndex: 1,
        economyItemMult: 1,
      });

      for (const [teamId, base] of Object.entries(g.teamBaseState)) {
        const teamRef = doc(db, "games", gameId, "teams", teamId);
        batch.update(teamRef, {
          cash: Number(base.cash ?? 0),
          debt: Number(base.debt ?? 0),
          reliability: Number(base.reliability ?? 100),
          inventory: base.inventory ?? {},

          finesPaid: 0,
          interestAccrued: 0,
          lastInterest: 0,
          lastInterestRound: -1,

          graceUntilRound: Number(base.graceUntilRound ?? -1),

          deliveredThisRound: zeroDemand(),
        });
      }

      const logRef = doc(collection(db, "games", gameId, "logs"));
      batch.set(logRef, {
        type: "RESET_VALUES_ONLY",
        createdAt: serverTimestamp(),
        message: `Reset Values Only by teacher.`,
      });

      await batch.commit();

      setDraftDemand(baseDemand);
      setDirty(false);
      setMode("NORMAL");
      setSaveMsg("Reset Values Only complete ✅");
      alert("Reset Values Only complete ✅");
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    }
  }

  if (err) return <div style={{ color: "crimson" }}>{err}</div>;
  if (!game) return <div>Loading teacher controls...</div>;

  return (
    <div style={{ border: "1px solid #444", borderRadius: 12, padding: 12, maxWidth: 980 }}>
      <h3>Teacher Controls</h3>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
        <div>
          <b>Phase:</b> {phase}
        </div>
        <div>
          <b>Round:</b> {round}
        </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
  <b>Soft Jump (round):</b>
  <input
    type="number"
    min={0}
    value={jumpTo}
    onChange={(e) => setJumpTo(Math.max(0, Math.floor(Number(e.target.value || 0))))}
    style={{ width: 90, padding: 6 }}
  />

  <button
    style={{ padding: "8px 12px" }}
    onClick={async () => {
      setErr(null);
      setSaveMsg(null);

      try {
        const ok = window.confirm(
          `Soft Jump round?\n\nGame: ${gameId}\nSet roundNumber -> ${jumpTo}\n\nRecommended: only do this in INTERVAL.`
        );
        if (!ok) return;

        const gameRef = doc(db, "games", gameId);
        const snap = await getDoc(gameRef);
        if (!snap.exists()) throw new Error("Game not found");

        const g = snap.data() as any;

        // optional safety guard:
        if (String(g.phase ?? "") !== "INTERVAL") {
          throw new Error("Soft Jump is only allowed in INTERVAL phase (to avoid breaking LIVE round).");
        }

        await updateDoc(gameRef, {
          roundNumber: jumpTo,
          // Optional: keep interval so you don't accidentally start trading
          phase: "INTERVAL",
        });

        setSaveMsg(`Soft Jump complete ✅ Round is now ${jumpTo}`);
      } catch (e: any) {
        setErr(e?.message ?? String(e));
      }
    }}
  >
    Jump Round
  </button>
</div>

      </div>

      <div style={{ marginTop: 10, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <b>Economy:</b>
          <select value={mode} onChange={(e) => setMode(e.target.value as EconomyMode)}>
            <option value="BOOM">BOOM</option>
            <option value="NORMAL">NORMAL</option>
            <option value="SLOW">SLOW</option>
          </select>
        </label>

        <button
          style={{ padding: "8px 12px" }}
          onClick={async () => {
            setErr(null);
            setSuggestMsg(null);
            try {
              const gref = doc(db, "games", gameId);
              const gsnap = await getDoc(gref);
              if (!gsnap.exists()) throw new Error("Game not found");
              const g = gsnap.data() as any;

              const lastRound = Math.max(0, Number(g.roundNumber ?? 0) - 1);
              const lastSales = await getSalesByShape(gameId, lastRound);

              const lastDemandRaw = (g.currentRound?.demand ?? {}) as Record<string, number>;
              const lastDemand: any = {};
              for (const s of SHAPES) lastDemand[s] = Number(lastDemandRaw[s] ?? 0);

              const suggested = suggestDemand({
                lastSales,
                lastDemand: lastDemand as DemandMap,
                mode,
                noise: true,
              });

              setDraftDemand(suggested);
              setDirty(true);
              setSuggestMsg("Suggested demand generated ✅ (you can edit before saving)");
            } catch (e: any) {
              setErr(e?.message ?? String(e));
            }
          }}
        >
          Suggest Demand
        </button>

        {suggestMsg && <span style={{ color: "lightgreen" }}>{suggestMsg}</span>}
      </div>

      <h4 style={{ marginTop: 12 }}>Set demand for next round</h4>

      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr>
            <th style={{ borderBottom: "1px solid #444", textAlign: "left", padding: 6 }}>Shape</th>
            <th style={{ borderBottom: "1px solid #444", textAlign: "right", padding: 6 }}>Price</th>
            <th style={{ borderBottom: "1px solid #444", textAlign: "right", padding: 6 }}>Remaining</th>
            <th style={{ borderBottom: "1px solid #444", textAlign: "right", padding: 6 }}>Demand (edit)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.shape}>
              <td style={{ padding: 6 }}>{r.shape}</td>
              <td style={{ padding: 6, textAlign: "right" }}>{r.price}</td>
              <td style={{ padding: 6, textAlign: "right" }}>{r.remaining}</td>
              <td style={{ padding: 6, textAlign: "right" }}>
                <input
                  type="number"
                  min={0}
                  value={r.demand}
                  onChange={(e) => {
                    setDirty(true);
                    setSaveMsg(null);
                    setErr(null);
                    setDraftDemand((prev) => ({
                      ...prev,
                      [r.shape]: Math.max(0, Number(e.target.value || 0)),
                    }));
                  }}
                  style={{ width: 90, padding: 6, textAlign: "right" }}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ marginTop: 16, border: "1px solid #333", borderRadius: 12, padding: 12 }}>
        <h4 style={{ marginTop: 0 }}>Item Market Prices (Teacher View)</h4>

        <div style={{ opacity: 0.85, marginBottom: 10 }}>
          Economy index (cash vs baseline): <b>{num(game.economyIncomeIndex ?? 1).toFixed(2)}</b> | Item multiplier:{" "}
          <b>{num(game.economyItemMult ?? 1).toFixed(2)}</b>
        </div>

        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th style={{ borderBottom: "1px solid #444", textAlign: "left", padding: 6 }}>Item</th>
              <th style={{ borderBottom: "1px solid #444", textAlign: "right", padding: 6 }}>Buy</th>
              <th style={{ borderBottom: "1px solid #444", textAlign: "right", padding: 6 }}>Rent</th>
              <th style={{ borderBottom: "1px solid #444", textAlign: "right", padding: 6 }}>Base Buy</th>
              <th style={{ borderBottom: "1px solid #444", textAlign: "right", padding: 6 }}>Base Rent</th>
            </tr>
          </thead>
          <tbody>
            {itemPriceRows.length === 0 ? (
              <tr>
                <td style={{ padding: 6, opacity: 0.8 }} colSpan={5}>
                  No itemBasePrices found on game doc.
                </td>
              </tr>
            ) : (
              itemPriceRows.map((it) => (
                <tr key={it.name}>
                  <td style={{ padding: 6 }}>{it.name}</td>
                  <td style={{ padding: 6, textAlign: "right" }}>{formatPrice(it.buy)}</td>
                  <td style={{ padding: 6, textAlign: "right" }}>{formatPrice(it.rent)}</td>
                  <td style={{ padding: 6, textAlign: "right", opacity: 0.85 }}>{formatPrice(it.baseBuy)}</td>
                  <td style={{ padding: 6, textAlign: "right", opacity: 0.85 }}>{formatPrice(it.baseRent)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          style={{ padding: "8px 12px" }}
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            setErr(null);
            setSaveMsg(null);

            try {
              const ref = doc(db, "games", gameId);
              await updateDoc(ref, { "currentRound.demand": draftDemand });
              setSaveMsg("Saved to Firestore ✅");
              setDirty(false);
            } catch (e: any) {
              setErr(e?.message ?? String(e));
            } finally {
              setSaving(false);
            }
          }}
        >
          {saving ? "Saving..." : "Save Demand"}
        </button>

        <button
          style={{ padding: "8px 12px" }}
          disabled={!canStartRound}
          onClick={async () => {
            if (!canStartRound) return;

            setErr(null);
            try {
              const gameRef = doc(db, "games", gameId);
              const gameSnap = await getDoc(gameRef);
              if (!gameSnap.exists()) throw new Error("Game not found");
              const g = gameSnap.data() as any;

              if (g.phase !== "INTERVAL") throw new Error("Start Round only allowed in INTERVAL phase");

              const nextRound = (Number(g.roundNumber ?? 0) || 0) + 1;

              const salesLast = await getSalesByShape(gameId, nextRound - 1);

              const baseRaw = (g.shapeBasePrices ?? {}) as Record<string, number>;
              const base: any = {};
              for (const s of SHAPES) base[s] = Number(baseRaw[s] ?? 0);

              const targetPrices = computeNextPrices({
                basePrices: base,
                demandNext: draftDemand,
                salesLast,
                k: 0.15,
                minMult: 0.8,
                maxMult: 1.2,
              });

              const prevPricesRaw = (g.currentRound?.prices ?? {}) as Record<string, number>;
              const pricesNext: any = {};

              for (const s of SHAPES) {
                const baseP = Number(base[s] ?? 0);
                const prevP = Number(prevPricesRaw[s] ?? baseP);
                const targetP = Number(targetPrices[s] ?? prevP);

                let nextP = Math.round(prevP * 0.85 + targetP * 0.15);

                const minP = Math.round(baseP * 0.8);
                const maxP = Math.round(baseP * 1.2);
                nextP = Math.max(minP, Math.min(maxP, nextP));

                pricesNext[s] = nextP;
              }

              const baseItemPrices = normalizeItemPrices(g.itemBasePrices ?? {});
              const prevItemPrices = normalizeItemPrices(g.itemPrices ?? g.itemBasePrices ?? {});

              const baseState = (g.teamBaseState ?? {}) as Record<string, { cash?: number }>;
              const baselineTotalCash = Object.values(baseState).reduce((sum, t) => sum + Number(t?.cash ?? 0), 0);

              const teamsRef = collection(db, "games", gameId, "teams");
              const teamsSnap = await getDocs(teamsRef);
              let totalCashNow = 0;
              teamsSnap.forEach((d) => {
                const td = d.data() as any;
                totalCashNow += Number(td.cash ?? 0);
              });

              const { nextItemPrices, incomeIndex, mult } = computeNextItemPrices({
                baseItemPrices,
                prevItemPrices,
                totalCashNow,
                baselineTotalCash,
                alpha: 0.35,
                smooth: 0.4,
                minMult: 0.8,
                maxMult: 1.2,
              });

              await updateDoc(gameRef, {
                phase: "LIVE",
                roundNumber: nextRound,
                "currentRound.demand": draftDemand,
                "currentRound.remainingDemand": draftDemand,
                "currentRound.prices": pricesNext,

                itemPrices: nextItemPrices,

                economyTotalCash: totalCashNow,
                economyBaselineCash: baselineTotalCash,
                economyIncomeIndex: Number(incomeIndex.toFixed(4)),
                economyItemMult: Number(mult.toFixed(4)),

                economyMode: mode,
              });

              setSaveMsg("Round started ✅ shape + item prices updated (±20% cap, smooth 0.40)");
              setDirty(false);
            } catch (e: any) {
              setErr(e?.message ?? String(e));
            }
          }}
        >
          Start Round (Auto Price)
        </button>

       <button
  style={{ padding: "8px 12px" }}
  disabled={!canEndRound}
  onClick={endRoundSettlement}
>
  End Round (Settlement)
</button>

<button
  style={{ padding: "8px 12px" }}
  disabled={!canEndRound}
  onClick={closeRoundNoSettle}
>
  Close Round (Go INTERVAL)
</button>

        <button style={{ padding: "8px 12px", border: "1px solid #888" }} onClick={resetValuesOnly}>
          Reset Values Only
        </button>

        <button style={{ padding: "8px 12px", border: "1px solid orange" }} onClick={deleteAllOrders}>
          Delete ALL Orders (wipe)
        </button>

        <button style={{ padding: "8px 12px", border: "1px solid #f43f5e" }} onClick={deleteAllTrades}>
          Delete ALL Trades (wipe)
        </button>
      </div>

      <div style={{ marginTop: 16, border: "1px solid #333", borderRadius: 12, padding: 12 }}>
        <h4 style={{ marginTop: 0 }}>Create New Class Game (Clone TEMPLATE)</h4>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <b>New gameId:</b>

          <input
            value={newGameId}
            onChange={(e) => setNewGameId(e.target.value)}
            placeholder="Example: ECO202-M4-2026"
            style={{ width: 240, padding: 8 }}
          />

          <button
            style={{ padding: "8px 12px", border: "1px solid #66f" }}
            onClick={async () => {
              setErr(null);
              setSaveMsg(null);

              try {
                const ok = window.confirm(
                  `Create new game from TEMPLATE?\n\nNew gameId: ${newGameId.trim()}\n\nThis will copy TEMPLATE + teams.`
                );
                if (!ok) return;

                const res = await cloneGameFromTemplate(newGameId);

                  setSaveMsg(`Created ✅ ${res.newGameId} | Teams copied: ${res.teamsCopied}`);

                  alert(
                    `Created ✅ ${res.newGameId}\nTeams copied: ${res.teamsCopied}\n\nOpening the new game now.`
                  );

                  navigate(`/game/${encodeURIComponent(res.newGameId)}`);
              } catch (e: any) {
                setErr(e?.message ?? String(e));
              }
            }}
          >
            Clone from TEMPLATE
          </button>
        </div>

        <div style={{ marginTop: 8, opacity: 0.8 }}>
          Students will join using the new <b>gameId</b>. Orders/trades/logs/etc start fresh because subcollections aren’t
          copied.
        </div>
      </div>

      {!canEndRound && (
        <div style={{ marginTop: 8, opacity: 0.8 }}>
          End Round is only available during <b>LIVE</b> phase.
        </div>
      )}
      {!canStartRound && (
        <div style={{ marginTop: 6, opacity: 0.8 }}>
          Start Round is only available during <b>INTERVAL</b> phase.
        </div>
      )}

      {saveMsg && <div style={{ marginTop: 8, color: "lightgreen" }}>{saveMsg}</div>}
      {err && <div style={{ marginTop: 8, color: "crimson" }}>{err}</div>}

      <small style={{ opacity: 0.8 }}>
        Start Round updates shape prices + item prices (smooth 0.40, capped ±20%). End Round applies fines + reliability +
        interest.
      </small>
    </div>
  );
}
