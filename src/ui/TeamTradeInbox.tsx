import { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import type { Timestamp } from "firebase/firestore";

import { db } from "../lib/firebase";
import { type AssetId, assetLabel } from "../lib/items";

type TradeStatus =
  | "WAITING_TEAM"
  | "PENDING"
  | "ACCEPTED"
  | "DECLINED"
  | "DECLINED_BY_TEAM";

type TradeDoc = {
  status: TradeStatus;
  roundNumber: number;
  fromTeamId: string;
  toTeamId: string;
  offerAsset: AssetId;
  offerQty: number;
  requestAsset: AssetId;
  requestQty: number;
  createdAt?: Timestamp;
  receiverAcceptedAt?: Timestamp;
  receiverDeclinedAt?: Timestamp;
  senderSeenAt?: Timestamp;
};

function formatTime(t?: Timestamp) {
  if (!t) return "-";

  const d = t.toDate();

  return d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getStatusLabel(status: TradeStatus) {
  if (status === "WAITING_TEAM") return "Waiting for other team";
  if (status === "PENDING") return "Accepted by team, waiting for teacher";
  if (status === "ACCEPTED") return "Approved by teacher";
  if (status === "DECLINED") return "Declined by teacher";
  if (status === "DECLINED_BY_TEAM") return "Rejected by other team";

  return status;
}

function getStatusClass(status: TradeStatus) {
  if (status === "WAITING_TEAM") {
    return "bg-amber-500/20 text-amber-100";
  }

  if (status === "PENDING") {
    return "bg-blue-500/20 text-blue-100";
  }

  if (status === "ACCEPTED") {
    return "bg-green-500/20 text-green-100";
  }

  if (status === "DECLINED" || status === "DECLINED_BY_TEAM") {
    return "bg-red-500/20 text-red-100";
  }

  return "bg-slate-700 text-slate-100";
}

function TradeSummary({
  trade,
  perspective,
}: {
  trade: TradeDoc & { id: string };
  perspective: "receiver" | "sender";
}) {
  if (perspective === "receiver") {
    return (
      <div className="mt-2 text-slate-300">
        You receive{" "}
        <b>
          {trade.offerQty} {assetLabel(trade.offerAsset)}
        </b>{" "}
        and give{" "}
        <b>
          {trade.requestQty} {assetLabel(trade.requestAsset)}
        </b>
        .
      </div>
    );
  }

  return (
    <div className="mt-2 text-slate-300">
      You give{" "}
      <b>
        {trade.offerQty} {assetLabel(trade.offerAsset)}
      </b>{" "}
      and want{" "}
      <b>
        {trade.requestQty} {assetLabel(trade.requestAsset)}
      </b>
      .
    </div>
  );
}

export default function TeamTradeInbox({
  gameId,
  teamId,
  roundNumber,
}: {
  gameId: string;
  teamId: string;
  roundNumber: number;
}) {
  const [receivedTrades, setReceivedTrades] = useState<
    (TradeDoc & { id: string })[]
  >([]);

  const [sentTrades, setSentTrades] = useState<
    (TradeDoc & { id: string })[]
  >([]);

  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [markingRead, setMarkingRead] = useState(false);

  useEffect(() => {
    if (!gameId || !teamId) return;

    setErr(null);

    const tradesRef = collection(db, "games", gameId, "trades");

    // Received trades: only trades sent TO this team.
    // This avoids permission errors.
    const receivedQuery = query(tradesRef, where("toTeamId", "==", teamId));

    const unsubReceived = onSnapshot(
      receivedQuery,
      (snap) => {
        const rows: (TradeDoc & { id: string })[] = [];

        snap.forEach((d) => {
          rows.push({
            id: d.id,
            ...(d.data() as TradeDoc),
          });
        });

        rows.sort((a, b) => {
          const aTime =
            typeof a.createdAt?.toMillis === "function"
              ? a.createdAt.toMillis()
              : 0;

          const bTime =
            typeof b.createdAt?.toMillis === "function"
              ? b.createdAt.toMillis()
              : 0;

          return bTime - aTime;
        });

        setReceivedTrades(rows);
      },
      (e) => {
        console.error("Received trade listener error:", e);
        setErr(e.message);
      }
    );

    // Sent trades: only trades created BY this team.
    // This lets the sender track whether the other team accepted/rejected.
    const sentQuery = query(tradesRef, where("fromTeamId", "==", teamId));

    const unsubSent = onSnapshot(
      sentQuery,
      (snap) => {
        const rows: (TradeDoc & { id: string })[] = [];

        snap.forEach((d) => {
          rows.push({
            id: d.id,
            ...(d.data() as TradeDoc),
          });
        });

        rows.sort((a, b) => {
          const aTime =
            typeof a.createdAt?.toMillis === "function"
              ? a.createdAt.toMillis()
              : 0;

          const bTime =
            typeof b.createdAt?.toMillis === "function"
              ? b.createdAt.toMillis()
              : 0;

          return bTime - aTime;
        });

        setSentTrades(rows);
      },
      (e) => {
        console.error("Sent trade listener error:", e);
        setErr(e.message);
      }
    );

    return () => {
      unsubReceived();
      unsubSent();
    };
  }, [gameId, teamId]);

  const waitingReceived = useMemo(() => {
    return receivedTrades.filter(
      (t) =>
        t.status === "WAITING_TEAM" &&
        Number(t.roundNumber ?? 0) === roundNumber
    );
  }, [receivedTrades, roundNumber]);

  const receivedHistory = useMemo(() => {
    return receivedTrades
      .filter(
        (t) =>
          t.status !== "WAITING_TEAM" &&
          Number(t.roundNumber ?? 0) === roundNumber
      )
      .slice(0, 5);
  }, [receivedTrades, roundNumber]);

  const sentThisRound = useMemo(() => {
    return sentTrades
      .filter((t) => Number(t.roundNumber ?? 0) === roundNumber)
      .slice(0, 8);
  }, [sentTrades, roundNumber]);

  const unseenSentUpdates = useMemo(() => {
    return sentThisRound.filter(
      (t) => t.status !== "WAITING_TEAM" && !t.senderSeenAt
    );
  }, [sentThisRound]);

  async function acceptTrade(tradeId: string) {
    setErr(null);
    setMsg(null);
    setBusyId(tradeId);

    try {
      const tradeRef = doc(db, "games", gameId, "trades", tradeId);

      await updateDoc(tradeRef, {
        status: "PENDING",
        receiverAcceptedAt: serverTimestamp(),
      });

      setMsg("Trade accepted. It has been sent to the teacher for final approval.");
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusyId(null);
    }
  }

  async function rejectTrade(tradeId: string) {
    setErr(null);
    setMsg(null);
    setBusyId(tradeId);

    try {
      const tradeRef = doc(db, "games", gameId, "trades", tradeId);

      await updateDoc(tradeRef, {
        status: "DECLINED_BY_TEAM",
        receiverDeclinedAt: serverTimestamp(),
      });

      setMsg("Trade rejected. It will not be sent to the teacher.");
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusyId(null);
    }
  }

  async function markSentUpdatesAsRead() {
    if (unseenSentUpdates.length === 0) return;

    setErr(null);
    setMsg(null);
    setMarkingRead(true);

    try {
      const batch = writeBatch(db);

      unseenSentUpdates.forEach((t) => {
        const tradeRef = doc(db, "games", gameId, "trades", t.id);

        batch.update(tradeRef, {
          senderSeenAt: serverTimestamp(),
        });
      });

      await batch.commit();

      setMsg("Sent trade updates marked as read.");
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setMarkingRead(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Received trade requests */}
      <div className="rounded-xl border border-amber-500/40 bg-amber-950/30 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-lg font-semibold text-amber-100">
              Received Trade Requests
            </h3>

            <p className="mt-1 text-sm text-amber-100/80">
              These are requests from other teams. Accept only if your team
              agrees. Accepted trades will go to the teacher for final approval.
            </p>
          </div>

          {waitingReceived.length > 0 && (
            <span className="rounded-full bg-red-500 px-3 py-1 text-sm font-bold text-white">
              {waitingReceived.length} waiting
            </span>
          )}
        </div>

        {err && (
          <div className="mt-3 rounded-lg border border-red-700 bg-red-950/40 p-3 text-red-200">
            {err}
          </div>
        )}

        {msg && (
          <div className="mt-3 rounded-lg border border-green-700 bg-green-950/40 p-3 text-green-200">
            {msg}
          </div>
        )}

        {waitingReceived.length === 0 ? (
          <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950/40 p-3 text-sm text-slate-400">
            No trade requests waiting for your team.
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {waitingReceived.map((t) => (
              <div
                key={t.id}
                className="rounded-xl border border-slate-700 bg-slate-950/60 p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold text-slate-100">
                      Request from {t.fromTeamId}
                    </div>

                    <div className="mt-1 text-sm text-slate-400">
                      Round {t.roundNumber} • {formatTime(t.createdAt)}
                    </div>
                  </div>

                  <span className="rounded-full bg-amber-500/20 px-3 py-1 text-xs font-semibold text-amber-100">
                    Waiting for your decision
                  </span>
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <div className="rounded-lg border border-green-700/40 bg-green-950/30 p-3">
                    <div className="text-xs font-semibold uppercase text-green-200/80">
                      You will receive
                    </div>

                    <div className="mt-1 text-lg font-bold text-green-100">
                      {t.offerQty} {assetLabel(t.offerAsset)}
                    </div>
                  </div>

                  <div className="rounded-lg border border-red-700/40 bg-red-950/30 p-3">
                    <div className="text-xs font-semibold uppercase text-red-200/80">
                      You must give
                    </div>

                    <div className="mt-1 text-lg font-bold text-red-100">
                      {t.requestQty} {assetLabel(t.requestAsset)}
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busyId === t.id}
                    onClick={() => acceptTrade(t.id)}
                    className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-500 disabled:bg-slate-700"
                  >
                    Accept and Send to Teacher
                  </button>

                  <button
                    type="button"
                    disabled={busyId === t.id}
                    onClick={() => rejectTrade(t.id)}
                    className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:bg-slate-700"
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Sent trade tracking */}
      <div className="rounded-xl border border-blue-500/40 bg-blue-950/30 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-lg font-semibold text-blue-100">
              Your Sent Trade Requests
            </h3>

            <p className="mt-1 text-sm text-blue-100/80">
              Track whether the other team accepted or rejected your request.
            </p>
          </div>

          {unseenSentUpdates.length > 0 && (
            <span className="rounded-full bg-red-500 px-3 py-1 text-sm font-bold text-white">
              {unseenSentUpdates.length} update
              {unseenSentUpdates.length > 1 ? "s" : ""}
            </span>
          )}
        </div>

        {unseenSentUpdates.length > 0 && (
          <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-950/40 p-3 text-sm text-amber-100">
            You have new updates on your sent trade request
            {unseenSentUpdates.length > 1 ? "s" : ""}.

            <button
              type="button"
              disabled={markingRead}
              onClick={markSentUpdatesAsRead}
              className="ml-3 rounded-lg bg-amber-500 px-3 py-1 font-semibold text-slate-950 hover:bg-amber-400 disabled:bg-slate-700 disabled:text-slate-300"
            >
              Mark as read
            </button>
          </div>
        )}

        {sentThisRound.length === 0 ? (
          <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950/40 p-3 text-sm text-slate-400">
            Your team has not sent any trade requests this round.
          </div>
        ) : (
          <div className="mt-4 space-y-2">
            {sentThisRound.map((t) => (
              <div
                key={t.id}
                className="rounded-lg border border-slate-800 bg-slate-950/50 p-3 text-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-semibold text-slate-100">
                    To {t.toTeamId}
                  </div>

                  <span
                    className={[
                      "rounded-full px-2 py-1 text-xs font-semibold",
                      getStatusClass(t.status),
                    ].join(" ")}
                  >
                    {getStatusLabel(t.status)}
                  </span>
                </div>

                <TradeSummary trade={t} perspective="sender" />

                {t.status === "WAITING_TEAM" && (
                  <div className="mt-1 text-xs text-amber-200">
                    Waiting for {t.toTeamId} to accept or reject.
                  </div>
                )}

                {t.status === "PENDING" && (
                  <div className="mt-1 text-xs text-blue-200">
                    {t.toTeamId} accepted. Now waiting for teacher approval.
                  </div>
                )}

                {t.status === "DECLINED_BY_TEAM" && (
                  <div className="mt-1 text-xs text-red-200">
                    {t.toTeamId} rejected this trade. It will not go to the
                    teacher.
                  </div>
                )}

                {t.status === "ACCEPTED" && (
                  <div className="mt-1 text-xs text-green-200">
                    Teacher approved this trade.
                  </div>
                )}

                {t.status === "DECLINED" && (
                  <div className="mt-1 text-xs text-red-200">
                    Teacher declined this trade.
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Received history */}
      <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
        <h3 className="text-lg font-semibold text-slate-100">
          Recent Received Trade Decisions
        </h3>

        <p className="mt-1 text-sm text-slate-400">
          These are requests your team already accepted or rejected this round.
        </p>

        {receivedHistory.length === 0 ? (
          <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950/40 p-3 text-sm text-slate-400">
            No received trade decisions yet.
          </div>
        ) : (
          <div className="mt-4 space-y-2">
            {receivedHistory.map((t) => (
              <div
                key={t.id}
                className="rounded-lg border border-slate-800 bg-slate-950/50 p-3 text-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-semibold text-slate-100">
                    From {t.fromTeamId}
                  </div>

                  <span
                    className={[
                      "rounded-full px-2 py-1 text-xs font-semibold",
                      getStatusClass(t.status),
                    ].join(" ")}
                  >
                    {getStatusLabel(t.status)}
                  </span>
                </div>

                <TradeSummary trade={t} perspective="receiver" />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}