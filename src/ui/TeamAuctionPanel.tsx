// src/ui/TeamAuctionPanel.tsx

import { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";

import { db } from "../lib/firebase";

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
  activeAuctionId?: string | null;
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
  endsAt?: any;
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

function clampInt(value: any) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

function formatTimeLeft(seconds: number | null) {
  if (seconds == null) return "-";

  if (seconds <= 0) return "Time ended";

  const min = Math.floor(seconds / 60);
  const sec = seconds % 60;

  if (min <= 0) return `${sec}s`;

  return `${min}m ${sec}s`;
}

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

  const [bidAmount, setBidAmount] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [tick, setTick] = useState(0);

  // Force countdown refresh every second
  useEffect(() => {
    const timer = setInterval(() => {
      setTick((x) => x + 1);
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  // Watch main game document
  useEffect(() => {
    if (!gameId) return;

    setErr(null);

    const gameRef = doc(db, "games", gameId);

    const unsub = onSnapshot(
      gameRef,
      (snap) => {
        if (!snap.exists()) {
          setGame(null);
          return;
        }

        setGame(snap.data() as GameDoc);
      },
      (error) => {
        console.error("Team auction game listener error:", error);
        setErr(error.message);
      }
    );

    return () => unsub();
  }, [gameId]);

  // Watch active auction and its bids
  useEffect(() => {
    setAuction(null);
    setBids([]);
    setMsg(null);
    setErr(null);

    if (!gameId || !game?.activeAuctionId) return;

    const auctionId = String(game.activeAuctionId);

    const auctionRef = doc(db, "games", gameId, "auctions", auctionId);

    const unsubAuction = onSnapshot(
      auctionRef,
      (snap) => {
        if (!snap.exists()) {
          setAuction(null);
          return;
        }

        setAuction(snap.data() as AuctionDoc);
      },
      (error) => {
        console.error("Team auction listener error:", error);
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
        console.error("Team auction bids listener error:", error);
        setErr(error.message);
      }
    );

    return () => {
      unsubAuction();
      unsubBids();
    };
  }, [gameId, game?.activeAuctionId]);

  const secondsLeft = useMemo(() => {
    if (!auction?.endsAt) return null;

    const endMs =
      typeof auction.endsAt?.toMillis === "function"
        ? auction.endsAt.toMillis()
        : auction.endsAt?.seconds
        ? auction.endsAt.seconds * 1000
        : null;

    if (!endMs) return null;

    // tick forces recalculation
    tick;

    return Math.max(0, Math.floor((endMs - Date.now()) / 1000));
  }, [auction?.endsAt, tick]);

  const myBid = useMemo(() => {
    return bids.find((bid) => bid.id === teamId || bid.data.teamId === teamId);
  }, [bids, teamId]);

  const highestBid = bids[0] ?? null;

  const highestOtherBid = useMemo(() => {
    return bids.find((bid) => bid.data.teamId !== teamId) ?? null;
  }, [bids, teamId]);

  const minimumAllowedBid = useMemo(() => {
    const minBid = clampInt(auction?.minBid ?? 0);
    const highestOtherAmount = clampInt(highestOtherBid?.data.amount ?? 0);

    if (highestOtherAmount > 0) {
      return Math.max(minBid, highestOtherAmount + 1);
    }

    return minBid;
  }, [auction?.minBid, highestOtherBid]);

  const isAuctionOpen = auction?.status === "OPEN";
  const hasTimeEnded = secondsLeft !== null && secondsLeft <= 0;

  const canBid =
    Boolean(game?.activeAuctionId) &&
    Boolean(auction) &&
    isAuctionOpen &&
    !hasTimeEnded &&
    bidAmount >= minimumAllowedBid &&
    !submitting;

  useEffect(() => {
    if (!auction) return;

    const suggestedBid = minimumAllowedBid || clampInt(auction.minBid);

    setBidAmount((current) => {
      if (current > 0) return current;
      return suggestedBid;
    });
  }, [auction, minimumAllowedBid]);

  async function submitBid() {
    setErr(null);
    setMsg(null);
    setSubmitting(true);

    try {
      if (!game?.activeAuctionId) {
        throw new Error("There is no active auction right now.");
      }

      if (!auction) {
        throw new Error("Auction data is not loaded yet.");
      }

      if (auction.status !== "OPEN") {
        throw new Error("This auction is not open for bidding.");
      }

      if (hasTimeEnded) {
        throw new Error("The auction time has ended.");
      }

      const cleanBid = clampInt(bidAmount);

      if (cleanBid < minimumAllowedBid) {
        throw new Error(
          `Your bid must be at least $${minimumAllowedBid}.`
        );
      }

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
        {
          teamId,
          amount: cleanBid,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      setMsg(`Bid submitted ✅ Your bid: $${cleanBid}`);
    } catch (error: any) {
      console.error("Submit auction bid error:", error);
      setErr(error?.message ?? String(error));
    } finally {
      setSubmitting(false);
    }
  }

  if (!game?.activeAuctionId) {
    return (
      <div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4 text-slate-300">
          Auction: none right now.
        </div>

        {game?.lastAuctionResult && (
          <div className="mt-4 rounded-xl border border-green-500/40 bg-green-950/40 p-4 text-green-100">
            <div className="font-semibold">Latest auction result</div>
            <div className="mt-1 text-sm text-green-100/90">
              {game.lastAuctionResult.message}
            </div>
          </div>
        )}

        {err && (
          <div className="mt-4 rounded-xl border border-red-700 bg-red-950/40 p-3 text-red-200">
            {err}
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="rounded-xl border border-purple-500/40 bg-purple-950/40 p-4 text-purple-100">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold">Auction is open</h3>

            <p className="mt-1 text-sm text-purple-100/80">
              Submit your bid before the teacher closes the auction. The winner
              is the highest bidder who has enough cash during settlement.
            </p>
          </div>

          <span className="rounded-full bg-purple-500 px-3 py-1 text-xs font-bold text-white">
            LIVE
          </span>
        </div>
      </div>

      {auction && (
        <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/40 p-4">
          <h4 className="font-semibold text-slate-100">Auction Lot</h4>

          <div className="mt-3 grid gap-3 md:grid-cols-4">
            <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
              <div className="text-xs uppercase text-slate-500">Item</div>
              <div className="mt-1 text-lg font-bold text-slate-100">
                {auction.lot.itemKey}
              </div>
            </div>

            <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
              <div className="text-xs uppercase text-slate-500">Quantity</div>
              <div className="mt-1 text-lg font-bold text-slate-100">
                {auction.lot.qty}
              </div>
            </div>

            <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
              <div className="text-xs uppercase text-slate-500">Minimum Bid</div>
              <div className="mt-1 text-lg font-bold text-slate-100">
                ${auction.minBid}
              </div>
            </div>

            <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
              <div className="text-xs uppercase text-slate-500">Time Left</div>
              <div className="mt-1 text-lg font-bold text-slate-100">
                {formatTimeLeft(secondsLeft)}
              </div>
            </div>
          </div>

          <div className="mt-3 text-sm text-slate-400">
            Status: <b>{auction.status}</b> • Round:{" "}
            <b>{auction.roundNumber}</b>
          </div>
        </div>
      )}

      <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/40 p-4">
        <h4 className="font-semibold text-slate-100">Current Bids</h4>

        {highestBid ? (
          <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-950/30 p-3 text-amber-100">
            Highest bid now: <b>{highestBid.data.teamId}</b> with{" "}
            <b>${clampInt(highestBid.data.amount)}</b>
          </div>
        ) : (
          <div className="mt-3 rounded-lg border border-slate-800 bg-slate-900/60 p-3 text-sm text-slate-400">
            No bids yet.
          </div>
        )}

        {myBid && (
          <div className="mt-3 rounded-lg border border-blue-500/40 bg-blue-950/30 p-3 text-blue-100">
            Your current bid: <b>${clampInt(myBid.data.amount)}</b>
          </div>
        )}

        {bids.length > 0 && (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="py-2 text-left">Rank</th>
                  <th className="py-2 text-left">Team</th>
                  <th className="py-2 text-right">Bid</th>
                </tr>
              </thead>

              <tbody>
                {bids.map((bid, index) => (
                  <tr key={bid.id} className="border-b border-slate-900">
                    <td className="py-2 text-slate-400">#{index + 1}</td>
                    <td className="py-2 text-slate-100">
                      {bid.data.teamId}
                      {bid.data.teamId === teamId && (
                        <span className="ml-2 rounded-full bg-blue-500/20 px-2 py-0.5 text-xs text-blue-100">
                          You
                        </span>
                      )}
                    </td>
                    <td className="py-2 text-right font-semibold text-slate-100">
                      ${clampInt(bid.data.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/40 p-4">
        <h4 className="font-semibold text-slate-100">Submit Your Bid</h4>

        <p className="mt-1 text-sm text-slate-400">
          Minimum allowed bid now: <b>${minimumAllowedBid}</b>
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <input
            type="number"
            min={minimumAllowedBid}
            value={bidAmount}
            onChange={(event) => setBidAmount(clampInt(event.target.value))}
            className="w-40 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-right text-slate-100"
          />

          <button
            type="button"
            disabled={!canBid}
            onClick={submitBid}
            className="rounded-lg bg-purple-600 px-4 py-2 font-semibold text-white hover:bg-purple-500 disabled:cursor-not-allowed disabled:bg-slate-700"
          >
            {submitting ? "Submitting..." : "Submit Bid"}
          </button>
        </div>

        {!isAuctionOpen && (
          <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-950/40 p-3 text-sm text-amber-100">
            The auction is no longer open for bidding.
          </div>
        )}

        {hasTimeEnded && isAuctionOpen && (
          <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-950/40 p-3 text-sm text-amber-100">
            Time has ended. Please wait for the teacher to close and settle the
            auction.
          </div>
        )}

        {msg && (
          <div className="mt-3 rounded-lg border border-green-700 bg-green-950/40 p-3 text-green-200">
            {msg}
          </div>
        )}

        {err && (
          <div className="mt-3 rounded-lg border border-red-700 bg-red-950/40 p-3 text-red-200">
            {err}
          </div>
        )}
      </div>
    </div>
  );
}