import { useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
} from "firebase/firestore";

import { db } from "../lib/firebase";
import { ASSETS, type AssetId, assetLabel } from "../lib/items";

type TeamRow = {
  id: string;
};

export default function TeamRentalForm({
  gameId,
  teamId,
  roundNumber,
}: {
  gameId: string;
  teamId: string;
  roundNumber: number;
}) {
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [ownerTeamId, setOwnerTeamId] = useState("");

  const [itemKey, setItemKey] = useState<AssetId>("paper");
  const [qty, setQty] = useState(1);
  const [feePerItemPerRound, setFeePerItemPerRound] = useState(10);
  const [durationRounds, setDurationRounds] = useState(1);

  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

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

        setOwnerTeamId((current) => {
          if (current && otherTeams.some((team) => team.id === current)) {
            return current;
          }

          return otherTeams[0]?.id ?? "";
        });
      },
      (error) => {
        console.error("Rental team list listener error:", error);
        setErr(error.message);
      }
    );

    return () => unsub();
  }, [gameId, teamId]);

  const feePerRound = useMemo(() => {
    return Math.max(0, qty) * Math.max(0, feePerItemPerRound);
  }, [qty, feePerItemPerRound]);

  const totalExpectedFee = useMemo(() => {
    return feePerRound * Math.max(1, durationRounds);
  }, [feePerRound, durationRounds]);

  const canSend = useMemo(() => {
    if (!ownerTeamId) return false;
    if (ownerTeamId === teamId) return false;
    if (!itemKey) return false;
    if (qty <= 0) return false;
    if (feePerItemPerRound < 0) return false;
    if (durationRounds <= 0) return false;

    return true;
  }, [ownerTeamId, teamId, itemKey, qty, feePerItemPerRound, durationRounds]);

  async function submitRentalRequest() {
    setErr(null);
    setMsg(null);
    setSending(true);

    try {
      if (!canSend) {
        throw new Error("Please complete the rental request correctly.");
      }

      const rentalsRef = collection(db, "games", gameId, "rentals");

      await addDoc(rentalsRef, {
        status: "WAITING_OWNER",

        roundNumber,

        ownerTeamId,
        borrowerTeamId: teamId,

        itemKey,
        qty,
        feePerItemPerRound,
        feePerRound,

        durationRounds,
        startRound: null,
        dueRound: null,

        unpaidDebt: 0,

        createdAt: serverTimestamp(),

        ownerAcceptedAt: null,
        ownerRejectedAt: null,

        teacherApprovedAt: null,
        teacherRejectedAt: null,

        returnRequestedAt: null,
        returnConfirmedAt: null,
      });

      setMsg(
        `Rental request sent to ${ownerTeamId}: borrow ${qty} ${assetLabel(
          itemKey
        )} for ${durationRounds} round${
          durationRounds > 1 ? "s" : ""
        }, fee $${feePerRound} per round.`
      );

      setQty(1);
      setFeePerItemPerRound(10);
      setDurationRounds(1);
    } catch (error: any) {
      console.error("Submit rental request error:", error);
      setErr(error?.message ?? String(error));
    } finally {
      setSending(false);
    }
  }

  return (
    <div>
      <h3 className="text-lg font-semibold text-slate-100">
        Create Rental Request
      </h3>

      <p className="mt-1 text-sm text-slate-400">
        Request to borrow an item from another team. The owner team must accept
        first, then the teacher gives final approval.
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

      <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/40 p-4">
        <h4 className="font-semibold text-slate-100">Rental Target</h4>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="font-semibold text-slate-200">Borrow from:</label>

          <select
            value={ownerTeamId}
            onChange={(event) => setOwnerTeamId(event.target.value)}
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
      </div>

      <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/40 p-4">
        <h4 className="font-semibold text-slate-100">Item to Borrow</h4>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <select
            value={itemKey}
            onChange={(event) => setItemKey(event.target.value as AssetId)}
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100"
          >
            {ASSETS.filter((asset) => asset.id !== "cash").map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.label}
              </option>
            ))}
          </select>

          <label className="text-slate-300">Quantity:</label>

          <input
            type="number"
            min={1}
            value={qty}
            onChange={(event) =>
              setQty(Math.max(1, Math.floor(Number(event.target.value || 1))))
            }
            className="w-28 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-right text-slate-100"
          />
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/40 p-4">
        <h4 className="font-semibold text-slate-100">Rental Fee</h4>

        <p className="mt-1 text-sm text-slate-400">
          This is the amount your team proposes to pay to the owner team each
          round.
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="text-slate-300">Fee per item per round:</label>

          <input
            type="number"
            min={0}
            value={feePerItemPerRound}
            onChange={(event) =>
              setFeePerItemPerRound(
                Math.max(0, Math.floor(Number(event.target.value || 0)))
              )
            }
            className="w-32 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-right text-slate-100"
          />

          <span className="text-slate-400">$</span>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="text-slate-300">Number of rounds:</label>

          <input
            type="number"
            min={1}
            value={durationRounds}
            onChange={(event) =>
              setDurationRounds(
                Math.max(1, Math.floor(Number(event.target.value || 1)))
              )
            }
            className="w-28 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-right text-slate-100"
          />
        </div>

        <div className="mt-4 rounded-lg border border-blue-500/30 bg-blue-950/30 p-3 text-blue-100">
          <div className="font-semibold">Fee summary</div>

          <div className="mt-1 text-sm">
            {qty} × ${feePerItemPerRound} ={" "}
            <b>${feePerRound} per round</b>
          </div>

          <div className="mt-1 text-sm">
            Expected total for {durationRounds} round
            {durationRounds > 1 ? "s" : ""}:{" "}
            <b>${totalExpectedFee}</b>
          </div>
        </div>
      </div>

      <button
        type="button"
        disabled={!canSend || sending}
        onClick={submitRentalRequest}
        className="mt-4 w-full rounded-xl bg-blue-600 px-4 py-3 font-semibold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-slate-700"
      >
        {sending ? "Sending..." : "Send Rental Request"}
      </button>

      <p className="mt-3 text-sm text-slate-400">
        The teacher will only see this rental request after the owner team
        accepts it.
      </p>
    </div>
  );
}