import { collection, onSnapshot } from "firebase/firestore";
import { useEffect, useState } from "react";
import { db } from "./firebase";

export type TeamRow = {
  teamId: string;
  incomeTier?: string;
};

export function useTeams(gameId: string) {
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setErr(null);
    const ref = collection(db, "games", gameId, "teams");
    const unsub = onSnapshot(
      ref,
      (snap) => {
        const rows: TeamRow[] = [];
        snap.forEach((d) => rows.push({ teamId: d.id, ...(d.data() as any) }));
        rows.sort((a, b) => a.teamId.localeCompare(b.teamId));
        setTeams(rows);
      },
      (e) => setErr(e.message)
    );
    return () => unsub();
  }, [gameId]);

  return { teams, err };
}
