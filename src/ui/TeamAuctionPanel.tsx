// src/ui/TeamAuctionPanel.tsx
import { useEffect, useMemo, useState } from "react";
import { db } from "../lib/firebase";
import {
  doc,
  onSnapshot,
  setDoc,
  serverTimestamp,
  collection,
  orderBy,
  query,
} from "firebase/firestore";

function clampInt(n: any) {
  const v = Math.floor(Number(n));
  return Number.isFinite(v) ? Math.max(0, v) : 0;
}

type GameDoc = {
  activeAuctionId?: string | null;
};

type AuctionDoc = {
  status: "OPEN" | "CLOSED" | "SETTLED";
  lot: { kind: "ITEM"; itemKey: string; qty: number };
  minBid: number;
  endsAt: any;
  roundNumber: number;
};

type BidDoc = { teamId: string; amount: number; updatedAt?: any };

export default function TeamAuctionPanel({
  gameId,
  teamId,
}: {
  gameId: string;
  teamId: string;
}) {
  const [game, setGame] = useState<GameDoc | null>(null);
  const [auction, setAuction] = useState<AuctionDoc | null>(null);
  const [bids, setBids] = useState<{ id: string; data: BidDoc }[]>([]);
  const [myBid, setMyBid] = useState<number>(0);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  // ✅ tick to force re-render every second (for live countdown)
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    setErr(null);
    const gref = doc(db, "games", gameId);
    return onSnapshot(
      gref,
      (s) => (s.exists() ? setGame(s.data() as any) : null),
      (e) => setErr(e.message)
    );
  }, [gameId]);

  useEffect(() => {
    setAuction(null);
    setBids([]);
    setMsg(null);

    if (!game?.activeAuctionId) return;

    const aref = doc(db, "games", gameId, "auctions", String(game.activeAuctionId));
    const unsubA = onSnapshot(
      aref,
      (s) => (s.exists() ? setAuction(s.data() as any) : null),
      (e) => setErr(e.message)
    );

    const bidsRef = collection(
      db,
      "games",
      gameId,
      "auctions",
      String(game.activeAuctionId),
      "bids"
    );
    const qy = query(bidsRef, orderBy("amount", "desc"));
    const unsubB = onSnapshot(
      qy,
      (snap) => {
        const rows: any[] = [];
        snap.forEach((d) => rows.push({ id: d.id, data: d.data() as any }));
        setBids(rows);

        // keep myBid in sync with my latest stored bid
        const mine = rows.find((r) => r.id === teamId);
        setMyBid(clampInt(mine?.data?.amount ?? 0));
      },
      (e) => setErr(e.message)
    );

    return () => {
      unsubA();
      unsubB();
    };
  }, [gameId, game?.activeAuctionId, teamId]);

  const highest = useMemo(() => {
    if (bids.length === 0) return 0;
    return clampInt(bids[0].data.amount);
  }, [bids]);

  const iAmLeading = useMemo(() => {
    return bids.length > 0 && bids[0].id === teamId;
  }, [bids, teamId]);

  // ✅ secondsLeft recalculates every second using tick
  const secondsLeft = useMemo(() => {
    if (!auction?.endsAt) return null;
    const endMs =
      typeof auction.endsAt?.toMillis === "function"
        ? auction.endsAt.toMillis()
        : auction.endsAt?.seconds
        ? auction.endsAt.seconds * 1000
        : null;
    if (!endMs) return null;

    return Math.max(0, Math.floor((endMs - Date.now()) / 1000));
  }, [auction, tick]);

  async function submitBid() {
    // clear old messages
    setErr(null);
    setMsg(null);

    // ✅ non-fatal guards (DON'T throw)
    if (!game?.activeAuctionId) {
      setMsg("No active auction right now.");
      return;
    }
    if (!auction || auction.status !== "OPEN") {
      setMsg("Auction is not open.");
      return;
    }

    const amt = clampInt(myBid);
    const min = clampInt(auction.minBid);

    // ✅ validation: show msg but do NOT break UI
    if (amt < min) {
      setMsg(`Bid must be ≥ minBid (${min}).`);
      return;
    }

    try {
      const bidRef = doc(
        db,
        "games",
        gameId,
        "auctions",
        String(game.activeAuctionId),
        "bids",
        teamId
      );

      await setDoc(
        bidRef,
        { teamId, amount: amt, updatedAt: serverTimestamp() },
        { merge: true }
      );

      setMsg("Bid submitted ✅");
    } catch (e: any) {
      // ✅ only real Firestore errors go here
      setErr(e?.message ?? String(e));
    }
  }

  // ✅ IMPORTANT: don't return early on err, because that "breaks" the UI
  if (!game?.activeAuctionId) {
    return (
      <div
        style={{
          border: "1px solid #333",
          borderRadius: 12,
          padding: 12,
          maxWidth: 900,
          opacity: 0.9,
        }}
      >
        <b>Auction:</b> none right now.
        {err && <div style={{ marginTop: 8, color: "crimson" }}>{err}</div>}
      </div>
    );
  }

  if (!auction) return <div>Loading auction...</div>;

  return (
    <div style={{ border: "1px solid #333", borderRadius: 12, padding: 12, maxWidth: 900 }}>
      <h3 style={{ marginTop: 0 }}>Auction</h3>

      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
        <div>
          <b>Status:</b> {auction.status}
        </div>
        <div>
          <b>Round:</b> {auction.roundNumber}
        </div>
        <div>
          <b>Lot:</b> {auction.lot.itemKey} × {auction.lot.qty}
        </div>
        <div>
          <b>Min bid:</b> {auction.minBid}
        </div>
        {secondsLeft != null && (
          <div>
            <b>Time left:</b> {secondsLeft}s
          </div>
        )}
      </div>

      <div style={{ marginTop: 10, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <div>
          <b>Highest bid:</b> {highest}
        </div>

        <div>
          <b>Your bid:</b>{" "}
          <input
            type="number"
            min={0}
            value={myBid}
            onChange={(e) => setMyBid(clampInt(e.target.value))}
            style={{ width: 120, padding: 6 }}
            disabled={auction.status !== "OPEN"}
          />
          <button
            style={{ marginLeft: 8, padding: "8px 12px" }}
            onClick={submitBid}
            disabled={auction.status !== "OPEN"}
          >
            Submit Bid
          </button>
        </div>

        <div style={{ color: iAmLeading ? "lightgreen" : "salmon" }}>
          {iAmLeading ? "You are leading ✅" : "Not leading"}
        </div>
      </div>

      {msg && <div style={{ marginTop: 8, color: "lightgreen" }}>{msg}</div>}
      {err && <div style={{ marginTop: 8, color: "crimson" }}>{err}</div>}
    </div>
  );
}
