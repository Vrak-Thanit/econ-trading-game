import { signOut } from "firebase/auth";
import { auth } from "../lib/firebase";

import TeacherControls from "../ui/TeacherControls";
import TeacherOrdersBoard from "../ui/TeacherOrderBoard";
import TeacherAcceptSaleBuckets from "../ui/TeacherAcceptSaleBuckets";
import TeacherTradesBoard from "../ui/TeacherTradesBoard";
import GameStatus from "../ui/GameStatus";

import { useGame } from "../lib/useGame";
import { useTeams } from "../lib/useTeams";

import InventoryBoard from "../ui/InventoryBoard";
import TeacherConsumablesAdjust from "../ui/TeacherConsumablesAdjust";
import TeacherLoanBoard from "../ui/TeacherLoanBoard";
import TeacherAuctionPanel from "../ui/TeacherAuctionPanel";

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold text-slate-100">{title}</h3>
      </div>
      <div>{children}</div>
    </section>
  );
}

export default function TeacherDashboard({ gameId }: { gameId: string }) {
  const { game, err } = useGame(gameId);
  const roundNumber = game?.roundNumber ?? 0;
  const phase = game?.phase ?? "-";
  const { teams } = useTeams(gameId);

  if (!gameId) {
    return (
      <div className="p-4 text-red-300">
        Missing gameId. Please go back and re-enter the game.
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-6xl p-4 md:p-6">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold">Teacher Dashboard</h2>
            <div className="mt-1 text-sm text-slate-300">
              <span className="font-semibold text-slate-200">Game:</span>{" "}
              {gameId}{" "}
              <span className="mx-2 text-slate-600">•</span>
              <span className="font-semibold text-slate-200">Phase:</span>{" "}
              {phase}{" "}
              <span className="mx-2 text-slate-600">•</span>
              <span className="font-semibold text-slate-200">Round:</span>{" "}
              {roundNumber}
            </div>
          </div>

          <button
            onClick={() => signOut(auth)}
            className="rounded-lg bg-slate-800 px-3 py-2 text-sm font-medium hover:bg-slate-700"
          >
            Log out
          </button>
        </div>

        {/* Error */}
        {err && (
          <div className="mt-4 rounded-xl border border-red-800 bg-red-950/40 p-3 text-red-200">
            {err}
          </div>
        )}

        {/* Content */}
        <div className="mt-6 space-y-6">
          <Section title="Round & Economy Controls">
            <TeacherControls gameId={gameId} />
          </Section>

          <Section title="Auction">
            <TeacherAuctionPanel gameId={gameId} />
          </Section>

          <Section title="Orders (Latest for current round)">
            <TeacherOrdersBoard gameId={gameId} roundNumber={roundNumber} />
          </Section>

          <Section title="Accept Sales">
            <TeacherAcceptSaleBuckets
              gameId={gameId}
              roundNumber={roundNumber}
              teams={teams}
            />
          </Section>

          <Section title="Trades">
            <TeacherTradesBoard gameId={gameId} />
          </Section>

          <Section title="Market Status">
            <GameStatus gameId={gameId} />
          </Section>

          <Section title="Loans">
            <TeacherLoanBoard gameId={gameId} />
          </Section>

          <Section title="Inventory Overview">
            <InventoryBoard gameId={gameId} />
          </Section>

          <Section title="Consumables Adjust (Teacher)">
            <TeacherConsumablesAdjust gameId={gameId} />
          </Section>
        </div>
      </div>
    </div>
  );
}
