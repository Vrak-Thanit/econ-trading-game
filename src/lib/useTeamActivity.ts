// src/lib/useTeamActivity.ts
import { useEffect, useMemo, useState } from "react";
import { db } from "./firebase";
import { collection, limit, onSnapshot, orderBy, query, where } from "firebase/firestore";

type ActivityType = "ORDER" | "SALE";

export type ActivityEvent = {
  type: ActivityType;
  id: string;
  tsMs: number; // timestamp in milliseconds for sorting
  title: string;
  detail?: string;
  roundNumber?: number;
};

function tsToMs(ts: any): number {
  if (!ts) return 0;
  if (typeof ts.toMillis === "function") return ts.toMillis();
  if (typeof ts.seconds === "number") return ts.seconds * 1000;
  return 0;
}

function toInt0(v: any): number {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

function pickFirst(...vals: any[]) {
  for (const v of vals) {
    if (v !== null && v !== undefined && v !== "") return v;
  }
  return undefined;
}

export function useTeamActivity(opts: { gameId: string; teamId: string; maxPerType?: number }) {
  const { gameId, teamId, maxPerType = 25 } = opts;

  const [orders, setOrders] = useState<ActivityEvent[]>([]);
  const [sales, setSales] = useState<ActivityEvent[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setErr(null);

    // ---------- Orders ----------
    const ordersRef = collection(db, "games", gameId, "orders");
    const qOrders = query(
      ordersRef,
      where("teamId", "==", teamId),
      orderBy("createdAt", "desc"),
      limit(maxPerType)
    );

    const unsubOrders = onSnapshot(
      qOrders,
      (snap) => {
        const rows: ActivityEvent[] = [];
        snap.forEach((d) => {
          const o: any = d.data();

          const shape = String(o.shape ?? "");
          const qty = toInt0(pickFirst(o.plannedQty, o.qty, 0));
          const roundNumber = toInt0(pickFirst(o.roundNumber, 0));

          rows.push({
            type: "ORDER",
            id: d.id,
            tsMs: tsToMs(o.createdAt),
            title: "Order submitted",
            detail: shape ? `${shape} × ${qty}` : `Qty ${qty}`,
            roundNumber,
          });
        });
        setOrders(rows);
      },
      (e) => setErr(e.message)
    );

    // ---------- Sales / Processed (teacher) ----------
    const salesRef = collection(db, "games", gameId, "sales");
    const qSales = query(
      salesRef,
      where("teamId", "==", teamId),
      orderBy("createdAt", "desc"),
      limit(maxPerType)
    );

    const unsubSales = onSnapshot(
      qSales,
      (snap) => {
        const rows: ActivityEvent[] = [];
        snap.forEach((d) => {
          const s: any = d.data();

          // item name (your writes use shape + item)
          const shape = String(pickFirst(s.shape, s.item, s.itemKey, ""));

          // ✅ DISPLAY qty should be the processed/accepted qty
          // Prefer acceptedQty first, then qty (older UI), then deliveredQty (last fallback)
          const qtyDisplay = toInt0(
            pickFirst(
              s.acceptedQty,     // best: real processed qty
              s.qty,             // fallback: older docs
              s.deliveredQty,    // last fallback
              s.amount,
              s.quantity,
              0
            )
          );

          // economy breakdown (optional)
          const qtySold = toInt0(pickFirst(s.qtySold, 0));
          const qtyUnpaid = toInt0(pickFirst(s.qtyUnpaid, s.buckets?.["0"], 0));

          // ✅ DELIVERY ONLY detection
          const isDeliveryOnly = qtySold === 0 && qtyUnpaid > 0;

          // ✅ DISPLAY price
          // If delivery-only => show @0
          const priceDisplay = isDeliveryOnly
            ? 0
            : toInt0(pickFirst(s.price, s.unitPrice, s.marketUnitPrice, 0));

          const roundNumber = toInt0(pickFirst(s.roundNumber, 0));

          const title = isDeliveryOnly ? "Delivered (no sale)" : "Sale accepted";

          const breakdown =
            qtyUnpaid > 0
              ? ` (sold ${qtySold}, unpaid ${qtyUnpaid})`
              : "";

          rows.push({
            type: "SALE",
            id: d.id,
            tsMs: tsToMs(s.createdAt ?? s.acceptedAt),
            title,
            detail: shape
              ? `${shape} × ${qtyDisplay}${priceDisplay ? ` @ ${priceDisplay}` : ""}${breakdown}`
              : `Qty ${qtyDisplay}`,
            roundNumber,
          });
        });
        setSales(rows);
      },
      (e) => setErr(e.message)
    );

    return () => {
      unsubOrders();
      unsubSales();
    };
  }, [gameId, teamId, maxPerType]);

  const all = useMemo(() => {
    const merged = [...orders, ...sales];
    merged.sort((a, b) => b.tsMs - a.tsMs);
    return merged;
  }, [orders, sales]);

  return { events: all, err };
}
