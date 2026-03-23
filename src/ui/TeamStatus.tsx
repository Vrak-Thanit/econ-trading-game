import { doc, onSnapshot } from "firebase/firestore";
import { useEffect, useState } from "react";
import { db } from "../lib/firebase";

type TeamDoc = {
  teamId?: string;
  incomeTier?: string;
  cash?: number;
  debt?: number;

  // ✅ NEW (Stage 3.2B)
  reliability?: number; // 0–100
  finesPaid?: number;   // total fines paid so far
};

export default function TeamStatus({
  gameId,
  teamId,
}: {
  gameId: string;
  teamId: string;
}) {
  const [team, setTeam] = useState<TeamDoc | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setErr(null);
    const ref = doc(db, "games", gameId, "teams", teamId);

    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) {
          setTeam(null);
          setErr(`Team doc not found: teams/${teamId}`);
          return;
        }
        setTeam(snap.data() as TeamDoc);
      },
      (e) => setErr(e.message)
    );

    return () => unsub();
  }, [gameId, teamId]);

  if (err) return <div style={{ color: "crimson" }}>{err}</div>;
  if (!team) return <div>Loading team status...</div>;

  const reliability = team.reliability ?? 100;
  const finesPaid = team.finesPaid ?? 0;

  return (
    <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
      <div><b>Income tier:</b> {team.incomeTier ?? "-"}</div>
      <div><b>Cash:</b> {team.cash ?? 0}</div>
      <div><b>Debt:</b> {team.debt ?? 0}</div>

      {/* ✅ NEW display */}
      <div><b>Reliability:</b> {reliability}</div>
      <div><b>Fines paid:</b> {finesPaid}</div>
    </div>
  );
}
