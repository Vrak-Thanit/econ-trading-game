import { useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  where,
} from "firebase/firestore";

import { db } from "../lib/firebase";
import { ASSETS, type AssetId, assetLabel } from "../lib/items";

type TeamRow = {
  id: string;
};

export default function TeamTradeForm({
  gameId,
  teamId,
  roundNumber,
}: {
  gameId: string;
  teamId: string;
  roundNumber: number;
}) {
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [toTeamId, setToTeamId] = useState("");

  const [offerAsset, setOfferAsset] = useState<AssetId>("cash");
  const [offerQty, setOfferQty] = useState(0);

  const [requestAsset, setRequestAsset] = useState<AssetId>("paper");
  const [requestQty, setRequestQty] = useState(1);

  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  // Load team list for dropdown
  useEffect(() => {
    if (!gameId || !teamId) return;

    const teamsRef = collection(db, "games", gameId, "teams");
    const q = query(teamsRef, orderBy("incomeTier", "asc"));

    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows: TeamRow[] = [];

        snap.forEach((docSnap) => {
          rows.push({ id: docSnap.id });
        });

        const otherTeams = rows.filter((team) => team.id !== teamId);

        setTeams(otherTeams);

        setToTeamId((current) => {
          if (current && otherTeams.some((team) => team.id === current)) {
            return current;
          }

          return otherTeams[0]?.id ?? "";
        });
      },
      (error) => {
        console.error("Team list listener error:", error);
        setErr(error.message);
      }
    );

    return () => unsub();
  }, [gameId, teamId]);

  // Clear old local messages when teacher deletes all trades
  useEffect(() => {
    if (!gameId || !teamId) return;

    const tradesRef = collection(db, "games", gameId, "trades");
    const q = query(tradesRef, where("fromTeamId", "==", teamId));

    const unsub = onSnapshot(
      q,
      (snap) => {
        const hasSentTradeThisRound = snap.docs.some((docSnap) => {
          const trade = docSnap.data() as any;

          return Number(trade.roundNumber ?? 0) === roundNumber;
        });

        if (!hasSentTradeThisRound) {
          setMsg(null);
          setErr(null);
        }
      },
      (error) => {
        console.error("Trade form reset listener error:", error);
      }
    );

    return () => unsub();
  }, [gameId, teamId, roundNumber]);

  const canSend = useMemo(() => {
    if (!toTeamId) return false;
    if (toTeamId === teamId) return false;
    if (offerQty <= 0) return false;
    if (requestQty <= 0) return false;

    return true;
  }, [toTeamId, teamId, offerQty, requestQty]);

  async function sendTradeProposal() {
    setErr(null);
    setMsg(null);
    setSending(true);

    try {
      if (!canSend) {
        throw new Error("Please complete the trade proposal correctly.");
      }

      const tradesRef = collection(db, "games", gameId, "trades");

      await addDoc(tradesRef, {
        status: "WAITING_TEAM",
        roundNumber,
        fromTeamId: teamId,
        toTeamId,
        offerAsset,
        offerQty,
        requestAsset,
        requestQty,
        createdAt: serverTimestamp(),
      });

      setMsg(
        `Proposal sent to ${toTeamId}: give ${offerQty} ${assetLabel(
          offerAsset
        )} → want ${requestQty} ${assetLabel(
          requestAsset
        )}. Waiting for ${toTeamId} to accept.`
      );

      setOfferQty(0);
      setRequestQty(1);
    } catch (error: any) {
      console.error("Send trade proposal error:", error);
      setErr(error?.message ?? String(error));
    } finally {
      setSending(false);
    }
  }

  return (
    <div>
      <h3 className="text-lg font-semibold text-slate-100">
        Create Trade Proposal
      </h3>

      <p className="mt-1 text-sm text-slate-400">
        First, the receiving team must accept your proposal. After that, the
        teacher will make the final approval.
      </p>

      {err && (
        <div className="mt-3 rounded-xl border border-red-700 bg-red-950/40 p-3 text-red-200">
          {err}
        </div>
      )}

      {msg && (
        <div className="mt-3 rounded-xl border border-green-700 bg-green-950/40 p-3 text-green-200">
          {msg}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <label className="font-semibold text-slate-200">To team:</label>

        <select
          value={toTeamId}
          onChange={(event) => setToTeamId(event.target.value)}
          className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100"
        >
          {teams.length === 0 && <option value="">No other teams</option>}

          {teams.map((team) => (
            <option key={team.id} value={team.id}>
              {team.id}
            </option>
          ))}
        </select>

        <span className="font-semibold text-slate-300">
          Round: {roundNumber}
        </span>
      </div>

      <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/40 p-4">
        <h4 className="font-semibold text-slate-100">You give</h4>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <select
            value={offerAsset}
            onChange={(event) => setOfferAsset(event.target.value as AssetId)}
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100"
          >
            {ASSETS.map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.label}
              </option>
            ))}
          </select>

          <input
            type="number"
            min={0}
            value={offerQty}
            onChange={(event) =>
              setOfferQty(Math.max(0, Number(event.target.value || 0)))
            }
            className="w-32 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-right text-slate-100"
          />

          <span className="text-slate-400">
            {offerAsset === "cash" ? "$" : "qty"}
          </span>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/40 p-4">
        <h4 className="font-semibold text-slate-100">You want</h4>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <select
            value={requestAsset}
            onChange={(event) =>
              setRequestAsset(event.target.value as AssetId)
            }
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100"
          >
            {ASSETS.map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.label}
              </option>
            ))}
          </select>

          <input
            type="number"
            min={0}
            value={requestQty}
            onChange={(event) =>
              setRequestQty(Math.max(0, Number(event.target.value || 0)))
            }
            className="w-32 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-right text-slate-100"
          />

          <span className="text-slate-400">
            {requestAsset === "cash" ? "$" : "qty"}
          </span>
        </div>
      </div>

      <button
        type="button"
        disabled={!canSend || sending}
        onClick={sendTradeProposal}
        className="mt-4 w-full rounded-xl bg-blue-600 px-4 py-3 font-semibold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-slate-700"
      >
        {sending ? "Sending..." : "Send Trade Proposal to Team"}
      </button>

      <p className="mt-3 text-sm text-slate-400">
        The teacher will only see the trade after the receiving team accepts it.
      </p>
    </div>
  );
}