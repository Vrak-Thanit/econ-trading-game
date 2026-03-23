// src/ui/TeacherAuctionPanel.tsx
import { useEffect, useMemo, useState } from "react";
import { db } from "../lib/firebase";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  writeBatch,
  Timestamp,
} from "firebase/firestore";

type ItemPrice = { buy?: number | null; rent?: number | null };
type ItemPrices = Record<string, ItemPrice>;

function num(n: any) {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}
function clampInt(n: any) {
  const v = Math.floor(Number(n));
  return Number.isFinite(v) ? Math.max(0, v) : 0;
}

type GameDoc = {
  roundNumber?: number;
  activeAuctionId?: string | null;
  itemPrices?: any;
  itemBasePrices?: any;
};

type AuctionDoc = {
  status: "OPEN" | "CLOSED" | "SETTLED";
  roundNumber: number;
  lot: { kind: "ITEM"; itemKey: string; qty: number };
  minBid: number;
  endsAt: any;
  createdAt?: any;
  closedAt?: any;
  winnerTeamId?: string | null;
  winningBid?: number | null;
};

type BidDoc = { teamId: string; amount: number; updatedAt?: any };

function normalizeItemPrices(raw: any): ItemPrices {
  const out: ItemPrices = {};
  if (!raw || typeof raw !== "object") return out;

  const keys = Object.keys(raw);
  const hasDot = keys.some((k) => k.includes("."));

  if (hasDot) {
    for (const k of keys) {
      const [item, field] = k.split(".");
      if (!item || (field !== "buy" && field !== "rent")) continue;
      out[item] = out[item] ?? {};
      out[item][field] = raw[k] === null ? null : Number(raw[k]);
    }
    return out;
  }

  for (const item of keys) {
    const v = raw[item];
    if (v && typeof v === "object") {
      out[item] = { buy: v.buy ?? null, rent: v.rent ?? null };
    } else {
      out[item] = { buy: v ?? null, rent: null };
    }
  }
  return out;
}

export default function TeacherAuctionPanel({ gameId }: { gameId: string }) {
  const [game, setGame] = useState<GameDoc | null>(null);
  const [auction, setAuction] = useState<AuctionDoc | null>(null);
  const [bids, setBids] = useState<{ id: string; data: BidDoc }[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  // ✅ NEW: tick to force re-render every second (for live countdown)
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // create form
  const [itemKey, setItemKey] = useState<string>("");
  const [qty, setQty] = useState<number>(1);
  const [minBid, setMinBid] = useState<number>(50);
  const [durationSec, setDurationSec] = useState<number>(60);

  useEffect(() => {
    setErr(null);
    const gref = doc(db, "games", gameId);
    return onSnapshot(
      gref,
      (s) => {
        if (!s.exists()) return;
        const g = s.data() as GameDoc;
        setGame(g);
      },
      (e) => setErr(e.message)
    );
  }, [gameId]);

  // watch active auction doc + bids
  useEffect(() => {
    setAuction(null);
    setBids([]);
    if (!game?.activeAuctionId) return;

    const aref = doc(db, "games", gameId, "auctions", String(game.activeAuctionId));
    const unsubA = onSnapshot(
      aref,
      (s) => {
        if (!s.exists()) return;
        setAuction(s.data() as AuctionDoc);
      },
      (e) => setErr(e.message)
    );

    const bidsRef = collection(db, "games", gameId, "auctions", String(game.activeAuctionId), "bids");
    const qy = query(bidsRef, orderBy("amount", "desc"));
    const unsubB = onSnapshot(
      qy,
      (snap) => {
        const rows: any[] = [];
        snap.forEach((d) => rows.push({ id: d.id, data: d.data() as BidDoc }));
        setBids(rows);
      },
      (e) => setErr(e.message)
    );

    return () => {
      unsubA();
      unsubB();
    };
  }, [gameId, game?.activeAuctionId]);

  const itemOptions = useMemo(() => {
    const items = normalizeItemPrices(game?.itemPrices ?? game?.itemBasePrices ?? {});
    return Object.keys(items).sort();
  }, [game]);

  // auto-set first item
  useEffect(() => {
    if (!itemKey && itemOptions.length > 0) setItemKey(itemOptions[0]);
  }, [itemKey, itemOptions]);

  // ✅ UPDATED: secondsLeft recalculates every second using tick
  const secondsLeft = useMemo(() => {
    if (!auction?.endsAt) return null;
    const endMs =
      typeof auction.endsAt?.toMillis === "function"
        ? auction.endsAt.toMillis()
        : auction.endsAt?.seconds
        ? auction.endsAt.seconds * 1000
        : null;
    if (!endMs) return null;

    // tick forces this memo to recompute every second
    return Math.max(0, Math.floor((endMs - Date.now()) / 1000));
  }, [auction, tick]);

  async function createAndOpen() {
    setErr(null);
    setMsg(null);
    try {
      const gref = doc(db, "games", gameId);
      const gs = await getDoc(gref);
      if (!gs.exists()) throw new Error("Game not found");

      const roundNumber = num((gs.data() as any).roundNumber ?? 0);
      const aRef = doc(collection(db, "games", gameId, "auctions"));

      const endsAt = Timestamp.fromMillis(Date.now() + clampInt(durationSec) * 1000);

      const batch = writeBatch(db);

      batch.set(aRef, {
        status: "OPEN",
        roundNumber,
        lot: { kind: "ITEM", itemKey, qty: clampInt(qty) || 1 },
        minBid: clampInt(minBid),
        endsAt,
        createdAt: serverTimestamp(),
      });

      batch.update(gref, { activeAuctionId: aRef.id });

      const logRef = doc(collection(db, "games", gameId, "logs"));
      batch.set(logRef, {
        type: "AUCTION_OPEN",
        createdAt: serverTimestamp(),
        message: `R${roundNumber}: Auction OPEN item=${itemKey} qty=${qty} minBid=${minBid} duration=${durationSec}s`,
      });

      await batch.commit();
      setMsg("Auction opened ✅");
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    }
  }

  async function closeAuction() {
    setErr(null);
    setMsg(null);
    try {
      if (!game?.activeAuctionId) throw new Error("No active auction.");
      const aref = doc(db, "games", gameId, "auctions", String(game.activeAuctionId));
      await updateDoc(aref, { status: "CLOSED", closedAt: serverTimestamp() });
      setMsg("Auction closed ✅");
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    }
  }

  async function settleAuction() {
    setErr(null);
    setMsg(null);

    try {
      if (!game?.activeAuctionId) throw new Error("No active auction.");
      const auctionId = String(game.activeAuctionId);

      const aref = doc(db, "games", gameId, "auctions", auctionId);
      const aSnap = await getDoc(aref);
      if (!aSnap.exists()) throw new Error("Auction not found");
      const a = aSnap.data() as AuctionDoc;

      if (a.status !== "CLOSED") throw new Error("Settle only after CLOSED.");

      // read bids sorted
      const bidsRef = collection(db, "games", gameId, "auctions", auctionId, "bids");
      const bidsSnap = await getDocs(query(bidsRef, orderBy("amount", "desc")));
      const candidates: { teamId: string; amount: number }[] = [];
      bidsSnap.forEach((d) => {
        const bd = d.data() as any;
        candidates.push({ teamId: String(bd.teamId), amount: clampInt(bd.amount) });
      });

      if (candidates.length === 0) {
        // no bids -> settle empty
        const batch = writeBatch(db);
        batch.update(aref, { status: "SETTLED", winnerTeamId: null, winningBid: null });
        batch.update(doc(db, "games", gameId), { activeAuctionId: null });
        const logRef = doc(collection(db, "games", gameId, "logs"));
        batch.set(logRef, {
          type: "AUCTION_SETTLE",
          createdAt: serverTimestamp(),
          message: `R${a.roundNumber}: Auction SETTLED (no bids)`,
        });
        await batch.commit();
        setMsg("Settled: no bids ✅");
        return;
      }

      // settle with transaction: pick first team that can actually pay now
      await runTransaction(db, async (tx) => {
        const aNowSnap = await tx.get(aref);
        if (!aNowSnap.exists()) throw new Error("Auction missing");
        const aNow = aNowSnap.data() as AuctionDoc;

        if (aNow.status === "SETTLED") throw new Error("Already settled.");
        if (aNow.status !== "CLOSED") throw new Error("Auction must be CLOSED.");

        let winnerTeamId: string | null = null;
        let winningBid: number | null = null;

        for (const c of candidates) {
          const teamRef = doc(db, "games", gameId, "teams", c.teamId);
          const teamSnap = await tx.get(teamRef);
          if (!teamSnap.exists()) continue;

          const t = teamSnap.data() as any;
          const cash = num(t.cash ?? 0);
          if (c.amount <= 0) continue;

          // must afford
          if (cash >= c.amount) {
            winnerTeamId = c.teamId;
            winningBid = c.amount;

            const inv = { ...(t.inventory ?? {}) };
            const itemKey = aNow.lot?.itemKey;
            const qty = clampInt(aNow.lot?.qty) || 1;
            inv[itemKey] = clampInt(inv[itemKey] ?? 0) + qty;

            tx.update(teamRef, {
              cash: cash - c.amount,
              inventory: inv,
            });
            break;
          }
        }

        tx.update(aref, {
          status: "SETTLED",
          winnerTeamId,
          winningBid,
        });

        const gref = doc(db, "games", gameId);
        tx.update(gref, { activeAuctionId: null });

        const logRef = doc(collection(db, "games", gameId, "logs"));
        tx.set(logRef, {
          type: "AUCTION_SETTLE",
          createdAt: serverTimestamp(),
          message:
            winnerTeamId && winningBid != null
              ? `R${aNow.roundNumber}: Auction SETTLED winner=${winnerTeamId} bid=${winningBid} item=${aNow.lot.itemKey} qty=${aNow.lot.qty}`
              : `R${aNow.roundNumber}: Auction SETTLED (no valid payer)`,
        });
      });

      setMsg("Auction settled ✅");
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    }
  }

  return (
    <div style={{ marginTop: 16, border: "1px solid #333", borderRadius: 12, padding: 12 }}>
      <h4 style={{ marginTop: 0 }}>Auction (Teacher)</h4>

      {/* Create auction */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <label>
          Item{" "}
          <select value={itemKey} onChange={(e) => setItemKey(e.target.value)}>
            {itemOptions.map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
        </label>

        <label>
          Qty{" "}
          <input
            type="number"
            min={1}
            value={qty}
            onChange={(e) => setQty(clampInt(e.target.value) || 1)}
            style={{ width: 70, padding: 6 }}
          />
        </label>

        <label>
          Min bid{" "}
          <input
            type="number"
            min={0}
            value={minBid}
            onChange={(e) => setMinBid(clampInt(e.target.value))}
            style={{ width: 90, padding: 6 }}
          />
        </label>

        <label>
          Duration (sec){" "}
          <input
            type="number"
            min={10}
            value={durationSec}
            onChange={(e) => setDurationSec(clampInt(e.target.value) || 60)}
            style={{ width: 90, padding: 6 }}
          />
        </label>

        <button style={{ padding: "8px 12px" }} onClick={createAndOpen}>
          Create & Open
        </button>
      </div>

      {/* Active auction */}
      <div style={{ marginTop: 12, opacity: 0.9 }}>
        <b>Active:</b>{" "}
        {game?.activeAuctionId ? (
          <span>
            {game.activeAuctionId}{" "}
            {auction?.status ? (
              <span style={{ marginLeft: 8 }}>
                status=<b>{auction.status}</b>
              </span>
            ) : null}
            {secondsLeft != null ? (
              <span style={{ marginLeft: 10 }}>
                time left: <b>{secondsLeft}s</b>
              </span>
            ) : null}
          </span>
        ) : (
          <span style={{ opacity: 0.7 }}>none</span>
        )}
      </div>

      {auction && (
        <div style={{ marginTop: 8, opacity: 0.9 }}>
          Lot: <b>{auction.lot.itemKey}</b> × <b>{auction.lot.qty}</b> | Min bid: <b>{auction.minBid}</b> | Round:{" "}
          <b>{auction.roundNumber}</b>
        </div>
      )}

      <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button style={{ padding: "8px 12px" }} onClick={closeAuction} disabled={!auction || auction.status !== "OPEN"}>
          Close Auction
        </button>
        <button style={{ padding: "8px 12px" }} onClick={settleAuction} disabled={!auction || auction.status !== "CLOSED"}>
          Settle Auction
        </button>
      </div>

      {/* Bids table */}
      <div style={{ marginTop: 12 }}>
        <b>Bids:</b> {bids.length}
      </div>

      <table style={{ marginTop: 6, borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr>
            <th style={{ borderBottom: "1px solid #444", textAlign: "left", padding: 6 }}>Team</th>
            <th style={{ borderBottom: "1px solid #444", textAlign: "right", padding: 6 }}>Bid</th>
          </tr>
        </thead>
        <tbody>
          {bids.length === 0 ? (
            <tr><td colSpan={2} style={{ padding: 6, opacity: 0.7 }}>No bids yet.</td></tr>
          ) : (
            bids.map((b) => (
              <tr key={b.id}>
                <td style={{ padding: 6 }}>{b.data.teamId}</td>
                <td style={{ padding: 6, textAlign: "right" }}>{clampInt(b.data.amount)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      {msg && <div style={{ marginTop: 10, color: "lightgreen" }}>{msg}</div>}
      {err && <div style={{ marginTop: 10, color: "crimson" }}>{err}</div>}
    </div>
  );
}
