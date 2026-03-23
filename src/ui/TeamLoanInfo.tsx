import { doc, onSnapshot } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import { db } from "../lib/firebase";
import { computeInterestPreview } from "../lib/interestPolicy";

type GameDoc = {
  roundNumber?: number;
  baseInterestRate?: number;
  graceRateMultiplier?: number;
};

type TeamDoc = {
  cash?: number;
  debt?: number;
  reliability?: number;
  graceUntilRound?: number;
};

function num(n: any) {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}

export default function TeamLoanInfo({
  gameId,
  teamId,
}: {
  gameId: string;
  teamId: string;
}) {
  const [game, setGame] = useState<GameDoc | null>(null);
  const [team, setTeam] = useState<TeamDoc | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setErr(null);

    if (!gameId || !teamId) {
      setErr("Missing gameId or teamId.");
      return;
    }

    const gref = doc(db, "games", gameId);
    const tref = doc(db, "games", gameId, "teams", teamId);

    const unsubG = onSnapshot(
      gref,
      (s) => {
        if (!s.exists()) {
          setGame(null);
          setErr("Game doc not found.");
          return;
        }
        setGame(s.data() as GameDoc);
      },
      (e) => setErr(e.message)
    );

    const unsubT = onSnapshot(
      tref,
      (s) => {
        if (!s.exists()) {
          setTeam(null);
          setErr("Team doc not found.");
          return;
        }
        setTeam(s.data() as TeamDoc);
      },
      (e) => setErr(e.message)
    );

    return () => {
      unsubG();
      unsubT();
    };
  }, [gameId, teamId]);

  const cash = num(team?.cash ?? 0);
  const debt = num(team?.debt ?? 0);
  const reliability = num(team?.reliability ?? 100);

  const roundNumber = num(game?.roundNumber ?? 0);
  const baseRate = num(game?.baseInterestRate ?? 0.05);
  const graceMult = num(game?.graceRateMultiplier ?? 0);
  const graceUntilRound = num(team?.graceUntilRound ?? -1);

  const preview = useMemo(() => {
    return computeInterestPreview({
      debt,
      baseRate,
      graceMult,
      roundNumber,
      graceUntilRound,
      reliability,
    });
  }, [debt, baseRate, graceMult, roundNumber, graceUntilRound, reliability]);

  if (err) return <div style={{ color: "crimson" }}>{err}</div>;
  if (!game || !team) return <div>Loading loan info...</div>;

  // Show a "normal rate if you borrow now" (even if current debt = 0)
  // Requires computeInterestPreview to return relMult.
  const relMult = num((preview as any).relMult ?? 1);
  const normalIfBorrowNowRate = baseRate * relMult;

  return (
    <div
      style={{
        border: "1px solid #444",
        borderRadius: 12,
        padding: 12,
        maxWidth: 900,
      }}
    >
      <h3 style={{ marginTop: 0 }}>Loan & Interest (Preview)</h3>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <div>
          <b>Cash:</b> {cash}
        </div>
        <div>
          <b>Debt:</b> {debt}
        </div>
        <div>
          <b>Base rate:</b> {(baseRate * 100).toFixed(1)}%
        </div>

        <div>
          <b>Your rate this round:</b>{" "}
          {debt > 0 ? `${(num(preview.effectiveRate) * 100).toFixed(1)}%` : "-"}
        </div>

        <div>
          <b>Estimated interest at End Round:</b> {num(preview.interestDue)}
        </div>
      </div>

      <div style={{ marginTop: 8, opacity: 0.9 }}>
        <b>If you borrow now, your normal rate would be:</b>{" "}
        {(normalIfBorrowNowRate * 100).toFixed(1)}%
      </div>

      <div style={{ marginTop: 8 }}>
        <b>Grace:</b>{" "}
        {preview.inGrace ? (
          <span style={{ color: "lightgreen" }}>
            YES (interest reduced/free this round)
          </span>
        ) : (
          <span style={{ color: "salmon" }}>NO</span>
        )}
        <span style={{ marginLeft: 10, opacity: 0.8 }}>
          (graceUntilRound: {graceUntilRound})
        </span>
      </div>

      <small style={{ opacity: 0.75 }}>
        This is a preview. Teacher applies interest when they click “End Round
        (Settle)”.
      </small>
    </div>
  );
}
