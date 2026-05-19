import { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
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

  itemKey: AssetId;
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

function formatTime(t?: Timestamp | null) {
  if (!t) return "-";

  const d = t.toDate();

  return d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getStatusLabel(status: RentalStatus) {
  if (status === "WAITING_OWNER") return "Waiting for owner team";
  if (status === "OWNER_REJECTED") return "Rejected by owner team";
  if (status === "WAITING_TEACHER") return "Waiting for teacher approval";
  if (status === "TEACHER_REJECTED") return "Rejected by teacher";
  if (status === "ACTIVE") return "Active rental";
  if (status === "RETURN_DUE") return "Return due";
  if (status === "RETURN_REQUESTED") return "Borrower marked returned";
  if (status === "OWNER_CONFIRMED_RETURN") return "Owner confirmed received";
  if (status === "RETURN_CONFIRMED") return "Return finalized";

  return status;
}

function getStatusClass(status: RentalStatus) {
  if (status === "WAITING_OWNER") {
    return "bg-amber-500/20 text-amber-100";
  }

  if (status === "WAITING_TEACHER") {
    return "bg-blue-500/20 text-blue-100";
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

  if (status === "RETURN_CONFIRMED") {
    return "bg-slate-700 text-slate-100";
  }

  return "bg-slate-700 text-slate-100";
}

function sortByCreatedAtDesc<T extends RentalDoc>(
  rows: (T & { id: string })[]
) {
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

function RentalSummary({
  rental,
  perspective,
}: {
  rental: RentalDoc & { id: string };
  perspective: "owner" | "borrower";
}) {
  const totalExpectedFee =
    num(rental.feePerRound) * num(rental.durationRounds);

  return (
    <div className="mt-3 grid gap-3 md:grid-cols-3">
      <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
        <div className="text-xs font-semibold uppercase text-slate-500">
          Item
        </div>
        <div className="mt-1 font-bold text-slate-100">
          {num(rental.qty)} {assetLabel(rental.itemKey)}
        </div>
      </div>

      <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
        <div className="text-xs font-semibold uppercase text-slate-500">
          Rental fee
        </div>
        <div className="mt-1 font-bold text-slate-100">
          ${num(rental.feePerRound)} / round
        </div>
        <div className="mt-1 text-xs text-slate-400">
          ${num(rental.feePerItemPerRound)} × {num(rental.qty)} item
          {num(rental.qty) > 1 ? "s" : ""}
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

      <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3 md:col-span-3">
        <div className="text-sm text-slate-300">
          {perspective === "owner" ? (
            <>
              <b>{rental.borrowerTeamId}</b> wants to rent from your team.
            </>
          ) : (
            <>
              You requested to rent from <b>{rental.ownerTeamId}</b>.
            </>
          )}
        </div>

        <div className="mt-1 text-xs text-slate-400">
          Requested in Round {rental.roundNumber} • {formatTime(rental.createdAt)}
        </div>

        {rental.startRound !== null && rental.startRound !== undefined && (
          <div className="mt-1 text-xs text-slate-400">
            Start round: {rental.startRound} • Due round:{" "}
            {rental.dueRound ?? "-"}
          </div>
        )}

        {(rental.status === "ACTIVE" ||
          rental.status === "RETURN_DUE" ||
          rental.status === "RETURN_REQUESTED" ||
          rental.status === "OWNER_CONFIRMED_RETURN" ||
          rental.status === "RETURN_CONFIRMED") && (
          <div className="mt-3 rounded-lg border border-cyan-500/30 bg-cyan-950/30 p-3 text-cyan-100">
            <div className="font-semibold">Payment tracking</div>

            <div className="mt-2 grid gap-2 md:grid-cols-4">
              <div>
                <div className="text-xs uppercase text-cyan-100/60">
                  Unpaid debt
                </div>
                <div className="font-bold">${num(rental.unpaidDebt)}</div>
              </div>

              <div>
                <div className="text-xs uppercase text-cyan-100/60">
                  Last paid
                </div>
                <div className="font-bold">
                  {rental.lastPaymentAt ? `$${num(rental.lastPaymentPaid)}` : "-"}
                </div>
              </div>

              <div>
                <div className="text-xs uppercase text-cyan-100/60">
                  Last payment round
                </div>
                <div className="font-bold">{rental.lastPaymentRound ?? "-"}</div>
              </div>

              <div>
                <div className="text-xs uppercase text-cyan-100/60">
                  Total paid
                </div>
                <div className="font-bold">${num(rental.totalRentalPaid)}</div>
              </div>
            </div>

            {num(rental.unpaidDebt) > 0 && (
              <div className="mt-2 text-xs text-amber-100">
                This unpaid amount remains owed even after the item is returned.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function TeamRentalInbox({
  gameId,
  teamId,
  roundNumber,
}: {
  gameId: string;
  teamId: string;
  roundNumber: number;
}) {
  const [receivedRentals, setReceivedRentals] = useState<
    (RentalDoc & { id: string })[]
  >([]);

  const [sentRentals, setSentRentals] = useState<
    (RentalDoc & { id: string })[]
  >([]);

  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!gameId || !teamId) return;

    setErr(null);

    const rentalsRef = collection(db, "games", gameId, "rentals");

    const receivedQuery = query(
      rentalsRef,
      where("ownerTeamId", "==", teamId)
    );

    const unsubReceived = onSnapshot(
      receivedQuery,
      (snap) => {
        const rows: (RentalDoc & { id: string })[] = [];

        snap.forEach((d) => {
          rows.push({
            id: d.id,
            ...(d.data() as RentalDoc),
          });
        });

        setReceivedRentals(sortByCreatedAtDesc(rows));
      },
      (error) => {
        console.error("Received rental listener error:", error);
        setErr(error.message);
      }
    );

    const sentQuery = query(
      rentalsRef,
      where("borrowerTeamId", "==", teamId)
    );

    const unsubSent = onSnapshot(
      sentQuery,
      (snap) => {
        const rows: (RentalDoc & { id: string })[] = [];

        snap.forEach((d) => {
          rows.push({
            id: d.id,
            ...(d.data() as RentalDoc),
          });
        });

        setSentRentals(sortByCreatedAtDesc(rows));
      },
      (error) => {
        console.error("Sent rental listener error:", error);
        setErr(error.message);
      }
    );

    return () => {
      unsubReceived();
      unsubSent();
    };
  }, [gameId, teamId]);

  const waitingOwnerRequests = useMemo(() => {
    return receivedRentals.filter(
      (rental) =>
        rental.status === "WAITING_OWNER" &&
        Number(rental.roundNumber ?? 0) === roundNumber
    );
  }, [receivedRentals, roundNumber]);

  const ownerHistoryThisRound = useMemo(() => {
    return receivedRentals
      .filter(
        (rental) =>
          rental.status !== "WAITING_OWNER" &&
          Number(rental.roundNumber ?? 0) === roundNumber
      )
      .slice(0, 6);
  }, [receivedRentals, roundNumber]);

  const sentThisRound = useMemo(() => {
    return sentRentals
      .filter((rental) => Number(rental.roundNumber ?? 0) === roundNumber)
      .slice(0, 8);
  }, [sentRentals, roundNumber]);

  const activeOrDueRentals = useMemo(() => {
    return [...receivedRentals, ...sentRentals]
      .filter((rental) =>
        [
          "ACTIVE",
          "RETURN_DUE",
          "RETURN_REQUESTED",
          "OWNER_CONFIRMED_RETURN",
        ].includes(rental.status)
      )
      .slice(0, 8);
  }, [receivedRentals, sentRentals]);

  async function acceptRental(rentalId: string) {
    setErr(null);
    setMsg(null);
    setBusyId(rentalId);

    try {
      const rentalRef = doc(db, "games", gameId, "rentals", rentalId);

      await updateDoc(rentalRef, {
        status: "WAITING_TEACHER",
        ownerAcceptedAt: serverTimestamp(),
      });

      setMsg("Rental accepted. It has been sent to the teacher for approval.");
    } catch (error: any) {
      console.error("Accept rental error:", error);
      setErr(error?.message ?? String(error));
    } finally {
      setBusyId(null);
    }
  }

  async function rejectRental(rentalId: string) {
    setErr(null);
    setMsg(null);
    setBusyId(rentalId);

    try {
      const rentalRef = doc(db, "games", gameId, "rentals", rentalId);

      await updateDoc(rentalRef, {
        status: "OWNER_REJECTED",
        ownerRejectedAt: serverTimestamp(),
      });

      setMsg("Rental rejected. It will not be sent to the teacher.");
    } catch (error: any) {
      console.error("Reject rental error:", error);
      setErr(error?.message ?? String(error));
    } finally {
      setBusyId(null);
    }
  }

  async function markReturnRequested(rentalId: string) {
    setErr(null);
    setMsg(null);
    setBusyId(rentalId);

    try {
      const rentalRef = doc(db, "games", gameId, "rentals", rentalId);

      await updateDoc(rentalRef, {
        status: "RETURN_REQUESTED",
        returnRequestedAt: serverTimestamp(),
      });

      setMsg("Return marked. Waiting for the owner team to confirm receiving it.");
    } catch (error: any) {
      console.error("Mark return requested error:", error);
      setErr(error?.message ?? String(error));
    } finally {
      setBusyId(null);
    }
  }

  async function confirmReturnReceived(rentalId: string) {
    setErr(null);
    setMsg(null);
    setBusyId(rentalId);

    try {
      const rentalRef = doc(db, "games", gameId, "rentals", rentalId);

      await updateDoc(rentalRef, {
        status: "OWNER_CONFIRMED_RETURN",
        ownerReturnConfirmedAt: serverTimestamp(),
      });

      setMsg("Return received. Waiting for teacher to finalize inventory return.");
    } catch (error: any) {
      console.error("Owner confirm return received error:", error);
      setErr(error?.message ?? String(error));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-amber-500/40 bg-amber-950/30 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-lg font-semibold text-amber-100">
              Rental Requests to Your Team
            </h3>

            <p className="mt-1 text-sm text-amber-100/80">
              These teams want to borrow your equipment. Accept only if your
              team agrees with the item, quantity, fee, and duration.
            </p>
          </div>

          {waitingOwnerRequests.length > 0 && (
            <span className="rounded-full bg-red-500 px-3 py-1 text-sm font-bold text-white">
              {waitingOwnerRequests.length} waiting
            </span>
          )}
        </div>

        {err && (
          <div className="mt-3 rounded-lg border border-red-700 bg-red-950/40 p-3 text-red-200">
            {err}
          </div>
        )}

        {msg && (
          <div className="mt-3 rounded-lg border border-green-700 bg-green-950/40 p-3 text-green-200">
            {msg}
          </div>
        )}

        {waitingOwnerRequests.length === 0 ? (
          <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950/40 p-3 text-sm text-slate-400">
            No rental requests waiting for your team.
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {waitingOwnerRequests.map((rental) => (
              <div
                key={rental.id}
                className="rounded-xl border border-slate-700 bg-slate-950/60 p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold text-slate-100">
                      Request from {rental.borrowerTeamId}
                    </div>

                    <div className="mt-1 text-sm text-slate-400">
                      Round {rental.roundNumber} •{" "}
                      {formatTime(rental.createdAt)}
                    </div>
                  </div>

                  <span className="rounded-full bg-amber-500/20 px-3 py-1 text-xs font-semibold text-amber-100">
                    Waiting for your decision
                  </span>
                </div>

                <RentalSummary rental={rental} perspective="owner" />

                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busyId === rental.id}
                    onClick={() => acceptRental(rental.id)}
                    className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-500 disabled:bg-slate-700"
                  >
                    {busyId === rental.id
                      ? "Processing..."
                      : "Accept and Send to Teacher"}
                  </button>

                  <button
                    type="button"
                    disabled={busyId === rental.id}
                    onClick={() => rejectRental(rental.id)}
                    className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:bg-slate-700"
                  >
                    {busyId === rental.id ? "Processing..." : "Reject"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-blue-500/40 bg-blue-950/30 p-4">
        <div>
          <h3 className="text-lg font-semibold text-blue-100">
            Your Sent Rental Requests
          </h3>

          <p className="mt-1 text-sm text-blue-100/80">
            Track whether the owner team and teacher accepted your rental
            request.
          </p>
        </div>

        {sentThisRound.length === 0 ? (
          <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950/40 p-3 text-sm text-slate-400">
            Your team has not sent any rental requests this round.
          </div>
        ) : (
          <div className="mt-4 space-y-2">
            {sentThisRound.map((rental) => (
              <div
                key={rental.id}
                className="rounded-lg border border-slate-800 bg-slate-950/50 p-3 text-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-semibold text-slate-100">
                    From {rental.ownerTeamId}
                  </div>

                  <span
                    className={[
                      "rounded-full px-2 py-1 text-xs font-semibold",
                      getStatusClass(rental.status),
                    ].join(" ")}
                  >
                    {getStatusLabel(rental.status)}
                  </span>
                </div>

                <RentalSummary rental={rental} perspective="borrower" />

                {rental.status === "WAITING_OWNER" && (
                  <div className="mt-2 text-xs text-amber-200">
                    Waiting for {rental.ownerTeamId} to accept or reject.
                  </div>
                )}

                {rental.status === "WAITING_TEACHER" && (
                  <div className="mt-2 text-xs text-blue-200">
                    {rental.ownerTeamId} accepted. Waiting for teacher approval.
                  </div>
                )}

                {rental.status === "OWNER_REJECTED" && (
                  <div className="mt-2 text-xs text-red-200">
                    {rental.ownerTeamId} rejected this rental request.
                  </div>
                )}

                {rental.status === "TEACHER_REJECTED" && (
                  <div className="mt-2 text-xs text-red-200">
                    Teacher rejected this rental request.
                  </div>
                )}

                {rental.status === "ACTIVE" && (
                  <div className="mt-2 text-xs text-green-200">
                    Rental active. Return due in Round {rental.dueRound ?? "-"}.
                  </div>
                )}

                {rental.status === "RETURN_DUE" && (
                  <div className="mt-3">
                    <div className="mb-2 text-xs text-purple-200">
                      Return is due now. Please return the item to{" "}
                      {rental.ownerTeamId}. Click only after your team has
                      actually returned it.
                    </div>

                    <button
                      type="button"
                      disabled={busyId === rental.id}
                      onClick={() => markReturnRequested(rental.id)}
                      className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-500 disabled:bg-slate-700"
                    >
                      {busyId === rental.id
                        ? "Processing..."
                        : "I Returned the Item"}
                    </button>
                  </div>
                )}

                {rental.status === "RETURN_REQUESTED" && (
                  <div className="mt-2 text-xs text-purple-200">
                    Waiting for {rental.ownerTeamId} to confirm receiving the
                    returned item.
                  </div>
                )}

                {rental.status === "OWNER_CONFIRMED_RETURN" && (
                  <div className="mt-2 text-xs text-green-200">
                    {rental.ownerTeamId} confirmed receiving the item. Waiting
                    for teacher to finalize return.
                  </div>
                )}

                {rental.status === "RETURN_CONFIRMED" && (
                  <div className="mt-2 text-xs text-slate-300">
                    Return finalized by teacher. Rental completed.
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-purple-500/40 bg-purple-950/30 p-4">
        <h3 className="text-lg font-semibold text-purple-100">
          Active / Return Tracking
        </h3>

        <p className="mt-1 text-sm text-purple-100/80">
          Return process: borrower marks returned, owner confirms received, then
          teacher finalizes and inventory moves back.
        </p>

        {activeOrDueRentals.length === 0 ? (
          <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950/40 p-3 text-sm text-slate-400">
            No active rental or return due right now.
          </div>
        ) : (
          <div className="mt-4 space-y-2">
            {activeOrDueRentals.map((rental) => {
              const isOwner = rental.ownerTeamId === teamId;
              const isBorrower = rental.borrowerTeamId === teamId;

              return (
                <div
                  key={rental.id}
                  className="rounded-lg border border-slate-800 bg-slate-950/50 p-3 text-sm"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-semibold text-slate-100">
                      {isOwner
                        ? `Rented out to ${rental.borrowerTeamId}`
                        : isBorrower
                        ? `Borrowed from ${rental.ownerTeamId}`
                        : "Rental"}
                    </div>

                    <span
                      className={[
                        "rounded-full px-2 py-1 text-xs font-semibold",
                        getStatusClass(rental.status),
                      ].join(" ")}
                    >
                      {getStatusLabel(rental.status)}
                    </span>
                  </div>

                  <RentalSummary
                    rental={rental}
                    perspective={isOwner ? "owner" : "borrower"}
                  />

                  {isOwner && rental.status === "RETURN_REQUESTED" && (
                    <div className="mt-3">
                      <div className="mb-2 text-xs text-purple-200">
                        {rental.borrowerTeamId} says the item was returned.
                        Confirm only after your team has actually received it.
                      </div>

                      <button
                        type="button"
                        disabled={busyId === rental.id}
                        onClick={() => confirmReturnReceived(rental.id)}
                        className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-500 disabled:bg-slate-700"
                      >
                        {busyId === rental.id
                          ? "Processing..."
                          : "I Received the Item"}
                      </button>
                    </div>
                  )}

                  {isOwner && rental.status === "RETURN_DUE" && (
                    <div className="mt-2 text-xs text-purple-200">
                      Return is due. Ask {rental.borrowerTeamId} to return the
                      item.
                    </div>
                  )}

                  {isOwner && rental.status === "OWNER_CONFIRMED_RETURN" && (
                    <div className="mt-2 text-xs text-green-200">
                      Your team confirmed receiving the item. Waiting for
                      teacher to finalize inventory return.
                    </div>
                  )}

                  {isBorrower && rental.status === "RETURN_DUE" && (
                    <div className="mt-3">
                      <div className="mb-2 text-xs text-purple-200">
                        Return is due now. Please return the item to{" "}
                        {rental.ownerTeamId}. Click only after you actually
                        returned it.
                      </div>

                      <button
                        type="button"
                        disabled={busyId === rental.id}
                        onClick={() => markReturnRequested(rental.id)}
                        className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-500 disabled:bg-slate-700"
                      >
                        {busyId === rental.id
                          ? "Processing..."
                          : "I Returned the Item"}
                      </button>
                    </div>
                  )}

                  {isBorrower && rental.status === "RETURN_REQUESTED" && (
                    <div className="mt-2 text-xs text-purple-200">
                      Waiting for {rental.ownerTeamId} to confirm receiving the
                      returned item.
                    </div>
                  )}

                  {isBorrower && rental.status === "OWNER_CONFIRMED_RETURN" && (
                    <div className="mt-2 text-xs text-green-200">
                      {rental.ownerTeamId} confirmed receiving the item. Waiting
                      for teacher to finalize return.
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
        <h3 className="text-lg font-semibold text-slate-100">
          Recent Rental Decisions
        </h3>

        <p className="mt-1 text-sm text-slate-400">
          These are rental requests your team already accepted, rejected, or
          completed this round.
        </p>

        {ownerHistoryThisRound.length === 0 ? (
          <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950/40 p-3 text-sm text-slate-400">
            No rental decisions yet.
          </div>
        ) : (
          <div className="mt-4 space-y-2">
            {ownerHistoryThisRound.map((rental) => (
              <div
                key={rental.id}
                className="rounded-lg border border-slate-800 bg-slate-950/50 p-3 text-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-semibold text-slate-100">
                    From {rental.borrowerTeamId}
                  </div>

                  <span
                    className={[
                      "rounded-full px-2 py-1 text-xs font-semibold",
                      getStatusClass(rental.status),
                    ].join(" ")}
                  >
                    {getStatusLabel(rental.status)}
                  </span>
                </div>

                <RentalSummary rental={rental} perspective="owner" />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}