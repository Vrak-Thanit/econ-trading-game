import { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";
import type { Timestamp } from "firebase/firestore";
import { db } from "../lib/firebase";
import { type AssetId, assetLabel } from "../lib/items";

type TradeDoc = {
  status: "PENDING" | "ACCEPTED" | "DECLINED";
  roundNumber: number;
  fromTeamId: string;
  toTeamId: string;
  offerAsset: AssetId;
  offerQty: number;
  requestAsset: AssetId;
  requestQty: number;
  createdAt?: Timestamp;
};

function formatTime(t?: Timestamp) {
  if (!t) return "-";
  const d = t.toDate();
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function TeacherTradesBoard({ gameId }: { gameId: string }) {
  const [trades, setTrades] = useState<(TradeDoc & { id: string })[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setErr(null);
    const ref = collection(db, "games", gameId, "trades");
    const q = query(ref, orderBy("createdAt", "desc"));

    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows: (TradeDoc & { id: string })[] = [];
        snap.forEach((d) => rows.push({ id: d.id, ...(d.data() as TradeDoc) }));
        setTrades(rows);
      },
      (e) => setErr(e.message)
    );

    return () => unsub();
  }, [gameId]);

  const pending = useMemo(() => trades.filter((t) => t.status === "PENDING"), [trades]);

  if (err) return <div style={{ color: "crimson" }}>{err}</div>;

  return (
    <div style={{ border: "1px solid #444", borderRadius: 12, padding: 12, maxWidth: 1000 }}>
      <h3 style={{ marginTop: 0 }}>Trade Requests (Teacher Approval)</h3>

      {pending.length === 0 ? (
        <div style={{ opacity: 0.8 }}>No pending trades.</div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", borderBottom: "1px solid #444", padding: 6 }}>Time</th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #444", padding: 6 }}>From</th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #444", padding: 6 }}>To</th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #444", padding: 6 }}>Offer</th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #444", padding: 6 }}>Request</th>
              <th style={{ textAlign: "right", borderBottom: "1px solid #444", padding: 6 }}>Round</th>
              <th style={{ textAlign: "right", borderBottom: "1px solid #444", padding: 6 }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {pending.map((t) => (
              <tr key={t.id}>
                <td style={{ padding: 6 }}>{formatTime(t.createdAt)}</td>
                <td style={{ padding: 6 }}>{t.fromTeamId}</td>
                <td style={{ padding: 6 }}>{t.toTeamId}</td>
                <td style={{ padding: 6 }}>
                  {t.offerQty} {assetLabel(t.offerAsset)}
                </td>
                <td style={{ padding: 6 }}>
                  {t.requestQty} {assetLabel(t.requestAsset)}
                </td>
                <td style={{ padding: 6, textAlign: "right" }}>{t.roundNumber}</td>
                <td style={{ padding: 6, textAlign: "right" }}>
                  <button
                    style={{ padding: "6px 10px", marginRight: 8 }}
                    onClick={async () => {
                      setErr(null);
                      try {
                        await runTransaction(db, async (tx) => {
                          const tradeRef = doc(db, "games", gameId, "trades", t.id);
                          const tradeSnap = await tx.get(tradeRef);
                          if (!tradeSnap.exists()) throw new Error("Trade not found");
                          const trade = tradeSnap.data() as TradeDoc;
                          if (trade.status !== "PENDING") throw new Error("Trade already processed");

                          const fromRef = doc(db, "games", gameId, "teams", trade.fromTeamId);
                          const toRef = doc(db, "games", gameId, "teams", trade.toTeamId);

                          const fromSnap = await tx.get(fromRef);
                          const toSnap = await tx.get(toRef);
                          if (!fromSnap.exists()) throw new Error("From team not found");
                          if (!toSnap.exists()) throw new Error("To team not found");

                          const from = fromSnap.data() as any;
                          const to = toSnap.data() as any;

                          const fromInv = (from.inventory ?? {}) as Record<string, number>;
                          const toInv = (to.inventory ?? {}) as Record<string, number>;

                          const getBal = (obj: any, inv: Record<string, number>, asset: AssetId) => {
                            if (asset === "cash") return Number(obj.cash ?? 0);
                            return Number(inv[asset] ?? 0);
                          };

                          const addDelta = (m: Record<string, number>, asset: AssetId, delta: number) => {
                            m[asset] = (m[asset] ?? 0) + delta;
                          };

                          const fromDelta: Record<string, number> = {};
                          const toDelta: Record<string, number> = {};

                          addDelta(fromDelta, trade.offerAsset, -Number(trade.offerQty ?? 0));
                          addDelta(fromDelta, trade.requestAsset, +Number(trade.requestQty ?? 0));

                          addDelta(toDelta, trade.offerAsset, +Number(trade.offerQty ?? 0));
                          addDelta(toDelta, trade.requestAsset, -Number(trade.requestQty ?? 0));

                          // Validate enough balance for negative deltas
                          for (const [assetStr, delta] of Object.entries(fromDelta)) {
                            if (delta < 0) {
                              const asset = assetStr as AssetId;
                              const cur = getBal(from, fromInv, asset);
                              if (cur + delta < 0) throw new Error(`From team lacks ${assetLabel(asset)}.`);
                            }
                          }
                          for (const [assetStr, delta] of Object.entries(toDelta)) {
                            if (delta < 0) {
                              const asset = assetStr as AssetId;
                              const cur = getBal(to, toInv, asset);
                              if (cur + delta < 0) throw new Error(`To team lacks ${assetLabel(asset)}.`);
                            }
                          }

                          const fromUpdates: any = {};
                          const toUpdates: any = {};

                          for (const [assetStr, delta] of Object.entries(fromDelta)) {
                            const asset = assetStr as AssetId;
                            const cur = getBal(from, fromInv, asset);
                            const next = cur + delta;
                            if (asset === "cash") fromUpdates.cash = next;
                            else fromUpdates[`inventory.${asset}`] = next;
                          }

                          for (const [assetStr, delta] of Object.entries(toDelta)) {
                            const asset = assetStr as AssetId;
                            const cur = getBal(to, toInv, asset);
                            const next = cur + delta;
                            if (asset === "cash") toUpdates.cash = next;
                            else toUpdates[`inventory.${asset}`] = next;
                          }

                          tx.update(fromRef, fromUpdates);
                          tx.update(toRef, toUpdates);

                          tx.update(tradeRef, {
                            status: "ACCEPTED",
                            acceptedAt: serverTimestamp(),
                          });

                          const logRef = doc(collection(db, "games", gameId, "logs"));
                          tx.set(logRef, {
                            type: "TRADE",
                            createdAt: serverTimestamp(),
                            roundNumber: trade.roundNumber,
                            message:
                              `Trade accepted: ${trade.fromTeamId} gave ${trade.offerQty} ${trade.offerAsset} ` +
                              `to ${trade.toTeamId} for ${trade.requestQty} ${trade.requestAsset}.`,
                          });
                        });

                        alert("Trade accepted ✅");
                      } catch (e: any) {
                        setErr(e?.message ?? String(e));
                      }
                    }}
                  >
                    Accept
                  </button>

                  <button
                    style={{ padding: "6px 10px" }}
                    onClick={async () => {
                      setErr(null);
                      try {
                        await runTransaction(db, async (tx) => {
                          const tradeRef = doc(db, "games", gameId, "trades", t.id);
                          const tradeSnap = await tx.get(tradeRef);
                          if (!tradeSnap.exists()) throw new Error("Trade not found");
                          const trade = tradeSnap.data() as TradeDoc;
                          if (trade.status !== "PENDING") throw new Error("Trade already processed");

                          tx.update(tradeRef, { status: "DECLINED", declinedAt: serverTimestamp() });

                          const logRef = doc(collection(db, "games", gameId, "logs"));
                          tx.set(logRef, {
                            type: "TRADE",
                            createdAt: serverTimestamp(),
                            roundNumber: trade.roundNumber,
                            message:
                              `Trade declined: ${trade.fromTeamId} → ${trade.toTeamId} ` +
                              `(offer ${trade.offerQty} ${trade.offerAsset}, request ${trade.requestQty} ${trade.requestAsset}).`,
                          });
                        });

                        alert("Trade declined ✅");
                      } catch (e: any) {
                        setErr(e?.message ?? String(e));
                      }
                    }}
                  >
                    Decline
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {err && <div style={{ marginTop: 8, color: "crimson" }}>{err}</div>}
      <small style={{ opacity: 0.75 }}>
        Approving a trade updates both teams’ inventory/cash atomically (no cheating).
      </small>
    </div>
  );
}
