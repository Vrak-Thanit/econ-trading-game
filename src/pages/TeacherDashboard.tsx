import { useEffect, useMemo, useState, type ReactNode } from "react";
import { signOut } from "firebase/auth";
import { collection, onSnapshot } from "firebase/firestore";

import { auth, db } from "../lib/firebase";
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

type TeacherMode =
  | "run"
  | "orders"
  | "sales"
  | "trades"
  | "auction"
  | "market"
  | "loans"
  | "inventory";

type AlertKey = "orders" | "trades" | "auction" | "loans";

type ModeAlertCounts = Record<AlertKey, number>;

const modes: {
  id: TeacherMode;
  label: string;
  description: string;
  alertKey?: AlertKey;
}[] = [
  {
    id: "run",
    label: "Run Game",
    description: "Start rounds, clone games, and control the main economy.",
  },
  {
    id: "orders",
    label: "Orders",
    description: "Review and process group production orders.",
    alertKey: "orders",
  },
  {
    id: "sales",
    label: "Accept Sales",
    description: "Accept or reject goods sold by teams.",
  },
  {
    id: "trades",
    label: "Trades",
    description: "Review trade requests between teams.",
    alertKey: "trades",
  },
  {
    id: "auction",
    label: "Auction",
    description: "Manage classroom auctions.",
    alertKey: "auction",
  },
  {
    id: "market",
    label: "Market",
    description: "Check current market and game status.",
  },
  {
    id: "loans",
    label: "Loans",
    description: "Manage team loans and repayments.",
    alertKey: "loans",
  },
  {
    id: "inventory",
    label: "Inventory",
    description: "View team inventory and adjust consumables.",
  },
];

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4 shadow-sm">
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-slate-100">{title}</h3>

        {description && (
          <p className="mt-1 text-sm text-slate-400">{description}</p>
        )}
      </div>

      <div>{children}</div>
    </section>
  );
}

export default function TeacherDashboard({ gameId }: { gameId: string }) {
  const [activeMode, setActiveMode] = useState<TeacherMode>("run");

  const [alerts, setAlerts] = useState<ModeAlertCounts>({
    orders: 0,
    trades: 0,
    auction: 0,
    loans: 0,
  });

  const { game, err } = useGame(gameId);
  const roundNumber = game?.roundNumber ?? 0;
  const phase = game?.phase ?? "-";
  const { teams } = useTeams(gameId);

  const activeModeInfo = modes.find((mode) => mode.id === activeMode);

  const totalAlerts = useMemo(() => {
    return alerts.orders + alerts.trades + alerts.auction + alerts.loans;
  }, [alerts]);

  // Count current-round unprocessed latest orders
  useEffect(() => {
    if (!gameId) return;

    const ordersRef = collection(db, "games", gameId, "orders");

    return onSnapshot(
      ordersRef,
      (snap) => {
        const latestByTeamShape = new Map<string, any>();

        snap.forEach((d) => {
          const order = d.data() as any;

          if (Number(order.roundNumber ?? 0) !== roundNumber) return;
          if (order.processedAt) return;

          const teamId = String(order.teamId ?? "");
          const shape = String(order.shape ?? "");
          const key = `${teamId}|${shape}`;

          const currentTime =
            typeof order.createdAt?.toMillis === "function"
              ? order.createdAt.toMillis()
              : 0;

          const previous = latestByTeamShape.get(key);
          const previousTime =
            typeof previous?.createdAt?.toMillis === "function"
              ? previous.createdAt.toMillis()
              : 0;

          if (!previous || currentTime >= previousTime) {
            latestByTeamShape.set(key, order);
          }
        });

        setAlerts((prev) => ({
          ...prev,
          orders: latestByTeamShape.size,
        }));
      },
      (error) => {
        console.error("Order alert listener error:", error);
      }
    );
  }, [gameId, roundNumber]);

  // Count current-round pending trades
  useEffect(() => {
    if (!gameId) return;

    const tradesRef = collection(db, "games", gameId, "trades");

    return onSnapshot(
      tradesRef,
      (snap) => {
        let count = 0;

        snap.forEach((d) => {
          const trade = d.data() as any;

          if (trade.status !== "PENDING") return;
          if (Number(trade.roundNumber ?? 0) !== roundNumber) return;

          count += 1;
        });

        setAlerts((prev) => ({
          ...prev,
          trades: count,
        }));
      },
      (error) => {
        console.error("Trade alert listener error:", error);
      }
    );
  }, [gameId, roundNumber]);

  // Count active auction bids
  useEffect(() => {
    if (!gameId || !game?.activeAuctionId) {
      setAlerts((prev) => ({
        ...prev,
        auction: 0,
      }));
      return;
    }

    const bidsRef = collection(
      db,
      "games",
      gameId,
      "auctions",
      String(game.activeAuctionId),
      "bids"
    );

    return onSnapshot(
      bidsRef,
      (snap) => {
        setAlerts((prev) => ({
          ...prev,
          auction: snap.size,
        }));
      },
      (error) => {
        console.error("Auction alert listener error:", error);
      }
    );
  }, [gameId, game?.activeAuctionId]);

  // Count pending loan requests
  useEffect(() => {
    if (!gameId) return;

    const loansRef = collection(db, "games", gameId, "loanRequests");

    return onSnapshot(
      loansRef,
      (snap) => {
        let count = 0;

        snap.forEach((d) => {
          const loan = d.data() as any;

          if (loan.status === "PENDING") {
            count += 1;
          }
        });

        setAlerts((prev) => ({
          ...prev,
          loans: count,
        }));
      },
      (error) => {
        console.error("Loan alert listener error:", error);
      }
    );
  }, [gameId]);

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
              {gameId}
              <span className="mx-2 text-slate-600">•</span>
              <span className="font-semibold text-slate-200">Phase:</span>{" "}
              {phase}
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

        {/* Alert summary */}
        {totalAlerts > 0 && (
          <div className="mt-6 rounded-2xl border border-amber-500/40 bg-amber-950/40 p-4 text-amber-100">
            <div className="font-semibold">Needs teacher attention</div>

            <div className="mt-2 flex flex-wrap gap-2 text-sm">
              {alerts.orders > 0 && (
                <button
                  type="button"
                  onClick={() => setActiveMode("orders")}
                  className="rounded-full bg-amber-500/20 px-3 py-1 hover:bg-amber-500/30"
                >
                  Orders: {alerts.orders}
                </button>
              )}

              {alerts.trades > 0 && (
                <button
                  type="button"
                  onClick={() => setActiveMode("trades")}
                  className="rounded-full bg-amber-500/20 px-3 py-1 hover:bg-amber-500/30"
                >
                  Trades: {alerts.trades}
                </button>
              )}

              {alerts.auction > 0 && (
                <button
                  type="button"
                  onClick={() => setActiveMode("auction")}
                  className="rounded-full bg-amber-500/20 px-3 py-1 hover:bg-amber-500/30"
                >
                  Auction bids: {alerts.auction}
                </button>
              )}

              {alerts.loans > 0 && (
                <button
                  type="button"
                  onClick={() => setActiveMode("loans")}
                  className="rounded-full bg-amber-500/20 px-3 py-1 hover:bg-amber-500/30"
                >
                  Loans: {alerts.loans}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Mode buttons */}
        <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/60 p-3">
          <div className="mb-3">
            <h3 className="text-sm font-semibold text-slate-200">
              Teacher Control Modes
            </h3>

            <p className="text-xs text-slate-400">
              Choose only the tool you need right now. This keeps the dashboard
              easier to control during class.
            </p>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-4">
            {modes.map((mode) => {
              const isActive = activeMode === mode.id;
              const alertCount = mode.alertKey ? alerts[mode.alertKey] : 0;

              return (
                <button
                  key={mode.id}
                  type="button"
                  onClick={() => setActiveMode(mode.id)}
                  className={[
                    "rounded-xl border px-3 py-2 text-left text-sm transition",
                    isActive
                      ? "border-blue-500 bg-blue-950/60 text-blue-100"
                      : "border-slate-800 bg-slate-950/60 text-slate-300 hover:bg-slate-800",
                  ].join(" ")}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-semibold">{mode.label}</div>

                    {alertCount > 0 && (
                      <span className="rounded-full bg-red-500 px-2 py-0.5 text-xs font-bold text-white">
                        {alertCount}
                      </span>
                    )}
                  </div>

                  <div className="mt-1 text-xs opacity-80">
                    {mode.description}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Active mode content */}
        <div className="mt-6">
          {activeMode === "run" && (
            <Section
              title="Run Game"
              description={activeModeInfo?.description}
            >
              <TeacherControls gameId={gameId} />
            </Section>
          )}

          {activeMode === "orders" && (
            <Section title="Orders" description={activeModeInfo?.description}>
              <TeacherOrdersBoard gameId={gameId} roundNumber={roundNumber} />
            </Section>
          )}

          {activeMode === "sales" && (
            <Section
              title="Accept Sales"
              description={activeModeInfo?.description}
            >
              <TeacherAcceptSaleBuckets
                gameId={gameId}
                roundNumber={roundNumber}
                teams={teams}
              />
            </Section>
          )}

          {activeMode === "trades" && (
            <Section title="Trades" description={activeModeInfo?.description}>
              <TeacherTradesBoard gameId={gameId} />
            </Section>
          )}

          {activeMode === "auction" && (
            <Section title="Auction" description={activeModeInfo?.description}>
              <TeacherAuctionPanel gameId={gameId} />
            </Section>
          )}

          {activeMode === "market" && (
            <Section
              title="Market Status"
              description={activeModeInfo?.description}
            >
              <GameStatus gameId={gameId} />
            </Section>
          )}

          {activeMode === "loans" && (
            <Section title="Loans" description={activeModeInfo?.description}>
              <TeacherLoanBoard gameId={gameId} />
            </Section>
          )}

          {activeMode === "inventory" && (
            <Section
              title="Inventory"
              description={activeModeInfo?.description}
            >
              <div className="space-y-6">
                <InventoryBoard gameId={gameId} />
                <TeacherConsumablesAdjust gameId={gameId} />
              </div>
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}