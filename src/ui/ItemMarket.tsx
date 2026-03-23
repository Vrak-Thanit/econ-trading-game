import { doc, onSnapshot } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import { db } from "../lib/firebase";

type ItemPrice = { buy?: number | null; rent?: number | null };
type GameDoc = {
  itemPrices?: Record<string, ItemPrice>;
};

function formatMoney(v?: number | null) {
  if (v === null || v === undefined) return "N/A";
  return v.toString();
}

export default function ItemMarket({ gameId }: { gameId: string }) {
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

  const rows = useMemo(() => {
    const prices = game?.itemPrices ?? {};
    return Object.entries(prices)
      .map(([item, p]) => ({
        item,
        buy: p?.buy ?? null,
        rent: p?.rent ?? null,
      }))
      .sort((a, b) => a.item.localeCompare(b.item));
  }, [game]);

  if (err) return <div style={{ color: "crimson" }}>{err}</div>;
  if (!game) return <div>Loading item market...</div>;

  return (
    <div style={{ border: "1px solid #444", borderRadius: 12, padding: 12, maxWidth: 900 }}>
      <h3 style={{ marginTop: 0 }}>Item Market (Buy / Rent)</h3>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left", borderBottom: "1px solid #444", padding: 6 }}>Item</th>
            <th style={{ textAlign: "right", borderBottom: "1px solid #444", padding: 6 }}>Buy</th>
            <th style={{ textAlign: "right", borderBottom: "1px solid #444", padding: 6 }}>Rent / round</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.item}>
              <td style={{ padding: 6 }}>{r.item}</td>
              <td style={{ padding: 6, textAlign: "right" }}>{formatMoney(r.buy)}</td>
              <td style={{ padding: 6, textAlign: "right" }}>{formatMoney(r.rent)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ marginTop: 6, opacity: 0.75 }}>
        Note: N/A means that action is not allowed for that item.
      </div>
    </div>
  );
}
