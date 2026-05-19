import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  collection,
  doc,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import type { Timestamp } from "firebase/firestore";

import { db } from "../lib/firebase";
import { assetLabel, type AssetId } from "../lib/items";

type RentalStatus =
  | "WAITING_OWNER"
  | "OWNER_REJECTED"
  | "WAITING_TEACHER"
  | "TEACHER_REJECTED"
  | "ACTIVE"
  | "RETURN_DUE"
  | "RETURN_REQUESTED"
  | "OWNER_CONFIRMED_RETURN"
  | "RETURN_CONFIRMED";

type RentalDoc = {
  status: RentalStatus;

  roundNumber: number;

  ownerTeamId: string;
  borrowerTeamId: string;

  itemKey: AssetId | string;
  qty: number;

  feePerItemPerRound: number;
  feePerRound: number;

  durationRounds: number;
  startRound: number | null;
  dueRound: number | null;

  unpaidDebt: number;

  createdAt?: Timestamp;

  ownerAcceptedAt?: Timestamp | null;
  ownerRejectedAt?: Timestamp | null;

  teacherApprovedAt?: Timestamp | null;
  teacherRejectedAt?: Timestamp | null;

  returnRequestedAt?: Timestamp | null;
  ownerReturnConfirmedAt?: Timestamp | null;
  returnConfirmedAt?: Timestamp | null;

  inventoryTransferredAt?: Timestamp | null;
  inventoryReturnedAt?: Timestamp | null;

  lastPaymentRound?: number | null;
  lastPaymentDue?: number;
  lastPaymentPaid?: number;
  lastPaymentUnpaidDebt?: number;
  lastPaymentAt?: Timestamp | null;
  totalRentalPaid?: number;
};

function num(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeItemKey(itemKey: unknown): string {
  const raw = String(itemKey ?? "").trim();

  const map: Record<string, string> = {
    Paper: "paper",
    paper: "paper",

    Scissors: "scissors",
    scissors: "scissors",

    Protractor: "protractor",
    protractor: "protractor",

    "Straight ruler": "straightRuler",
    "Straight Ruler": "straightRuler",
    straightRuler: "straightRuler",
    straightruler: "straightRuler",

    Compass: "compass",
    compass: "compass",

    Pencil: "pencil",
    pencil: "pencil",

    "Triangle ruler": "triangleRuler",
    "Triangle Ruler": "triangleRuler",
    triangleRuler: "triangleRuler",
    triangleruler: "triangleRuler",

    "Equilateral ruler": "equilateralRuler",
    "Equilateral Ruler": "equilateralRuler",
    equilateralRuler: "equilateralRuler",
    equilateralruler: "equilateralRuler",

    Sticker: "sticker",
    sticker: "sticker",

    Labor: "labor",
    labor: "labor",
  };

  return map[raw] ?? raw;
}

function displayAssetLabel(itemKey: unknown) {
  return assetLabel(normalizeItemKey(itemKey) as AssetId);
}

function getTeamItemInfo(teamData: any, itemKey: string) {
  const possibleLocations = [
    {
      fieldPath: itemKey,
      value: teamData?.[itemKey],
    },
    {
      fieldPath: `inventory.${itemKey}`,
      value: teamData?.inventory?.[itemKey],
    },
    {
      fieldPath: `items.${itemKey}`,
      value: teamData?.items?.[itemKey],
    },
    {
      fieldPath: `resources.${itemKey}`,
      value: teamData?.resources?.[itemKey],
    },
    {
      fieldPath: `stock.${itemKey}`,
      value: teamData?.stock?.[itemKey],
    },
  ];

  const found = possibleLocations.find(
    (location) => location.value !== undefined && location.value !== null
  );

  return {
    fieldPath: found?.fieldPath ?? itemKey,
    qty: Math.max(0, num(found?.value ?? 0)),
    found: Boolean(found),
  };
}

function formatTime(t?: Timestamp | null) {
  if (!t) return "-";

  const d = t.toDate();

  return d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusLabel(status: RentalStatus) {
  if (status === "WAITING_OWNER") return "Waiting for owner";
  if (status === "OWNER_REJECTED") return "Rejected by owner";
  if (status === "WAITING_TEACHER") return "Waiting for teacher";
  if (status === "TEACHER_REJECTED") return "Rejected by teacher";
  if (status === "ACTIVE") return "Active";
  if (status === "RETURN_DUE") return "Return due";
  if (status === "RETURN_REQUESTED") return "Borrower marked returned";
  if (status === "OWNER_CONFIRMED_RETURN") return "Owner confirmed received";
  if (status === "RETURN_CONFIRMED") return "Return finalized";

  return status;
}

function statusClass(status: RentalStatus) {
  if (status === "WAITING_TEACHER") {
    return "bg-blue-500/20 text-blue-100";
  }

  if (status === "WAITING_OWNER") {
    return "bg-amber-500/20 text-amber-100";
  }

  if (status === "ACTIVE") {
    return "bg-green-500/20 text-green-100";
  }

  if (
    status === "RETURN_DUE" ||
    status === "RETURN_REQUESTED" ||
    status === "OWNER_CONFIRMED_RETURN"
  ) {
    return "bg-purple-500/20 text-purple-100";
  }

  if (status === "OWNER_REJECTED" || status === "TEACHER_REJECTED") {
    return "bg-red-500/20 text-red-100";
  }

  return "bg-slate-700 text-slate-100";
}

function sortByCreatedAtDesc(rows: (RentalDoc & { id: string })[]) {
  return [...rows].sort((a, b) => {
    const aTime =
      typeof a.createdAt?.toMillis === "function"
        ? a.createdAt.toMillis()
        : 0;

    const bTime =
      typeof b.createdAt?.toMillis === "function"
        ? b.createdAt.toMillis()
        : 0;

    return bTime - aTime;
  });
}

function getPaymentPreview(
  rental: RentalDoc & { id: string },
  roundNumber: number
) {
  const startRound = num(rental.startRound, 0);
  const dueRound = num(rental.dueRound, 999999);
  const lastPaymentRound = rental.lastPaymentRound ?? null;

  const shouldChargeCurrentRound =
    rental.status !== "RETURN_CONFIRMED" &&
    roundNumber > startRound &&
    roundNumber <= dueRound &&
    lastPaymentRound !== roundNumber;

  const currentRoundFee = shouldChargeCurrentRound
    ? num(rental.feePerRound)
    : 0;

  const previousDebt = num(rental.unpaidDebt);
  const totalDue = previousDebt + currentRoundFee;

  return {
    previousDebt,
    currentRoundFee,
    totalDue,
    alreadyChargedThisRound: lastPaymentRound === roundNumber,
  };
}

function RentalCard({
  rental,
  roundNumber,
  children,
}: {
  rental: RentalDoc & { id: string };
  roundNumber: number;
  children?: ReactNode;
}) {
  const totalExpectedFee = num(rental.feePerRound) * num(rental.durationRounds);
  const paymentPreview = getPaymentPreview(rental, roundNumber);

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-base font-semibold text-slate-100">
            {rental.borrowerTeamId} wants to borrow from {rental.ownerTeamId}
          </div>

          <div className="mt-1 text-sm text-slate-400">
            Requested in Round {rental.roundNumber} •{" "}
            {formatTime(rental.createdAt)}
          </div>
        </div>

        <span
          className={[
            "rounded-full px-3 py-1 text-xs font-semibold",
            statusClass(rental.status),
          ].join(" ")}
        >
          {statusLabel(rental.status)}
        </span>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-4">
        <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
          <div className="text-xs font-semibold uppercase text-slate-500">
            Item
          </div>
          <div className="mt-1 font-bold text-slate-100">
            {num(rental.qty)} {displayAssetLabel(rental.itemKey)}
          </div>
        </div>

        <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
          <div className="text-xs font-semibold uppercase text-slate-500">
            Fee / round
          </div>
          <div className="mt-1 font-bold text-slate-100">
            ${num(rental.feePerRound)}
          </div>
          <div className="mt-1 text-xs text-slate-400">
            ${num(rental.feePerItemPerRound)} × {num(rental.qty)}
          </div>
        </div>

        <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
          <div className="text-xs font-semibold uppercase text-slate-500">
            Duration
          </div>
          <div className="mt-1 font-bold text-slate-100">
            {num(rental.durationRounds)} round
            {num(rental.durationRounds) > 1 ? "s" : ""}
          </div>
          <div className="mt-1 text-xs text-slate-400">
            Expected total: ${totalExpectedFee}
          </div>
        </div>

        <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
          <div className="text-xs font-semibold uppercase text-slate-500">
            Rental period
          </div>
          <div className="mt-1 font-bold text-slate-100">
            {rental.startRound ? `R${rental.startRound}` : "-"} →{" "}
            {rental.dueRound ? `R${rental.dueRound}` : "-"}
          </div>
          <div className="mt-1 text-xs text-slate-400">
            Debt: ${num(rental.unpaidDebt)}
          </div>
        </div>
      </div>

      {(rental.status === "ACTIVE" ||
        rental.status === "RETURN_DUE" ||
        rental.status === "RETURN_REQUESTED" ||
        rental.status === "OWNER_CONFIRMED_RETURN" ||
        rental.status === "RETURN_CONFIRMED") && (
        <div className="mt-4 rounded-lg border border-cyan-500/30 bg-cyan-950/30 p-3 text-sm text-cyan-100">
          <div className="font-semibold">Payment status</div>

          <div className="mt-2 grid gap-2 md:grid-cols-4">
            <div>
              <div className="text-xs uppercase text-cyan-100/60">
                Previous debt
              </div>
              <div className="font-bold">${paymentPreview.previousDebt}</div>
            </div>

            <div>
              <div className="text-xs uppercase text-cyan-100/60">
                Current fee due
              </div>
              <div className="font-bold">${paymentPreview.currentRoundFee}</div>
            </div>

            <div>
              <div className="text-xs uppercase text-cyan-100/60">
                Total due now
              </div>
              <div className="font-bold">${paymentPreview.totalDue}</div>
            </div>

            <div>
              <div className="text-xs uppercase text-cyan-100/60">
                Last payment
              </div>
              <div className="font-bold">
                {rental.lastPaymentAt
                  ? `$${num(rental.lastPaymentPaid)}`
                  : "-"}
              </div>
              <div className="text-xs text-cyan-100/60">
                {rental.lastPaymentAt
                  ? `Round ${rental.lastPaymentRound ?? "-"}`
                  : "No payment yet"}
              </div>
            </div>
          </div>
        </div>
      )}

      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}

export default function TeacherRentalBoard({
  gameId,
  roundNumber,
}: {
  gameId: string;
  roundNumber: number;
}) {
  const [rentals, setRentals] = useState<(RentalDoc & { id: string })[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!gameId) return;

    const rentalsRef = collection(db, "games", gameId, "rentals");
    const q = query(rentalsRef);

    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows: (RentalDoc & { id: string })[] = [];

        snap.forEach((d) => {
          rows.push({
            id: d.id,
            ...(d.data() as RentalDoc),
          });
        });

        setRentals(sortByCreatedAtDesc(rows));
      },
      (error) => {
        console.error("Teacher rental board listener error:", error);
        setErr(error.message);
      }
    );

    return () => unsub();
  }, [gameId]);

  const waitingTeacherRentals = useMemo(() => {
    return rentals.filter((rental) => rental.status === "WAITING_TEACHER");
  }, [rentals]);

  const activeRentals = useMemo(() => {
    return rentals.filter((rental) => rental.status === "ACTIVE");
  }, [rentals]);

  const paymentDueRentals = useMemo(() => {
    return rentals.filter((rental) => {
      if (
        rental.status !== "ACTIVE" &&
        rental.status !== "RETURN_DUE" &&
        rental.status !== "RETURN_REQUESTED" &&
        rental.status !== "OWNER_CONFIRMED_RETURN" &&
        rental.status !== "RETURN_CONFIRMED"
      ) {
        return false;
      }

      const preview = getPaymentPreview(rental, roundNumber);
      return preview.totalDue > 0;
    });
  }, [rentals, roundNumber]);

  const returnDueRentals = useMemo(() => {
    return rentals.filter(
      (rental) =>
        rental.status === "RETURN_DUE" ||
        rental.status === "RETURN_REQUESTED" ||
        rental.status === "OWNER_CONFIRMED_RETURN"
    );
  }, [rentals]);

  const recentRentals = useMemo(() => {
    return rentals
      .filter((rental) =>
        [
          "OWNER_REJECTED",
          "TEACHER_REJECTED",
          "RETURN_CONFIRMED",
        ].includes(rental.status)
      )
      .slice(0, 8);
  }, [rentals]);

  async function approveRental(rental: RentalDoc & { id: string }) {
    setErr(null);
    setMsg(null);
    setBusyId(rental.id);

    try {
      const rentalRef = doc(db, "games", gameId, "rentals", rental.id);
      const ownerRef = doc(db, "games", gameId, "teams", rental.ownerTeamId);
      const borrowerRef = doc(
        db,
        "games",
        gameId,
        "teams",
        rental.borrowerTeamId
      );

      const result = await runTransaction(db, async (tx) => {
        const rentalSnap = await tx.get(rentalRef);
        const ownerSnap = await tx.get(ownerRef);
        const borrowerSnap = await tx.get(borrowerRef);

        if (!rentalSnap.exists()) {
          throw new Error("Rental record not found.");
        }

        if (!ownerSnap.exists()) {
          throw new Error(`Owner team ${rental.ownerTeamId} not found.`);
        }

        if (!borrowerSnap.exists()) {
          throw new Error(`Borrower team ${rental.borrowerTeamId} not found.`);
        }

        const rentalNow = rentalSnap.data() as RentalDoc;
        const ownerNow = ownerSnap.data() as any;
        const borrowerNow = borrowerSnap.data() as any;

        if (rentalNow.status !== "WAITING_TEACHER") {
          throw new Error(
            "This rental is no longer waiting for teacher approval."
          );
        }

        const itemKey = normalizeItemKey(rentalNow.itemKey);
        const qty = Math.max(1, num(rentalNow.qty, 1));

        const ownerItemInfo = getTeamItemInfo(ownerNow, itemKey);
        const borrowerItemInfo = getTeamItemInfo(borrowerNow, itemKey);

        const ownerItemBefore = ownerItemInfo.qty;
        const borrowerItemBefore = borrowerItemInfo.qty;

        const borrowerFieldPath = borrowerItemInfo.found
          ? borrowerItemInfo.fieldPath
          : ownerItemInfo.fieldPath;

        if (ownerItemBefore < qty) {
          throw new Error(
            `${rentalNow.ownerTeamId} does not have enough ${displayAssetLabel(
              itemKey
            )}. Available: ${ownerItemBefore}, requested: ${qty}. Checked field: ${
              ownerItemInfo.fieldPath
            }.`
          );
        }

        const duration = Math.max(1, num(rentalNow.durationRounds, 1));
        const startRound = Math.max(0, num(roundNumber, 0));
        const dueRound = startRound + duration;

        tx.update(ownerRef, {
          [ownerItemInfo.fieldPath]: ownerItemBefore - qty,
        });

        tx.update(borrowerRef, {
          [borrowerFieldPath]: borrowerItemBefore + qty,
        });

        tx.update(rentalRef, {
          status: "ACTIVE",
          itemKey,
          startRound,
          dueRound,
          unpaidDebt: num(rentalNow.unpaidDebt),
          totalRentalPaid: num(rentalNow.totalRentalPaid),
          teacherApprovedAt: serverTimestamp(),
          inventoryTransferredAt: serverTimestamp(),
        });

        return {
          itemKey,
          qty,
          dueRound,
          ownerTeamId: rentalNow.ownerTeamId,
          borrowerTeamId: rentalNow.borrowerTeamId,
          ownerFieldPath: ownerItemInfo.fieldPath,
          borrowerFieldPath,
        };
      });

      setMsg(
        `Approved rental: ${result.borrowerTeamId} borrowed ${
          result.qty
        } ${displayAssetLabel(result.itemKey)} from ${
          result.ownerTeamId
        }. Inventory updated. Return due in Round ${
          result.dueRound
        }. Owner field: ${result.ownerFieldPath}. Borrower field: ${
          result.borrowerFieldPath
        }.`
      );
    } catch (error: any) {
      console.error("Approve rental error:", error);
      setErr(error?.message ?? String(error));
    } finally {
      setBusyId(null);
    }
  }

  async function rejectRental(rental: RentalDoc & { id: string }) {
    setErr(null);
    setMsg(null);
    setBusyId(rental.id);

    try {
      const rentalRef = doc(db, "games", gameId, "rentals", rental.id);

      await updateDoc(rentalRef, {
        status: "TEACHER_REJECTED",
        teacherRejectedAt: serverTimestamp(),
      });

      setMsg(
        `Rejected rental request from ${rental.borrowerTeamId} to borrow from ${rental.ownerTeamId}.`
      );
    } catch (error: any) {
      console.error("Reject rental error:", error);
      setErr(error?.message ?? String(error));
    } finally {
      setBusyId(null);
    }
  }

  async function processRentalPayment(rental: RentalDoc & { id: string }) {
    setErr(null);
    setMsg(null);
    setBusyId(rental.id);

    try {
      const rentalRef = doc(db, "games", gameId, "rentals", rental.id);
      const borrowerRef = doc(
        db,
        "games",
        gameId,
        "teams",
        rental.borrowerTeamId
      );
      const ownerRef = doc(db, "games", gameId, "teams", rental.ownerTeamId);

      const result = await runTransaction(db, async (tx) => {
        const rentalSnap = await tx.get(rentalRef);
        const borrowerSnap = await tx.get(borrowerRef);
        const ownerSnap = await tx.get(ownerRef);

        if (!rentalSnap.exists()) {
          throw new Error("Rental record not found.");
        }

        if (!borrowerSnap.exists()) {
          throw new Error(`Borrower team ${rental.borrowerTeamId} not found.`);
        }

        if (!ownerSnap.exists()) {
          throw new Error(`Owner team ${rental.ownerTeamId} not found.`);
        }

        const rentalNow = rentalSnap.data() as RentalDoc;
        const borrowerNow = borrowerSnap.data() as any;
        const ownerNow = ownerSnap.data() as any;

        const preview = getPaymentPreview(
          {
            id: rental.id,
            ...rentalNow,
          },
          roundNumber
        );

        const totalDue = preview.totalDue;

        if (totalDue <= 0) {
          throw new Error("No rental payment or debt is due right now.");
        }

        const borrowerCashBefore = Math.max(0, num(borrowerNow.cash));
        const ownerCashBefore = Math.max(0, num(ownerNow.cash));

        const paidNow = Math.min(borrowerCashBefore, totalDue);
        const newDebt = totalDue - paidNow;

        tx.update(borrowerRef, {
          cash: borrowerCashBefore - paidNow,
        });

        tx.update(ownerRef, {
          cash: ownerCashBefore + paidNow,
        });

        const rentalUpdate: Record<string, unknown> = {
          unpaidDebt: newDebt,
          lastPaymentDue: totalDue,
          lastPaymentPaid: paidNow,
          lastPaymentUnpaidDebt: newDebt,
          lastPaymentAt: serverTimestamp(),
          totalRentalPaid: num(rentalNow.totalRentalPaid) + paidNow,
        };

        if (preview.currentRoundFee > 0) {
          rentalUpdate.lastPaymentRound = roundNumber;
        }

        tx.update(rentalRef, rentalUpdate);

        return {
          totalDue,
          paidNow,
          newDebt,
          borrowerCashBefore,
        };
      });

      if (result.paidNow >= result.totalDue) {
        setMsg(
          `${rental.borrowerTeamId} fully paid ${rental.ownerTeamId} $${result.paidNow}. Rental debt is now $0.`
        );
      } else {
        setMsg(
          `${rental.borrowerTeamId} owed $${result.totalDue} but only had $${result.borrowerCashBefore}. Paid $${result.paidNow} to ${rental.ownerTeamId}. Remaining rental debt: $${result.newDebt}.`
        );
      }
    } catch (error: any) {
      console.error("Process rental payment error:", error);
      setErr(error?.message ?? String(error));
    } finally {
      setBusyId(null);
    }
  }

  async function markReturnDue(rental: RentalDoc & { id: string }) {
    setErr(null);
    setMsg(null);
    setBusyId(rental.id);

    try {
      const rentalRef = doc(db, "games", gameId, "rentals", rental.id);

      await updateDoc(rentalRef, {
        status: "RETURN_DUE",
      });

      setMsg(
        `Marked return due: ${rental.borrowerTeamId} should return ${num(
          rental.qty
        )} ${displayAssetLabel(rental.itemKey)} to ${rental.ownerTeamId}.`
      );
    } catch (error: any) {
      console.error("Mark return due error:", error);
      setErr(error?.message ?? String(error));
    } finally {
      setBusyId(null);
    }
  }

  async function finalizeReturnByTeacher(rental: RentalDoc & { id: string }) {
    setErr(null);
    setMsg(null);
    setBusyId(rental.id);

    try {
      const rentalRef = doc(db, "games", gameId, "rentals", rental.id);
      const ownerRef = doc(db, "games", gameId, "teams", rental.ownerTeamId);
      const borrowerRef = doc(
        db,
        "games",
        gameId,
        "teams",
        rental.borrowerTeamId
      );

      const result = await runTransaction(db, async (tx) => {
        const rentalSnap = await tx.get(rentalRef);
        const ownerSnap = await tx.get(ownerRef);
        const borrowerSnap = await tx.get(borrowerRef);

        if (!rentalSnap.exists()) {
          throw new Error("Rental record not found.");
        }

        if (!ownerSnap.exists()) {
          throw new Error(`Owner team ${rental.ownerTeamId} not found.`);
        }

        if (!borrowerSnap.exists()) {
          throw new Error(`Borrower team ${rental.borrowerTeamId} not found.`);
        }

        const rentalNow = rentalSnap.data() as RentalDoc;
        const ownerNow = ownerSnap.data() as any;
        const borrowerNow = borrowerSnap.data() as any;

        if (rentalNow.status !== "OWNER_CONFIRMED_RETURN") {
          throw new Error(
            "Owner team must confirm receiving the returned item before teacher finalizes return."
          );
        }

        const itemKey = normalizeItemKey(rentalNow.itemKey);
        const qty = Math.max(1, num(rentalNow.qty, 1));

        const ownerItemInfo = getTeamItemInfo(ownerNow, itemKey);
        const borrowerItemInfo = getTeamItemInfo(borrowerNow, itemKey);

        const ownerItemBefore = ownerItemInfo.qty;
        const borrowerItemBefore = borrowerItemInfo.qty;

        const ownerFieldPath = ownerItemInfo.found
          ? ownerItemInfo.fieldPath
          : borrowerItemInfo.fieldPath;

        if (borrowerItemBefore < qty) {
          throw new Error(
            `${rentalNow.borrowerTeamId} does not have enough ${displayAssetLabel(
              itemKey
            )} to return. Available: ${borrowerItemBefore}, required: ${qty}. Checked field: ${
              borrowerItemInfo.fieldPath
            }.`
          );
        }

        tx.update(borrowerRef, {
          [borrowerItemInfo.fieldPath]: borrowerItemBefore - qty,
        });

        tx.update(ownerRef, {
          [ownerFieldPath]: ownerItemBefore + qty,
        });

        tx.update(rentalRef, {
          status: "RETURN_CONFIRMED",
          itemKey,
          returnConfirmedAt: serverTimestamp(),
          inventoryReturnedAt: serverTimestamp(),
        });

        return {
          itemKey,
          qty,
          ownerTeamId: rentalNow.ownerTeamId,
          borrowerTeamId: rentalNow.borrowerTeamId,
          ownerFieldPath,
          borrowerFieldPath: borrowerItemInfo.fieldPath,
        };
      });

      setMsg(
        `Return finalized: ${result.borrowerTeamId} returned ${
          result.qty
        } ${displayAssetLabel(result.itemKey)} to ${
          result.ownerTeamId
        }. Inventory updated. Owner field: ${
          result.ownerFieldPath
        }. Borrower field: ${result.borrowerFieldPath}.`
      );
    } catch (error: any) {
      console.error("Teacher finalize return error:", error);
      setErr(error?.message ?? String(error));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-cyan-500/40 bg-cyan-950/30 p-4 text-cyan-100">
        <h3 className="text-lg font-semibold">Teacher Rental Board</h3>

        <p className="mt-1 text-sm text-cyan-100/80">
          Teacher approval checks owner inventory. If the owner has enough
          equipment, the item moves from owner to borrower. Final return moves
          the item back from borrower to owner.
        </p>

        <div className="mt-3 grid gap-3 md:grid-cols-5">
          <div className="rounded-lg border border-cyan-500/30 bg-slate-950/40 p-3">
            <div className="text-xs uppercase text-cyan-100/70">
              Waiting approval
            </div>
            <div className="mt-1 text-xl font-bold">
              {waitingTeacherRentals.length}
            </div>
          </div>

          <div className="rounded-lg border border-green-500/30 bg-slate-950/40 p-3">
            <div className="text-xs uppercase text-green-100/70">
              Active rentals
            </div>
            <div className="mt-1 text-xl font-bold">{activeRentals.length}</div>
          </div>

          <div className="rounded-lg border border-amber-500/30 bg-slate-950/40 p-3">
            <div className="text-xs uppercase text-amber-100/70">
              Payments due
            </div>
            <div className="mt-1 text-xl font-bold">
              {paymentDueRentals.length}
            </div>
          </div>

          <div className="rounded-lg border border-purple-500/30 bg-slate-950/40 p-3">
            <div className="text-xs uppercase text-purple-100/70">
              Return alerts
            </div>
            <div className="mt-1 text-xl font-bold">
              {returnDueRentals.length}
            </div>
          </div>

          <div className="rounded-lg border border-slate-700 bg-slate-950/40 p-3">
            <div className="text-xs uppercase text-slate-400">
              Current round
            </div>
            <div className="mt-1 text-xl font-bold">{roundNumber}</div>
          </div>
        </div>
      </div>

      {err && (
        <div className="rounded-xl border border-red-700 bg-red-950/40 p-3 text-red-200">
          {err}
        </div>
      )}

      {msg && (
        <div className="rounded-xl border border-green-700 bg-green-950/40 p-3 text-green-200">
          {msg}
        </div>
      )}

      <div className="rounded-xl border border-blue-500/40 bg-blue-950/30 p-4">
        <h3 className="text-lg font-semibold text-blue-100">
          Waiting for Teacher Approval
        </h3>

        <p className="mt-1 text-sm text-blue-100/80">
          Approval transfers the rented item from owner inventory to borrower
          inventory. If the owner does not have enough, approval is blocked.
        </p>

        {waitingTeacherRentals.length === 0 ? (
          <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950/40 p-3 text-sm text-slate-400">
            No rental requests waiting for teacher approval.
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {waitingTeacherRentals.map((rental) => (
              <RentalCard
                key={rental.id}
                rental={rental}
                roundNumber={roundNumber}
              >
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busyId === rental.id}
                    onClick={() => approveRental(rental)}
                    className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-500 disabled:bg-slate-700"
                  >
                    {busyId === rental.id ? "Processing..." : "Approve Rental"}
                  </button>

                  <button
                    type="button"
                    disabled={busyId === rental.id}
                    onClick={() => rejectRental(rental)}
                    className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:bg-slate-700"
                  >
                    {busyId === rental.id ? "Processing..." : "Reject Rental"}
                  </button>
                </div>
              </RentalCard>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-amber-500/40 bg-amber-950/30 p-4">
        <h3 className="text-lg font-semibold text-amber-100">
          Rental Payments Due
        </h3>

        {paymentDueRentals.length === 0 ? (
          <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950/40 p-3 text-sm text-slate-400">
            No rental payment or debt is due right now.
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {paymentDueRentals.map((rental) => {
              const preview = getPaymentPreview(rental, roundNumber);

              return (
                <RentalCard
                  key={rental.id}
                  rental={rental}
                  roundNumber={roundNumber}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="rounded-lg border border-amber-500/40 bg-amber-950/40 px-3 py-2 text-sm text-amber-100">
                      Total due now: <b>${preview.totalDue}</b>
                    </div>

                    <button
                      type="button"
                      disabled={busyId === rental.id}
                      onClick={() => processRentalPayment(rental)}
                      className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-500 disabled:bg-slate-700"
                    >
                      {busyId === rental.id
                        ? "Processing..."
                        : "Process Payment"}
                    </button>
                  </div>
                </RentalCard>
              );
            })}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-green-500/40 bg-green-950/30 p-4">
        <h3 className="text-lg font-semibold text-green-100">
          Active Rentals
        </h3>

        {activeRentals.length === 0 ? (
          <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950/40 p-3 text-sm text-slate-400">
            No active rentals.
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {activeRentals.map((rental) => {
              const dueRound = num(rental.dueRound, 999999);
              const isDueNow = roundNumber >= dueRound;

              return (
                <RentalCard
                  key={rental.id}
                  rental={rental}
                  roundNumber={roundNumber}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    {isDueNow ? (
                      <div className="rounded-lg border border-purple-500/40 bg-purple-950/40 px-3 py-2 text-sm text-purple-100">
                        Return is due now. Borrower should return the item.
                      </div>
                    ) : (
                      <div className="rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-slate-300">
                        Return due in Round {rental.dueRound ?? "-"}.
                      </div>
                    )}

                    <button
                      type="button"
                      disabled={busyId === rental.id}
                      onClick={() => markReturnDue(rental)}
                      className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-500 disabled:bg-slate-700"
                    >
                      {busyId === rental.id
                        ? "Processing..."
                        : isDueNow
                        ? "Mark Return Due"
                        : "Mark Return Due Early"}
                    </button>
                  </div>
                </RentalCard>
              );
            })}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-purple-500/40 bg-purple-950/30 p-4">
        <h3 className="text-lg font-semibold text-purple-100">
          Return Due / Return Confirmation
        </h3>

        {returnDueRentals.length === 0 ? (
          <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950/40 p-3 text-sm text-slate-400">
            No return alerts right now.
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {returnDueRentals.map((rental) => (
              <RentalCard
                key={rental.id}
                rental={rental}
                roundNumber={roundNumber}
              >
                <div className="flex flex-wrap items-center gap-2">
                  {rental.status === "RETURN_DUE" && (
                    <div className="rounded-lg border border-purple-500/40 bg-purple-950/40 px-3 py-2 text-sm text-purple-100">
                      Waiting for {rental.borrowerTeamId} to mark the item as
                      returned.
                    </div>
                  )}

                  {rental.status === "RETURN_REQUESTED" && (
                    <div className="rounded-lg border border-amber-500/40 bg-amber-950/40 px-3 py-2 text-sm text-amber-100">
                      {rental.borrowerTeamId} says the item was returned.
                      Waiting for {rental.ownerTeamId} to confirm receiving it.
                    </div>
                  )}

                  {rental.status === "OWNER_CONFIRMED_RETURN" && (
                    <>
                      <div className="rounded-lg border border-green-500/40 bg-green-950/40 px-3 py-2 text-sm text-green-100">
                        {rental.ownerTeamId} confirmed receiving the item.
                        Teacher can now finalize return.
                      </div>

                      <button
                        type="button"
                        disabled={busyId === rental.id}
                        onClick={() => finalizeReturnByTeacher(rental)}
                        className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-500 disabled:bg-slate-700"
                      >
                        {busyId === rental.id
                          ? "Processing..."
                          : "Finalize Return + Update Inventory"}
                      </button>
                    </>
                  )}
                </div>
              </RentalCard>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
        <h3 className="text-lg font-semibold text-slate-100">
          Recent Completed / Rejected Rentals
        </h3>

        {recentRentals.length === 0 ? (
          <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950/40 p-3 text-sm text-slate-400">
            No completed or rejected rental records yet.
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {recentRentals.map((rental) => (
              <RentalCard
                key={rental.id}
                rental={rental}
                roundNumber={roundNumber}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}