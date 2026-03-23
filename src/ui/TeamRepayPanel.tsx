import { addDoc, collection, doc, onSnapshot, serverTimestamp } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import { db } from "../lib/firebase";

type GameDoc = {
  phase?: string;
  roundNumber?: number;
};

type TeamDoc = {
  cash?: number;
  debt?: number;
};

function num(n: any) {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}

function clampInt(n: any) {
  const v = Math.floor(Number(n));
  return Number.isFinite(v) ? Math.max(0, v) : 0;
}

export default function TeamRepayPanel({ gameId, teamId }: { gameId: string; teamId: string }) {
  const [game, setGame] = useState<GameDoc | null>(null);
  const [team, setTeam] = useState<TeamDoc | null>(null);

  const [amount, setAmount] = useState<number>(0);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setErr(null);

    const gref = doc(db, "games", gameId);
    const tref = doc(db, "games", gameId, "teams", teamId);

    const unsubG = onSnapshot(
      gref,
      (s) => setGame(s.exists() ? (s.data() as GameDoc) : null),
      (e) => setErr(e.message)
    );

    const unsubT = onSnapshot(
      tref,
      (s) => {
        if (!s.exists()) {
          setTeam(null);
          setErr("Team doc not found.");
          return;
        }
        setTeam(s.data() as TeamDoc);
      },
      (e) => setErr(e.message)
    );

    return () => {
      unsubG();
      unsubT();
    };
  }, [gameId, teamId]);

  const phase = game?.phase ?? "-";
  const roundNumber = num(game?.roundNumber ?? 0);

  const cash = num(team?.cash ?? 0);
  const debt = num(team?.debt ?? 0);

  const maxRepay = useMemo(() => Math.max(0, Math.min(cash, debt)), [cash, debt]);
  const canRepay = phase === "INTERVAL" && maxRepay > 0;

  async function submitRepayRequest() {
    setSaving(true);
    setErr(null);
    setMsg(null);

    try {
      const pay = clampInt(amount);

      if (phase !== "INTERVAL") throw new Error("Repayment is only allowed during INTERVAL.");
      if (debt <= 0) throw new Error("You have no debt to repay.");
      if (cash <= 0) throw new Error("You have no cash to repay with.");
      if (pay <= 0) throw new Error("Enter a repayment amount > 0.");
      if (pay > maxRepay) throw new Error(`Too high. Max repay now is ${maxRepay}.`);

      // ✅ Must match Firestore rules path:
      // /games/{gameId}/loanRequests/{reqId}
      const reqRef = collection(db, "games", gameId, "loanRequests");

      await addDoc(reqRef, {
        teamId,
        action: "REPAY",
        amount: pay,
        status: "PENDING",
        roundNumber,
        createdAt: serverTimestamp(),
      });

      setMsg(`Repay request submitted ✅ (teacher will approve)`);
      setAmount(0);
    } catch (e: any) {
      const m = e?.message ?? String(e);
      if (m.toLowerCase().includes("missing or insufficient permissions")) {
        setErr(
          "Permission denied. Check your Firestore rules allow create in games/{gameId}/loanRequests and that users/{uid}.teamId matches this teamId."
        );
      } else {
        setErr(m);
      }
    } finally {
      setSaving(false);
    }
  }

  if (err) return <div style={{ color: "crimson" }}>{err}</div>;
  if (!game || !team) return <div>Loading repayment panel...</div>;

  return (
    <div style={{ border: "1px solid #444", borderRadius: 12, padding: 12, maxWidth: 900 }}>
      <h3 style={{ marginTop: 0 }}>Repay Debt (INTERVAL only)</h3>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
        <div><b>Phase:</b> {phase}</div>
        <div><b>Round:</b> {roundNumber}</div>
        <div><b>Debt:</b> {debt}</div>
        <div><b>Cash:</b> {cash}</div>
        <div><b>Max repay now:</b> {maxRepay}</div>
      </div>

      <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <input
          type="number"
          min={0}
          value={amount}
          onChange={(e) => setAmount(clampInt(e.target.value))}
          style={{ width: 140, padding: 8 }}
          disabled={!canRepay || saving}
        />

        <button
          style={{ padding: "8px 12px" }}
          onClick={() => setAmount(maxRepay)}
          disabled={!canRepay || saving}
        >
          Max
        </button>

        <button
          style={{ padding: "8px 12px" }}
          onClick={submitRepayRequest}
          disabled={!canRepay || saving}
        >
          {saving ? "Submitting..." : "Submit Repay Request"}
        </button>
      </div>

      {!canRepay && (
        <small style={{ opacity: 0.75 }}>
          Repayment is disabled unless phase = <b>INTERVAL</b>, and you have both <b>cash</b> and <b>debt</b>.
        </small>
      )}

      {msg && <div style={{ marginTop: 8, color: "lightgreen" }}>{msg}</div>}
      {err && <div style={{ marginTop: 8, color: "crimson" }}>{err}</div>}
    </div>
  );
}
