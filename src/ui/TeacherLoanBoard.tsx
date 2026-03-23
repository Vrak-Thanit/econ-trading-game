import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { useEffect, useState } from "react";
import { db } from "../lib/firebase";
import { computeBorrowable, num, type IncomeTier } from "../lib/loanPolicy";

type LoanDoc = {
  teamId: string;

  // Support both old/new clients:
  // - some UI may send { type: "BORROW" | "REPAY" }
  // - some UI may send { action: "BORROW" | "REPAY" }
  type?: "BORROW" | "REPAY";
  action?: "BORROW" | "REPAY";

  amount: number;
  status: "PENDING" | "APPROVED" | "DECLINED";
  roundNumber: number;
  createdAt?: any;
  decidedAt?: any;
};

type TeamDoc = {
  incomeTier?: IncomeTier;
  cash?: number;
  debt?: number;
  reliability?: number;
  debtStartRound?: number;
  graceUntilRound?: number;
};

type GameDoc = {
  phase?: string;
  roundNumber?: number;
  baseInterestRate?: number;
  graceAfterBorrowRounds?: number;
  graceRateMultiplier?: number;
};

function loanKind(l: LoanDoc): "BORROW" | "REPAY" {
  return (l.type ?? l.action ?? "BORROW") as any;
}

export default function TeacherLoanBoard({ gameId }: { gameId: string }) {
  const [pending, setPending] = useState<{ id: string; data: LoanDoc }[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const [settings, setSettings] = useState<GameDoc | null>(null);
  const [draftRate, setDraftRate] = useState<number>(0.05);
  const [draftGraceRounds, setDraftGraceRounds] = useState<number>(1);
  const [draftGraceMult, setDraftGraceMult] = useState<number>(0);

  // ✅ live loan requests (correct collection)
  useEffect(() => {
    setErr(null);
    const ref = collection(db, "games", gameId, "loanRequests");
    const qy = query(ref, orderBy("createdAt", "asc"));
    const unsub = onSnapshot(
      qy,
      (snap) => {
        const rows: { id: string; data: LoanDoc }[] = [];
        snap.forEach((d) => rows.push({ id: d.id, data: d.data() as LoanDoc }));
        setPending(rows.filter((r) => r.data.status === "PENDING"));
      },
      (e) => setErr(e.message)
    );
    return () => unsub();
  }, [gameId]);

  // live settings
  useEffect(() => {
    const gref = doc(db, "games", gameId);
    const unsub = onSnapshot(gref, (snap) => {
      if (!snap.exists()) return;
      const g = snap.data() as GameDoc;
      setSettings(g);
      setDraftRate(num(g.baseInterestRate ?? 0.05));
      setDraftGraceRounds(Math.max(0, Math.floor(num(g.graceAfterBorrowRounds ?? 1))));
      setDraftGraceMult(num(g.graceRateMultiplier ?? 0));
    });
    return () => unsub();
  }, [gameId]);

  const roundNumber = num(settings?.roundNumber ?? 0);

  if (err) return <div style={{ color: "crimson" }}>{err}</div>;

  return (
    <div style={{ border: "1px solid #444", borderRadius: 12, padding: 12, maxWidth: 1100 }}>
      <h3 style={{ marginTop: 0 }}>Loans (Teacher Approval)</h3>

      {/* Loan Settings */}
      <div style={{ border: "1px solid #333", borderRadius: 10, padding: 10 }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>
          Loan Settings (used for interest + grace behavior)
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <label>
            Base interest rate (per round){" "}
            <input
              type="number"
              step="0.01"
              value={draftRate}
              onChange={(e) => setDraftRate(Number(e.target.value || 0))}
              style={{ width: 120, padding: 6 }}
            />
            <span style={{ marginLeft: 6, opacity: 0.8 }}>({(draftRate * 100).toFixed(1)}%)</span>
          </label>

          <label>
            Grace rounds after first borrow{" "}
            <input
              type="number"
              min={0}
              value={draftGraceRounds}
              onChange={(e) =>
                setDraftGraceRounds(Math.max(0, Math.floor(Number(e.target.value || 0))))
              }
              style={{ width: 80, padding: 6 }}
            />
          </label>

          <label>
            Grace interest multiplier{" "}
            <input
              type="number"
              step="0.1"
              value={draftGraceMult}
              onChange={(e) => setDraftGraceMult(Number(e.target.value || 0))}
              style={{ width: 80, padding: 6 }}
            />
            <span style={{ marginLeft: 6, opacity: 0.8 }}>(0 = free grace)</span>
          </label>

          <button
            style={{ padding: "8px 12px" }}
            onClick={async () => {
              setMsg(null);
              setErr(null);
              try {
                const gref = doc(db, "games", gameId);
                await updateDoc(gref, {
                  baseInterestRate: draftRate,
                  graceAfterBorrowRounds: draftGraceRounds,
                  graceRateMultiplier: draftGraceMult,
                });
                setMsg("Loan settings saved ✅");
              } catch (e: any) {
                setErr(e?.message ?? String(e));
              }
            }}
          >
            Save Loan Settings
          </button>

          <div style={{ opacity: 0.8 }}>
            Current round: <b>{roundNumber}</b>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 10, opacity: 0.85 }}>
        Pending requests: <b>{pending.length}</b>
      </div>

      <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
        {pending.length === 0 ? (
          <div style={{ opacity: 0.7 }}>No pending loan requests.</div>
        ) : (
          pending.map((row) => (
            <LoanRow key={row.id} gameId={gameId} loanId={row.id} loan={row.data} />
          ))
        )}
      </div>

      {msg && <div style={{ marginTop: 10, color: "lightgreen" }}>{msg}</div>}
      {err && <div style={{ marginTop: 10, color: "crimson" }}>{err}</div>}

      <small style={{ opacity: 0.75 }}>
        Grace is per-team: it triggers only when debt goes from 0 → &gt;0. Borrowing again while already in
        debt does not reset grace. Repay is only approved during INTERVAL.
      </small>
    </div>
  );
}

function LoanRow({ gameId, loanId, loan }: { gameId: string; loanId: string; loan: LoanDoc }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const kind = loanKind(loan);

  return (
    <div style={{ border: "1px solid #333", borderRadius: 10, padding: 10 }}>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
        <div><b>Team:</b> {loan.teamId}</div>
        <div><b>Type:</b> {kind}</div>
        <div><b>Amount:</b> {num(loan.amount)}</div>
        <div style={{ opacity: 0.8 }}><b>Requested in round:</b> {loan.roundNumber}</div>

        <button
          style={{ padding: "6px 10px" }}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setErr(null);

            try {
              const gameRef = doc(db, "games", gameId);
              const teamRef = doc(db, "games", gameId, "teams", loan.teamId);
              const reqRef = doc(db, "games", gameId, "loanRequests", loanId);

              await runTransaction(db, async (tx) => {
                const gameSnap = await tx.get(gameRef);
                if (!gameSnap.exists()) throw new Error("Game not found");
                const g = gameSnap.data() as any;

                const reqSnap = await tx.get(reqRef);
                if (!reqSnap.exists()) throw new Error("Request not found");
                const req = reqSnap.data() as LoanDoc;
                if (req.status !== "PENDING") throw new Error("Already decided.");

                const teamSnap = await tx.get(teamRef);
                if (!teamSnap.exists()) throw new Error("Team not found");
                const t = teamSnap.data() as TeamDoc;

                const cash = num(t.cash ?? 0);
                const debt = num(t.debt ?? 0);
                const reliability = num(t.reliability ?? 100);
                const incomeTier = (t.incomeTier ?? "POOR") as IncomeTier;

                const currentRound = num(g.roundNumber ?? 0);
                const phase = String(g.phase ?? "-");
                const graceAfter = Math.max(0, Math.floor(num(g.graceAfterBorrowRounds ?? 1)));

                const requestRound = Math.max(0, Math.floor(num(req.roundNumber ?? currentRound)));
                const amt = Math.max(0, Math.floor(num(req.amount)));

                const reqKind = loanKind(req);

                if (reqKind === "BORROW") {
                  // You may allow borrow in INTERVAL only; if you want that strict, uncomment:
                  // if (phase !== "INTERVAL") throw new Error("Borrow approvals only during INTERVAL.");

                  const borrowable = computeBorrowable({ incomeTier, cash, debt, reliability });
                  if (amt > borrowable) throw new Error(`Over limit. Max borrowable now is ${borrowable}.`);

                  const wasDebtZero = debt <= 0;

                  const updates: any = {
                    cash: cash + amt,
                    debt: debt + amt,
                  };

                  // Grace only when first entering debt
                  if (wasDebtZero) {
                    updates.debtStartRound = requestRound;
                    updates.graceUntilRound = requestRound + graceAfter; // e.g. borrow in R0, graceUntil=1
                  }

                  tx.update(teamRef, updates);
                } else {
                  // REPAY
                  if (phase !== "INTERVAL") throw new Error("Repayment approvals only during INTERVAL.");
                  if (debt <= 0) throw new Error("Team has no debt.");
                  if (cash <= 0) throw new Error("Team has no cash.");

                  const repay = Math.min(amt, cash, debt);
                  if (repay <= 0) throw new Error("Repay amount must be > 0.");

                  const newCash = cash - repay;
                  const newDebt = debt - repay;

                  const updates: any = { cash: newCash, debt: newDebt };

                  // If fully repaid, clear grace markers
                  if (newDebt <= 0) {
                    updates.debt = 0;
                    updates.debtStartRound = -1;
                    updates.graceUntilRound = -1;
                  }

                  tx.update(teamRef, updates);
                }

                tx.update(reqRef, { status: "APPROVED", decidedAt: serverTimestamp() });

                const logRef = doc(collection(db, "games", gameId, "logs"));
                tx.set(logRef, {
                  type: "LOAN",
                  createdAt: serverTimestamp(),
                  message: `R${currentRound}: ${req.teamId} ${reqKind} approved amount=${amt}`,
                });
              });
            } catch (e: any) {
              setErr(e?.message ?? String(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          Approve
        </button>

        <button
          style={{ padding: "6px 10px" }}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setErr(null);
            try {
              const reqRef = doc(db, "games", gameId, "loanRequests", loanId);
              await updateDoc(reqRef, {
                status: "DECLINED",
                decidedAt: serverTimestamp(),
              });
            } catch (e: any) {
              setErr(e?.message ?? String(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          Decline
        </button>
      </div>

      {err && <div style={{ marginTop: 8, color: "crimson" }}>{err}</div>}
    </div>
  );
}
