import { signOut } from "firebase/auth";
import { auth } from "../lib/firebase";

import TeamStatus from "../ui/TeamStatus";
import TeamOrderForm from "../ui/TeamOrderForm";
import TeamTradeForm from "../ui/TeamTradeForm";
import GameStatus from "../ui/GameStatus";

import { useGame } from "../lib/useGame";
import InventoryBoard from "../ui/InventoryBoard";
import ItemMarket from "../ui/ItemMarket";

import TeamLoanPanel from "../ui/TeamLoanPanel";
import TeamLoanInfo from "../ui/TeamLoanInfo";

import TeamAuctionPanel from "../ui/TeamAuctionPanel";
import TeamRecentActivity from "../ui/TeamRecentActivity";


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

export default function TeamDashboard({
  gameId,
  teamId,
}: {
  gameId: string;
  teamId: string;
}) {
  const { game, err } = useGame(gameId);
  const phase = game?.phase ?? "-";
  const roundNumber = game?.roundNumber ?? 0;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-6xl p-4 md:p-6">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold">Team Dashboard</h2>
            <div className="mt-1 text-sm text-slate-300">
              <span className="font-semibold text-slate-200">Team:</span>{" "}
              {teamId}{" "}
              <span className="mx-2 text-slate-600">•</span>
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

        {err && (
          <div className="mt-4 rounded-xl border border-red-800 bg-red-950/40 p-3 text-red-200">
            {err}
          </div>
        )}

        <div className="mt-6 space-y-6">
          <Section title="Your Team Status">
            <TeamStatus gameId={gameId} teamId={teamId} />
          </Section>

          <Section title="Orders">
            <TeamOrderForm
              gameId={gameId}
              teamId={teamId}
              roundNumber={roundNumber}
              phase={phase}
            />
          </Section>

          <Section title="Trade Requests">
            <TeamRecentActivity gameId={gameId} teamId={teamId} roundNumber={roundNumber} />
          </Section>

          <Section title="Trade Requests">
            <TeamTradeForm gameId={gameId} teamId={teamId} roundNumber={roundNumber} />
          </Section>

          <Section title="Market Status">
            <GameStatus gameId={gameId} />
          </Section>

          <Section title="Loans">
            <TeamLoanPanel gameId={gameId} teamId={teamId} />
          </Section>

          <Section title="Loan Info">
            <TeamLoanInfo gameId={gameId} teamId={teamId} />
          </Section>

          <Section title="Item Market">
            <ItemMarket gameId={gameId} />
          </Section>

          <Section title="Auction">
            <TeamAuctionPanel gameId={gameId} teamId={teamId} />
          </Section>

          <Section title="Inventory">
            <InventoryBoard gameId={gameId} />
          </Section>
        </div>
      </div>
    </div>
  );
}
