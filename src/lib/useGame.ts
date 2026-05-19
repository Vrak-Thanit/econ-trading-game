import { doc, onSnapshot } from "firebase/firestore";
import { useEffect, useState } from "react";
import { db } from "./firebase";

export type GameDoc = {
  phase?: string;
  roundNumber?: number;
  currentRound?: any;
  title?: string;
  activeAuctionId?: string | null;
};

export function useGame(gameId: string) {
  const [game, setGame] = useState<GameDoc | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setErr(null);
    const ref = doc(db, "games", gameId);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) {
          setGame(null);
          setErr("Game not found.");
          return;
        }
        setGame(snap.data() as GameDoc);
      },
      (e) => setErr(e.message)
    );
    return () => unsub();
  }, [gameId]);

  return { game, err };
}
