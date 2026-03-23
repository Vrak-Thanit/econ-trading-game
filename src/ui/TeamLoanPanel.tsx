import { addDoc, collection, doc, onSnapshot, serverTimestamp } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import { db } from "../lib/firebase";
import { computeBorrowable, num, type IncomeTier } from "../lib/loanPolicy";

type TeamDoc = {
  incomeTier?: IncomeTier;
  cash?: number;
  debt?: number;
  reliability?: number;
};

type GameDoc = {
  phase?: string;
  roundNumber?: number;
  baseInterestRate?: number;
  graceAfterBorrowRounds?: number;
  graceRateMultiplier?: number;
};

export default function TeamLoanPanel({
  gameId,
  teamId,
}: {
  gameId: string;
  teamId: string;
}) {
  const [team, setTeam] = useState<TeamDoc | null>(null);
  const [game, setGame] = useState<GameDoc | null>(null);
  const [amount, setAmount] = useState<number>(0);
  const [mode, setMode] = useState<"BORROW" | "REPAY">("BORROW");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setErr(null);
    setMsg(null);

    const teamRef = doc(db, "games", gameId, "teams", teamId);
    const unsubTeam = onSnapshot(
      teamRef,
      (snap) => setTeam(snap.exists() ? (snap.data() as TeamDoc) : null),
      (e) => setErr(e.message)
    );

    const gameRef = doc(db, "games", gameId);
    const unsubGame = onSnapshot(
      gameRef,
      (snap) => setGame(snap.exists() ? (snap.data() as GameDoc) : null),
      (e) => setErr(e.message)
    );

    return () => {
      unsubTeam();
      unsubGame();
    };
  }, [gameId, teamId]);

  const cash = num(team?.cash ?? 0);
  const debt = num(team?.debt ?? 0);
  const reliability = num(team?.reliability ?? 100);
  const tier = (team?.incomeTier ?? "POOR") as IncomeTier;

  const netCash = cash - debt;

  const borrowable = useMemo(() => {
    return computeBorrowable({ incomeTier: tier, cash, debt, reliability });
  }, [tier, cash, debt, reliability]);

  const roundNumber = num(game?.roundNumber ?? 0);
  const phase = game?.phase ?? "-";
  const baseInterestRate = num(game?.baseInterestRate ?? 0.05);

  const canSubmit = phase === "INTERVAL"; // keep simple + consistent with your plan

  return (
    <div style={{ border: "1px solid #444", borderRadius: 12, padding: 12, maxWidth: 900 }}>
      <h3 style={{ marginTop: 0 }}>Bank / Loan Panel</h3>

      <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
        <div><b>Phase:</b> {phase}</div>
        <div><b>Round:</b> {roundNumber}</div>
        <div><b>Cash:</b> {cash}</div>
        <div><b>Debt:</b> {debt}</div>
        <div><b>Net Cash (cash−debt):</b> {netCash}</div>
        <div><b>Reliability:</b> {reliability}</div>
        <div><b>Borrow limit remaining:</b> {borrowable}</div>
        <div><b>Base interest:</b> {(baseInterestRate * 100).toFixed(1)}%</div>
      </div>

      <hr />

      {!canSubmit && (
        <div style={{ color: "salmon", marginBottom: 10 }}>
          Loan requests are available in <b>INTERVAL</b> only.
        </div>
      )}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <label>
          Action{" "}
          <select value={mode} onChange={(e) => setMode(e.target.value as any)} disabled={!canSubmit}>
            <option value="BORROW">Borrow</option>
            <option value="REPAY">Repay</option>
          </select>
        </label>

        <label>
          Amount{" "}
          <input
            type="number"
            min={0}
            value={amount}
            disabled={!canSubmit}
            onChange={(e) => setAmount(Math.max(0, Math.floor(Number(e.target.value || 0))))}
            style={{ width: 120, padding: 6 }}
          />
        </label>

        <button
          style={{ padding: "8px 12px" }}
          disabled={!canSubmit}
          onClick={async () => {
            setErr(null);
            setMsg(null);

            const amt = Math.max(0, Math.floor(amount));
            if (amt <= 0) return setErr("Amount must be > 0");

            if (mode === "BORROW") {
              if (borrowable <= 0) return setErr("You have no borrowing room (limit reached).");
              if (amt > borrowable) return setErr(`Too much. Max you can borrow now is ${borrowable}.`);
            }

            if (mode === "REPAY") {
              if (debt <= 0) return setErr("You have no debt to repay.");
              if (amt > cash) return setErr("You don't have enough cash to repay that amount.");
              if (amt > debt) return setErr(`Too much. Max you can repay now is ${debt}.`);
            }

            try {
              // ✅ MUST match your Firestore rules path:
              const reqRef = collection(db, "games", gameId, "loanRequests");

              await addDoc(reqRef, {
                teamId,                 // must match users/{uid}.teamId by rules
                action: mode,           // BORROW | REPAY (teacher can read this)
                amount: amt,
                status: "PENDING",      // required by rules
                roundNumber,
                createdAt: serverTimestamp(),
              });

              setMsg(`${mode} request submitted ✅ (waiting teacher approval)`);
              setAmount(0);
            } catch (e: any) {
              // Common helpful hint if rules fail:
              const m = e?.message ?? String(e);
              if (m.toLowerCase().includes("missing or insufficient permissions")) {
                setErr(
                  "Permission denied. Check that your users/{uid} doc exists and has the correct teamId, and that you are writing to games/{gameId}/loanRequests (not loans)."
                );
              } else {
                setErr(m);
              }
            }
          }}
        >
          Submit Request
        </button>
      </div>

      {msg && <div style={{ marginTop: 10, color: "lightgreen" }}>{msg}</div>}
      {err && <div style={{ marginTop: 10, color: "crimson" }}>{err}</div>}

      <small style={{ opacity: 0.75 }}>
        Borrow limit is based on <b>Net Cash</b> (cash−debt), tier, and reliability — borrowing can’t “boost” your limit.
      </small>
    </div>
  );
}
