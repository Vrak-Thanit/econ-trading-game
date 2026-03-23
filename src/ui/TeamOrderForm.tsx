import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { useMemo, useState } from "react";
import { db } from "../lib/firebase";

const SHAPES = ["circle", "rectangle", "protractor", "equilateral", "triangle"] as const;

export default function TeamOrderForm({
  gameId,
  teamId,
  roundNumber,
  phase,
}: {
  gameId: string;
  teamId: string;
  roundNumber: number;
  phase: string;
}) {
  const [shape, setShape] = useState<(typeof SHAPES)[number]>("circle");
  const [qty, setQty] = useState<number>(0);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const canSubmit = useMemo(() => phase === "LIVE" && qty > 0, [phase, qty]);

  return (
    <div style={{ border: "1px solid #444", borderRadius: 12, padding: 12, maxWidth: 520 }}>
      <h3>Submit Order (Intent)</h3>
      <div style={{ opacity: 0.8, marginBottom: 8 }}>
        Round: <b>{roundNumber}</b> | Phase: <b>{phase}</b>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <label>
          Shape{" "}
          <select value={shape} onChange={(e) => setShape(e.target.value as any)}>
            {SHAPES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>

        <label>
          Qty{" "}
          <input
            type="number"
            min={0}
            value={qty}
            onChange={(e) => setQty(Math.max(0, Number(e.target.value || 0)))}
            style={{ width: 90 }}
          />
        </label>

        <button
          disabled={!canSubmit || sending}
          onClick={async () => {
            setSending(true);
            setErr(null);
            setMsg(null);
            try {
              const ref = collection(db, "games", gameId, "orders");
              await addDoc(ref, {
                teamId,
                roundNumber,
                shape,
                plannedQty: qty,
                createdAt: serverTimestamp(),
              });
              setMsg("Order submitted ✅ (teacher will review)");
              setQty(0);
            } catch (e: any) {
              setErr(e?.message ?? String(e));
            } finally {
              setSending(false);
            }
          }}
          style={{ padding: "8px 12px" }}
        >
          {sending ? "Sending..." : "Submit"}
        </button>
      </div>

      {!canSubmit && (
        <div style={{ marginTop: 8, color: "#bbb" }}>
          You can submit only during <b>LIVE</b> phase, and qty must be &gt; 0.
        </div>
      )}

      {msg && <div style={{ marginTop: 8, color: "lightgreen" }}>{msg}</div>}
      {err && <div style={{ marginTop: 8, color: "crimson" }}>{err}</div>}
    </div>
  );
}
