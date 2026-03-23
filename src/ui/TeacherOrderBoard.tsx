// src/ui/TeacherOrdersBoard.tsx
import { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  Timestamp,
} from "firebase/firestore";

import { db } from "../lib/firebase";
import { useAuth } from "../lib/authContext";
import { processOrderTx, type QualityPreset } from "../lib/processOrder";
import { SHAPES, type Shape } from "../lib/roundEconomy";

type OrderDoc = {
  id: string;
  teamId: string;
  roundNumber: number;
  shape: Shape;
  plannedQty: number;
  createdAt?: Timestamp;
  processedAt?: Timestamp;
};

type DemandMap = Record<string, number>;

const QUALITY_OPTIONS: { value: QualityPreset; label: string }[] = [
  { value: "WORST", label: "Worst" },
  { value: "BAD", label: "Bad" },
  { value: "NORMAL", label: "Normal" },
  { value: "GOOD", label: "Good" },
  { value: "BEST", label: "Best" },
];

function toInt0(v: any) {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

function tsToMs(t?: Timestamp) {
  return t ? t.toMillis() : 0;
}

function formatTime(t?: Timestamp) {
  if (!t) return "-";
  const d = t.toDate();
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function normalizeRemainingDemand(raw: any): DemandMap {
  const out: DemandMap = {};
  for (const s of SHAPES) out[s] = toInt0(raw?.[s] ?? 0);
  return out;
}

function OrderRow(props: {
  gameId: string;
  boardRound: number;
  phase: string;
  order: OrderDoc;
  remainingDemand: DemandMap;
  reliability: number;
  isLatestForKey: boolean;
}) {
  const { user } = useAuth();
  const { gameId, boardRound, phase, order, remainingDemand, reliability, isLatestForKey } = props;

  const [preset, setPreset] = useState<QualityPreset>("NORMAL");
  const [saving, setSaving] = useState(false);
  const [rowErr, setRowErr] = useState<string | null>(null);

  const planned = toInt0(order.plannedQty);
  const remaining = toInt0(remainingDemand?.[order.shape] ?? 0);

  // Preview only (real sold/unpaid is decided inside processOrderTx using the latest remaining demand)
  const autoSold = Math.min(planned, remaining);
  const unpaid = Math.max(0, planned - autoSold);

  const canProcess =
    phase === "INTERVAL" &&
    !order.processedAt &&
    isLatestForKey &&
    planned > 0 &&
    !!user?.uid;

  return (
    <tr style={{ borderBottom: "1px solid #222" }}>
      <td style={{ padding: 6 }}>{order.teamId}</td>
      <td style={{ padding: 6, textAlign: "right" }}>{reliability}</td>
      <td style={{ padding: 6 }}>{order.shape}</td>
      <td style={{ padding: 6, textAlign: "right" }}>{planned}</td>
      <td style={{ padding: 6, textAlign: "right" }}>{remaining}</td>
      <td style={{ padding: 6, textAlign: "right" }}>{autoSold}</td>
      <td style={{ padding: 6, textAlign: "right" }}>{unpaid}</td>
      <td style={{ padding: 6, textAlign: "right" }}>{formatTime(order.createdAt)}</td>

      <td style={{ padding: 6 }}>
        <select
          value={preset}
          onChange={(e) => setPreset(e.target.value as QualityPreset)}
          style={{ padding: 6, borderRadius: 8, border: "1px solid #333", background: "#0b1220", color: "white" }}
        >
          {QUALITY_OPTIONS.map((q) => (
            <option key={q.value} value={q.value}>
              {q.label}
            </option>
          ))}
        </select>
      </td>

      <td style={{ padding: 6 }}>
        {order.processedAt ? (
          <span style={{ color: "lightgreen" }}>✅ processed</span>
        ) : !isLatestForKey ? (
          <span style={{ opacity: 0.75 }}>Old submission</span>
        ) : phase !== "INTERVAL" ? (
          <span style={{ opacity: 0.75 }}>Process in INTERVAL</span>
        ) : (
          <button
            disabled={!canProcess || saving}
            onClick={async () => {
              setRowErr(null);
              setSaving(true);
              try {
                if (!user?.uid) throw new Error("Not signed in");

                // IMPORTANT:
                // - processing is allowed in INTERVAL (your processOrderTx enforces this)
                // - if remaining demand is 0, it still processes; soldQty becomes 0, unpaidQty becomes plannedQty
                await processOrderTx({
                  gameId,
                  roundNumber: boardRound, // must match the board round you are processing
                  orderId: order.id,
                  teacherUid: user.uid,
                  qualityPreset: preset,
                });
              } catch (e: any) {
                setRowErr(e?.message ?? String(e));
              } finally {
                setSaving(false);
              }
            }}
            style={{
              padding: "6px 10px",
              borderRadius: 10,
              border: "1px solid #334155",
              background: "#111827",
              color: "white",
              cursor: saving ? "wait" : "pointer",
            }}
          >
            {saving ? "..." : "Process"}
          </button>
        )}

        {rowErr && (
          <div style={{ marginTop: 6, color: "crimson", whiteSpace: "pre-line" }}>
            {rowErr}
          </div>
        )}
      </td>
    </tr>
  );
}

export default function TeacherOrdersBoard(props: { gameId: string; roundNumber: number }) {
  const { gameId, roundNumber } = props;

  const [orders, setOrders] = useState<OrderDoc[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const [phase, setPhase] = useState<string>("-");
  const [remainingDemand, setRemainingDemand] = useState<DemandMap>(() => normalizeRemainingDemand({}));

  const [reliabilityByTeam, setReliabilityByTeam] = useState<Record<string, number>>({});

  // game listener: phase + remainingDemand
  useEffect(() => {
    setErr(null);
    const gref = doc(db, "games", gameId);

    return onSnapshot(
      gref,
      (snap) => {
        if (!snap.exists()) {
          setErr("Game not found");
          return;
        }
        const g = snap.data() as any;
        setPhase(String(g.phase ?? "-"));
        setRemainingDemand(normalizeRemainingDemand(g.currentRound?.remainingDemand));
      },
      (e) => setErr(e.message)
    );
  }, [gameId]);

  // orders listener (kept simple to avoid index issues)
  useEffect(() => {
    setErr(null);
    const ref = collection(db, "games", gameId, "orders");
    const q = query(ref, orderBy("createdAt", "asc"));

    return onSnapshot(
      q,
      (snap) => {
        const rows: OrderDoc[] = [];
        snap.forEach((d) => {
          const o = d.data() as any;
          const shape = String(o.shape ?? "") as Shape;

          rows.push({
            id: d.id,
            teamId: String(o.teamId ?? ""),
            roundNumber: Number(o.roundNumber ?? 0),
            shape,
            plannedQty: Number(o.plannedQty ?? o.qty ?? 0),
            createdAt: o.createdAt,
            processedAt: o.processedAt,
          });
        });

        // show only this board round + valid shapes
        setOrders(rows.filter((o) => o.roundNumber === roundNumber && SHAPES.includes(o.shape)));
      },
      (e) => setErr(e.message)
    );
  }, [gameId, roundNumber]);

  // teams reliability listener
  useEffect(() => {
    const ref = collection(db, "games", gameId, "teams");
    return onSnapshot(
      ref,
      (snap) => {
        const map: Record<string, number> = {};
        snap.forEach((d) => {
          const data = d.data() as any;
          map[d.id] = Number(data.reliability ?? 100);
        });
        setReliabilityByTeam(map);
      },
      (e) => setErr(e.message)
    );
  }, [gameId]);

  // latest per team+shape (only those can be processed when audit mode is ON)
  const latestMap = useMemo(() => {
    const m = new Map<string, OrderDoc>();
    for (const o of orders) {
      const key = `${o.teamId}|${o.shape}`;
      const prev = m.get(key);

      // if createdAt missing, treat as 0 (very old)
      const curT = tsToMs(o.createdAt);
      const prevT = prev ? tsToMs(prev.createdAt) : -1;

      if (!prev || curT > prevT) m.set(key, o);
    }
    return m;
  }, [orders]);

  const latestIds = useMemo(() => {
    const ids = new Map<string, string>();
    latestMap.forEach((o, key) => ids.set(key, o.id));
    return ids;
  }, [latestMap]);

  const byShape = useMemo(() => {
    const source = showAll ? orders : Array.from(latestMap.values());

    const grouped: Record<string, OrderDoc[]> = {};
    for (const s of SHAPES) grouped[s] = [];

    for (const o of source) grouped[o.shape]?.push(o);

    // sort: reliability desc, then time asc
    for (const s of SHAPES) {
      grouped[s].sort((a, b) => {
        const ra = Number(reliabilityByTeam[a.teamId] ?? 100);
        const rb = Number(reliabilityByTeam[b.teamId] ?? 100);
        if (rb !== ra) return rb - ra;
        return tsToMs(a.createdAt) - tsToMs(b.createdAt);
      });
    }

    return grouped;
  }, [orders, showAll, latestMap, reliabilityByTeam]);

  if (err) return <div style={{ color: "crimson" }}>{err}</div>;

  return (
    <div style={{ border: "1px solid #444", borderRadius: 12, padding: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <div>
          <h3 style={{ margin: 0 }}>Orders Board (Round {roundNumber})</h3>
          <div style={{ opacity: 0.85, marginTop: 4 }}>
            Phase: <b>{phase}</b> — Process orders in <b>INTERVAL</b>
          </div>
        </div>

        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="checkbox"
            checked={showAll}
            onChange={(e) => setShowAll(e.target.checked)}
          />
          Show all orders (audit)
        </label>
      </div>

      <div style={{ marginTop: 12, display: "grid", gap: 14 }}>
        {SHAPES.map((shape) => (
          <div key={shape} style={{ border: "1px solid #333", borderRadius: 10, padding: 10 }}>
            <h4 style={{ margin: "0 0 10px 0" }}>{shape.toUpperCase()}</h4>

            {byShape[shape].length === 0 ? (
              <div style={{ opacity: 0.7 }}>No orders</div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", borderBottom: "1px solid #444", padding: 6 }}>Team</th>
                    <th style={{ textAlign: "right", borderBottom: "1px solid #444", padding: 6 }}>Reliability</th>
                    <th style={{ textAlign: "left", borderBottom: "1px solid #444", padding: 6 }}>Shape</th>
                    <th style={{ textAlign: "right", borderBottom: "1px solid #444", padding: 6 }}>Planned</th>
                    <th style={{ textAlign: "right", borderBottom: "1px solid #444", padding: 6 }}>Remaining</th>
                    <th style={{ textAlign: "right", borderBottom: "1px solid #444", padding: 6 }}>Auto Sold</th>
                    <th style={{ textAlign: "right", borderBottom: "1px solid #444", padding: 6 }}>Unpaid (0x)</th>
                    <th style={{ textAlign: "right", borderBottom: "1px solid #444", padding: 6 }}>Time</th>
                    <th style={{ textAlign: "left", borderBottom: "1px solid #444", padding: 6 }}>Quality</th>
                    <th style={{ textAlign: "left", borderBottom: "1px solid #444", padding: 6 }}>Action</th>
                  </tr>
                </thead>

                <tbody>
                  {byShape[shape].map((o) => {
                    const key = `${o.teamId}|${o.shape}`;
                    const isLatestForKey = latestIds.get(key) === o.id;

                    return (
                      <OrderRow
                        key={o.id}
                        gameId={gameId}
                        boardRound={roundNumber}
                        phase={phase}
                        order={o}
                        remainingDemand={remainingDemand}
                        reliability={Number(reliabilityByTeam[o.teamId] ?? 100)}
                        isLatestForKey={isLatestForKey}
                      />
                    );
                  })}
                </tbody>
              </table>
            )}

            <div style={{ marginTop: 8, opacity: 0.75 }}>
              Priority: higher reliability first; ties use earlier time. Audit mode shows all submissions; only the latest
              submission per team+shape can be processed.
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
