import { doc, onSnapshot } from "firebase/firestore";
import { useEffect, useState } from "react";
import { db } from "../lib/firebase";

type GameDoc = {
  title?: string;
  phase?: string;
  roundNumber?: number;
  interestRate?: number;
  shapeBasePrices?: Record<string, number>;
  currentRound?: {
    demand?: Record<string, number>;
    remainingDemand?: Record<string, number>;
    prices?: Record<string, number>;
  };
};

export default function GameStatus({ gameId }: { gameId: string }) {
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
          setErr("Game not found. Check gameId.");
          return;
        }
        setGame(snap.data() as GameDoc);
      },
      (e) => setErr(e.message)
    );
    return () => unsub();
  }, [gameId]);

  if (err) return <div style={{ color: "crimson" }}>{err}</div>;
  if (!game) return <div>Loading game...</div>;

  const prices = game.currentRound?.prices ?? {};
  const demand = game.currentRound?.demand ?? {};
  const remaining = game.currentRound?.remainingDemand ?? {};

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <h3>{game.title ?? "Game"}</h3>
      <div><b>Phase:</b> {game.phase}</div>
      <div><b>Round:</b> {game.roundNumber}</div>

      <h4>Market</h4>
      <table style={{ borderCollapse: "collapse", width: "100%", maxWidth: 700 }}>
        <thead>
          <tr>
            <th style={{ borderBottom: "1px solid #444", textAlign: "left", padding: 6 }}>Shape</th>
            <th style={{ borderBottom: "1px solid #444", textAlign: "right", padding: 6 }}>Price</th>
            <th style={{ borderBottom: "1px solid #444", textAlign: "right", padding: 6 }}>Demand</th>
            <th style={{ borderBottom: "1px solid #444", textAlign: "right", padding: 6 }}>Remaining</th>
          </tr>
        </thead>
        <tbody>
          {Object.keys(prices).sort().map((k) => (
            <tr key={k}>
              <td style={{ padding: 6 }}>{k}</td>
              <td style={{ padding: 6, textAlign: "right" }}>{prices[k] ?? "-"}</td>
              <td style={{ padding: 6, textAlign: "right" }}>{demand[k] ?? 0}</td>
              <td style={{ padding: 6, textAlign: "right" }}>{remaining[k] ?? 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
