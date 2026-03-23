import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import { db } from "../lib/firebase";
import { ITEMS } from "../lib/items";

type TeamDoc = {
  incomeTier?: string;
  cash?: number;
  inventory?: Record<string, number>;
  reliability?: number;
};

export default function InventoryBoard({ gameId }: { gameId: string }) {
  const [rows, setRows] = useState<{ id: string; data: TeamDoc }[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setErr(null);
    const ref = collection(db, "games", gameId, "teams");
    const q = query(ref, orderBy("incomeTier", "asc"));

    const unsub = onSnapshot(
      q,
      (snap) => {
        const r: { id: string; data: TeamDoc }[] = [];
        snap.forEach((d) => r.push({ id: d.id, data: d.data() as TeamDoc }));
        setRows(r);
      },
      (e) => setErr(e.message)
    );

    return () => unsub();
  }, [gameId]);

  const headerItems = useMemo(() => ITEMS, []);

  if (err) return <div style={{ color: "crimson" }}>{err}</div>;

  return (
    <div style={{ border: "1px solid #444", borderRadius: 12, padding: 12, maxWidth: 1200 }}>
      <h3 style={{ marginTop: 0 }}>Inventory Board (Live)</h3>

      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 900 }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", borderBottom: "1px solid #444", padding: 6 }}>Team</th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #444", padding: 6 }}>Tier</th>
              <th style={{ textAlign: "right", borderBottom: "1px solid #444", padding: 6 }}>Cash</th>
              <th style={{ textAlign: "right", borderBottom: "1px solid #444", padding: 6 }}>Reliability</th>
              {headerItems.map((it) => (
                <th key={it.id} style={{ textAlign: "right", borderBottom: "1px solid #444", padding: 6 }}>
                  {it.label}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {rows.map((t) => {
              const inv = t.data.inventory ?? {};
              return (
                <tr key={t.id}>
                  <td style={{ padding: 6, borderBottom: "1px solid #333" }}>{t.id}</td>
                  <td style={{ padding: 6, borderBottom: "1px solid #333" }}>{t.data.incomeTier ?? "-"}</td>
                  <td style={{ padding: 6, borderBottom: "1px solid #333", textAlign: "right" }}>
                    {Number(t.data.cash ?? 0)}
                  </td>
                  <td style={{ padding: 6, borderBottom: "1px solid #333", textAlign: "right" }}>
                    {Number(t.data.reliability ?? 100)}
                  </td>

                  {headerItems.map((it) => (
                    <td
                      key={it.id}
                      style={{ padding: 6, borderBottom: "1px solid #333", textAlign: "right" }}
                    >
                      {Number(inv[it.id] ?? 0)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <small style={{ opacity: 0.75 }}>
        This updates automatically after teacher approves trades or adjusts consumables.
      </small>
    </div>
  );
}
