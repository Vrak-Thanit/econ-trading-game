// src/lib/processOrder.ts
import {
  collection,
  doc,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "./firebase";
import { SHAPES, type Shape } from "./roundEconomy";

export type QualityPreset = "WORST" | "BAD" | "NORMAL" | "GOOD" | "BEST";

const QUALITY_MULT: Record<QualityPreset, number> = {
  WORST: 0.5,
  BAD: 0.75,
  NORMAL: 1.0,
  GOOD: 1.25,
  BEST: 1.5,
};

function toInt0(v: any) {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

export async function processOrderTx(args: {
  gameId: string;
  roundNumber: number;
  orderId: string;
  teacherUid: string;
  qualityPreset: QualityPreset;
}) {
  const { gameId, roundNumber, orderId, teacherUid, qualityPreset } = args;

  const gameRef = doc(db, "games", gameId);
  const orderRef = doc(db, "games", gameId, "orders", orderId);

  await runTransaction(db, async (tx) => {
    // --- READS FIRST ---
    const gameSnap = await tx.get(gameRef);
    if (!gameSnap.exists()) throw new Error("Game not found");
    const game = gameSnap.data() as any;

    // ✅ Process during INTERVAL (your requirement)
    const phase = String(game.phase ?? "");
    if (phase !== "INTERVAL") {
      throw new Error("You can only process orders during INTERVAL phase.");
    }

    const orderSnap = await tx.get(orderRef);
    if (!orderSnap.exists()) throw new Error("Order not found");
    const order = orderSnap.data() as any;

    // guard round
    const oRound = Number(order.roundNumber ?? -1);
    if (oRound !== roundNumber) {
      throw new Error(`Order round mismatch. Order is R${oRound}, current is R${roundNumber}.`);
    }

    // prevent double process
    if (order.processedAt) {
      throw new Error("This order was already processed.");
    }

    const teamId = String(order.teamId ?? "");
    const shape = String(order.shape ?? "") as Shape;
    const plannedQty = toInt0(order.plannedQty);

    if (!teamId) throw new Error("Order missing teamId");
    if (!SHAPES.includes(shape)) throw new Error(`Invalid shape in order: ${shape}`);
    if (plannedQty <= 0) throw new Error("plannedQty must be > 0");

    const teamRef = doc(db, "games", gameId, "teams", teamId);
    const teamSnap = await tx.get(teamRef);
    if (!teamSnap.exists()) throw new Error("Team not found");
    const team = teamSnap.data() as any;

    const pricesMap = game.currentRound?.prices ?? {};
    const remainingMap = game.currentRound?.remainingDemand ?? {};

    const unitPrice = Number(pricesMap[shape] ?? 0);
    const remainingDemand = toInt0(remainingMap[shape]);

    // ✅ Key rule: sold is limited by remaining demand
    const soldQty = Math.min(plannedQty, remainingDemand);
    const unpaidQty = Math.max(0, plannedQty - soldQty);

    const mult = QUALITY_MULT[qualityPreset] ?? 1;
    const cashEarned = Math.round(unitPrice * soldQty * mult);

    // --- WRITES AFTER READS ---

    // 1) Remaining demand never negative
    tx.update(gameRef, {
      [`currentRound.remainingDemand.${shape}`]: Math.max(0, remainingDemand - soldQty),
    });

    // 2) Team gets money only for soldQty
    // 3) Team deliveredThisRound counts FULL plannedQty so they are NOT fined
    const prevCash = Number(team.cash ?? 0);
    const deliveredMap = team.deliveredThisRound ?? {};
    const prevDelivered = Number(deliveredMap?.[shape] ?? 0);

    tx.update(teamRef, {
      cash: prevCash + cashEarned,
      [`deliveredThisRound.${shape}`]: prevDelivered + plannedQty,
    });

    // 4) Mark order processed (and store sold/unpaid)
    tx.update(orderRef, {
      processedAt: serverTimestamp(),
      processedBy: teacherUid,
      qualityPreset,
      qualityMult: mult,
      soldQty,
      unpaidQty,
      cashEarned,
    });

    // 5) Create a sales record for activity/history
    // IMPORTANT for your UI: qty must be the processed qty (plannedQty), not 0
    const salesRef = doc(collection(db, "games", gameId, "sales"));
    tx.set(salesRef, {
      teamId,
      roundNumber,
      shape,
      item: shape,

      // UI means "processed qty"
      qty: plannedQty,
      // show unitPrice only if something sold; otherwise show 0 so it’s clear no pay
      price: soldQty > 0 ? unitPrice : 0,
      unitPrice: soldQty > 0 ? unitPrice : 0,

      // economy/logic fields
      qtySold: soldQty,
      qtyUnpaid: unpaidQty,
      marketUnitPrice: unitPrice,
      qualityPreset,
      qualityMult: mult,
      total: cashEarned,

      createdAt: serverTimestamp(),
      source: "ORDER_PROCESS",
      orderId,
    });

    // 6) Log (optional but helpful)
    const logRef = doc(collection(db, "games", gameId, "logs"));
    tx.set(logRef, {
      type: "ORDER_PROCESSED",
      roundNumber,
      createdAt: serverTimestamp(),
      message: `R${roundNumber}: ${teamId} ${shape} planned=${plannedQty} sold=${soldQty} unpaid=${unpaidQty} cash=${cashEarned} (${qualityPreset})`,
    });
  });
}
