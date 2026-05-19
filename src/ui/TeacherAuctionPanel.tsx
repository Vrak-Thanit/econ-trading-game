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

type ItemPrice = {
  buy?: number | null;
  rent?: number | null;
};

type ItemPrices = Record<string, ItemPrice>;

type AuctionResult = {
  roundNumber: number;
  auctionId: string;
  winnerTeamId: string | null;
  winningBid: number | null;
  itemKey: string;
  qty: number;
  message: string;
  settledAt?: any;
};

type GameDoc = {
  roundNumber?: number;
  activeAuctionId?: string | null;
  itemPrices?: any;
  itemBasePrices?: any;
  lastAuctionResult?: AuctionResult | null;
};

type AuctionDoc = {
  status: "OPEN" | "CLOSED" | "SETTLED";
  roundNumber: number;
  lot: {
    kind: "ITEM";
    itemKey: string;
    qty: number;
  };
  minBid: number;
  endsAt: any;
  createdAt?: any;
  closedAt?: any;
  winnerTeamId?: string | null;
  winningBid?: number | null;
};

type BidDoc = {
  teamId: string;
  amount: number;
  updatedAt?: any;
};

function num(n: any) {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}

function clampInt(n: any) {
  const v = Math.floor(Number(n));
  return Number.isFinite(v) ? Math.max(0, v) : 0;
}

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
      out[item] = {
        buy: v.buy ?? null,
        rent: v.rent ?? null,
      };
    } else {
      out[item] = {
        buy: v ?? null,
        rent: null,
      };
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

  // Re-render every second for countdown.
  const [tick, setTick] = useState(0);

  // Create auction form
  const [itemKey, setItemKey] = useState("");
  const [qty, setQty] = useState(1);
  const [minBid, setMinBid] = useState(50);
  const [durationSec, setDurationSec] = useState(60);

  useEffect(() => {
    const timer = setInterval(() => {
      setTick((x) => x + 1);
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  // Watch main game document
  useEffect(() => {
    setErr(null);

    const gameRef = doc(db, "games", gameId);

    return onSnapshot(
      gameRef,
      (snap) => {
        if (!snap.exists()) return;

        const data = snap.data() as GameDoc;
        setGame(data);
      },
      (error) => {
        console.error("Game listener error:", error);
        setErr(error.message);
      }
    );
  }, [gameId]);

  // Watch active auction and bids
  useEffect(() => {
    setAuction(null);
    setBids([]);

    if (!game?.activeAuctionId) return;

    const auctionId = String(game.activeAuctionId);

    const auctionRef = doc(db, "games", gameId, "auctions", auctionId);

    const unsubAuction = onSnapshot(
      auctionRef,
      (snap) => {
        if (!snap.exists()) return;

        setAuction(snap.data() as AuctionDoc);
      },
      (error) => {
        console.error("Auction listener error:", error);
        setErr(error.message);
      }
    );

    const bidsRef = collection(
      db,
      "games",
      gameId,
      "auctions",
      auctionId,
      "bids"
    );

    const bidsQuery = query(bidsRef, orderBy("amount", "desc"));

    const unsubBids = onSnapshot(
      bidsQuery,
      (snap) => {
        const rows: { id: string; data: BidDoc }[] = [];

        snap.forEach((d) => {
          rows.push({
            id: d.id,
            data: d.data() as BidDoc,
          });
        });

        setBids(rows);
      },
      (error) => {
        console.error("Bids listener error:", error);
        setErr(error.message);
      }
    );

    return () => {
      unsubAuction();
      unsubBids();
    };
  }, [gameId, game?.activeAuctionId]);

  const itemOptions = useMemo(() => {
    const items = normalizeItemPrices(
      game?.itemPrices ?? game?.itemBasePrices ?? {}
    );

    return Object.keys(items).sort();
  }, [game]);

  useEffect(() => {
    if (!itemKey && itemOptions.length > 0) {
      setItemKey(itemOptions[0]);
    }
  }, [itemKey, itemOptions]);

  const secondsLeft = useMemo(() => {
    if (!auction?.endsAt) return null;

    const endMs =
      typeof auction.endsAt?.toMillis === "function"
        ? auction.endsAt.toMillis()
        : auction.endsAt?.seconds
        ? auction.endsAt.seconds * 1000
        : null;

    if (!endMs) return null;

    // tick forces this to recalculate every second.
    return Math.max(0, Math.floor((endMs - Date.now()) / 1000));
  }, [auction, tick]);

  async function createAndOpen() {
    setErr(null);
    setMsg(null);

    try {
      if (!itemKey) {
        throw new Error("Please select an auction item.");
      }

      if (game?.activeAuctionId) {
        throw new Error("There is already an active auction.");
      }

      const gameRef = doc(db, "games", gameId);
      const gameSnap = await getDoc(gameRef);

      if (!gameSnap.exists()) {
        throw new Error("Game not found.");
      }

      const roundNumber = num((gameSnap.data() as any).roundNumber ?? 0);

      const auctionRef = doc(collection(db, "games", gameId, "auctions"));

      const cleanQty = clampInt(qty) || 1;
      const cleanMinBid = clampInt(minBid);
      const cleanDurationSec = clampInt(durationSec) || 60;

      const endsAt = Timestamp.fromMillis(
        Date.now() + cleanDurationSec * 1000
      );

      const batch = writeBatch(db);

      batch.set(auctionRef, {
        status: "OPEN",
        roundNumber,
        lot: {
          kind: "ITEM",
          itemKey,
          qty: cleanQty,
        },
        minBid: cleanMinBid,
        endsAt,
        createdAt: serverTimestamp(),
      });

      batch.update(gameRef, {
        activeAuctionId: auctionRef.id,
        lastAuctionResult: null,
      });

      const logRef = doc(collection(db, "games", gameId, "logs"));

      batch.set(logRef, {
        type: "AUCTION_OPEN",
        createdAt: serverTimestamp(),
        message: `R${roundNumber}: Auction OPEN item=${itemKey} qty=${cleanQty} minBid=${cleanMinBid} duration=${cleanDurationSec}s`,
      });

      await batch.commit();

      setMsg(
        `Auction opened ✅ ${itemKey} × ${cleanQty}, minimum bid $${cleanMinBid}`
      );
    } catch (error: any) {
      console.error("Create auction error:", error);
      setErr(error?.message ?? String(error));
    }
  }

  async function closeAuction() {
    setErr(null);
    setMsg(null);

    try {
      if (!game?.activeAuctionId) {
        throw new Error("No active auction.");
      }

      const auctionRef = doc(
        db,
        "games",
        gameId,
        "auctions",
        String(game.activeAuctionId)
      );

      await updateDoc(auctionRef, {
        status: "CLOSED",
        closedAt: serverTimestamp(),
      });

      setMsg("Auction closed ✅ Now you can settle it.");
    } catch (error: any) {
      console.error("Close auction error:", error);
      setErr(error?.message ?? String(error));
    }
  }

  async function settleAuction() {
    setErr(null);
    setMsg(null);

    try {
      if (!game?.activeAuctionId) {
        throw new Error("No active auction.");
      }

      const auctionId = String(game.activeAuctionId);

      const auctionRef = doc(db, "games", gameId, "auctions", auctionId);
      const auctionSnap = await getDoc(auctionRef);

      if (!auctionSnap.exists()) {
        throw new Error("Auction not found.");
      }

      const auctionData = auctionSnap.data() as AuctionDoc;

      if (auctionData.status !== "CLOSED") {
        throw new Error("Settle only after the auction is CLOSED.");
      }

      const bidsRef = collection(
        db,
        "games",
        gameId,
        "auctions",
        auctionId,
        "bids"
      );

      const bidsSnap = await getDocs(query(bidsRef, orderBy("amount", "desc")));

      const candidates: { teamId: string; amount: number }[] = [];

      bidsSnap.forEach((d) => {
        const bid = d.data() as BidDoc;

        candidates.push({
          teamId: String(bid.teamId),
          amount: clampInt(bid.amount),
        });
      });

      // Case 1: no bids at all
      if (candidates.length === 0) {
        const resultMessage = `R${auctionData.roundNumber}: Auction settled. No bids were submitted. No item was awarded.`;

        const batch = writeBatch(db);

        batch.update(auctionRef, {
          status: "SETTLED",
          winnerTeamId: null,
          winningBid: null,
        });

        batch.update(doc(db, "games", gameId), {
          activeAuctionId: null,
          lastAuctionResult: {
            roundNumber: auctionData.roundNumber,
            auctionId,
            winnerTeamId: null,
            winningBid: null,
            itemKey: auctionData.lot.itemKey,
            qty: auctionData.lot.qty,
            message: resultMessage,
            settledAt: serverTimestamp(),
          },
        });

        const logRef = doc(collection(db, "games", gameId, "logs"));

        batch.set(logRef, {
          type: "AUCTION_SETTLE",
          createdAt: serverTimestamp(),
          message: resultMessage,
        });

        await batch.commit();

        setMsg(resultMessage);
        return;
      }

      let finalMessage = "Auction settled ✅";

      // Case 2: bids exist. Pick the highest bidder who can actually pay.
      await runTransaction(db, async (tx) => {
        const auctionNowSnap = await tx.get(auctionRef);

        if (!auctionNowSnap.exists()) {
          throw new Error("Auction missing.");
        }

        const auctionNow = auctionNowSnap.data() as AuctionDoc;

        if (auctionNow.status === "SETTLED") {
          throw new Error("Already settled.");
        }

        if (auctionNow.status !== "CLOSED") {
          throw new Error("Auction must be CLOSED before settlement.");
        }

        let winnerTeamId: string | null = null;
        let winningBid: number | null = null;

        for (const candidate of candidates) {
          const teamRef = doc(
            db,
            "games",
            gameId,
            "teams",
            candidate.teamId
          );

          const teamSnap = await tx.get(teamRef);

          if (!teamSnap.exists()) continue;

          const teamData = teamSnap.data() as any;
          const cash = num(teamData.cash ?? 0);

          if (candidate.amount <= 0) continue;

          if (cash >= candidate.amount) {
            winnerTeamId = candidate.teamId;
            winningBid = candidate.amount;

            const inventory = {
              ...(teamData.inventory ?? {}),
            };

            const winItemKey = auctionNow.lot.itemKey;
            const winQty = clampInt(auctionNow.lot.qty) || 1;

            inventory[winItemKey] =
              clampInt(inventory[winItemKey] ?? 0) + winQty;

            tx.update(teamRef, {
              cash: cash - candidate.amount,
              inventory,
            });

            break;
          }
        }

        tx.update(auctionRef, {
          status: "SETTLED",
          winnerTeamId,
          winningBid,
        });

        const gameRef = doc(db, "games", gameId);

        finalMessage =
          winnerTeamId && winningBid != null
            ? `R${auctionNow.roundNumber}: Auction settled. ${winnerTeamId} won ${auctionNow.lot.qty} ${auctionNow.lot.itemKey} for $${winningBid}.`
            : `R${auctionNow.roundNumber}: Auction settled. No team had enough cash to pay. No item was awarded.`;

        tx.update(gameRef, {
          activeAuctionId: null,
          lastAuctionResult: {
            roundNumber: auctionNow.roundNumber,
            auctionId,
            winnerTeamId,
            winningBid,
            itemKey: auctionNow.lot.itemKey,
            qty: auctionNow.lot.qty,
            message: finalMessage,
            settledAt: serverTimestamp(),
          },
        });

        const logRef = doc(collection(db, "games", gameId, "logs"));

        tx.set(logRef, {
          type: "AUCTION_SETTLE",
          createdAt: serverTimestamp(),
          message: finalMessage,
        });
      });

      setMsg(finalMessage);
    } catch (error: any) {
      console.error("Settle auction error:", error);
      setErr(error?.message ?? String(error));
    }
  }

  return (
    <div>
      <h3>#### Auction (Teacher)</h3>

      {/* Latest auction result */}
      {game?.lastAuctionResult && (
        <div
          style={{
            marginTop: 12,
            marginBottom: 12,
            padding: 12,
            border: "1px solid #22c55e",
            borderRadius: 8,
            background: "rgba(34, 197, 94, 0.12)",
            color: "#bbf7d0",
          }}
        >
          <b>Latest auction result:</b> {game.lastAuctionResult.message}
        </div>
      )}

      {/* Create auction */}
      <div
        style={{
          marginTop: 12,
          padding: 12,
          border: "1px solid #333",
          borderRadius: 8,
        }}
      >
        <h4>Create auction</h4>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            alignItems: "center",
          }}
        >
          <label>
            Item{" "}
            <select
              value={itemKey}
              onChange={(e) => setItemKey(e.target.value)}
              style={{ padding: 6 }}
            >
              {itemOptions.length === 0 && (
                <option value="">No items found</option>
              )}

              {itemOptions.map((key) => (
                <option key={key} value={key}>
                  {key}
                </option>
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
              min={5}
              value={durationSec}
              onChange={(e) => setDurationSec(clampInt(e.target.value) || 60)}
              style={{ width: 90, padding: 6 }}
            />
          </label>

          <button
            type="button"
            onClick={createAndOpen}
            disabled={!itemKey || Boolean(game?.activeAuctionId)}
          >
            Create & Open
          </button>
        </div>

        {game?.activeAuctionId && (
          <div style={{ marginTop: 8, color: "#facc15" }}>
            There is already an active auction. Close and settle it before
            opening a new one.
          </div>
        )}
      </div>

      {/* Active auction */}
      <div
        style={{
          marginTop: 12,
          padding: 12,
          border: "1px solid #333",
          borderRadius: 8,
        }}
      >
        <h4>Active auction</h4>

        <div>
          Active:{" "}
          {game?.activeAuctionId ? (
            <>
              <b>{game.activeAuctionId}</b>{" "}
              {auction?.status ? <span>status={auction.status}</span> : null}{" "}
              {secondsLeft != null ? (
                <span>time left: {secondsLeft}s</span>
              ) : null}
            </>
          ) : (
            <span>none</span>
          )}
        </div>

        {auction && (
          <div style={{ marginTop: 8 }}>
            Lot: <b>{auction.lot.itemKey}</b> × <b>{auction.lot.qty}</b> | Min
            bid: <b>{auction.minBid}</b> | Round:{" "}
            <b>{auction.roundNumber}</b>
          </div>
        )}

        <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
          <button
            type="button"
            onClick={closeAuction}
            disabled={!game?.activeAuctionId || auction?.status !== "OPEN"}
          >
            Close Auction
          </button>

          <button
            type="button"
            onClick={settleAuction}
            disabled={!game?.activeAuctionId || auction?.status !== "CLOSED"}
          >
            Settle Auction
          </button>
        </div>
      </div>

      {/* Bids table */}
      <div
        style={{
          marginTop: 12,
          padding: 12,
          border: "1px solid #333",
          borderRadius: 8,
        }}
      >
        <h4>Bids: {bids.length}</h4>

        {bids.length === 0 ? (
          <div>No bids yet.</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", borderBottom: "1px solid #333" }}>
                  Team
                </th>
                <th style={{ textAlign: "right", borderBottom: "1px solid #333" }}>
                  Bid
                </th>
              </tr>
            </thead>

            <tbody>
              {bids.map((bid) => (
                <tr key={bid.id}>
                  <td style={{ padding: 6 }}>{bid.data.teamId}</td>
                  <td style={{ padding: 6, textAlign: "right" }}>
                    {clampInt(bid.data.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {msg && (
        <div style={{ marginTop: 12, color: "lightgreen" }}>
          {msg}
        </div>
      )}

      {err && (
        <div style={{ marginTop: 12, color: "crimson" }}>
          {err}
        </div>
      )}
    </div>
  );
}