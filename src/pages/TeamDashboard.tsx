import { useEffect, useMemo, useState, type ReactNode } from "react";
import { signOut } from "firebase/auth";
import { collection, onSnapshot, query, where } from "firebase/firestore";

import { auth, db } from "../lib/firebase";
import TeamStatus from "../ui/TeamStatus";
import TeamOrderForm from "../ui/TeamOrderForm";
import TeamTradeForm from "../ui/TeamTradeForm";
import TeamTradeInbox from "../ui/TeamTradeInbox";
import TeamRentalForm from "../ui/TeamRentalForm";
import TeamRentalInbox from "../ui/TeamRentalInbox";
import GameStatus from "../ui/GameStatus";
import { useGame } from "../lib/useGame";
import InventoryBoard from "../ui/InventoryBoard";
import ItemMarket from "../ui/ItemMarket";
import TeamLoanPanel from "../ui/TeamLoanPanel";
import TeamLoanInfo from "../ui/TeamLoanInfo";
import TeamAuctionPanel from "../ui/TeamAuctionPanel";
import TeamRecentActivity from "../ui/TeamRecentActivity";

type StudentMode =
  | "overview"
  | "production"
  | "trade"
  | "rent"
  | "market"
  | "bank"
  | "auction"
  | "inventory"
  | "activity";

const modes: {
  id: StudentMode;
  label: string;
  description: string;
}[] = [
  {
    id: "overview",
    label: "Overview",
    description: "Check your team status and game phase.",
  },
  {
    id: "production",
    label: "Production",
    description: "Submit your team production order.",
  },
  {
    id: "trade",
    label: "Trade",
    description: "Send, receive, and track trade requests.",
  },
  {
    id: "rent",
    label: "Rent / Borrow",
    description: "Borrow equipment from other teams temporarily.",
  },
  {
    id: "market",
    label: "Market",
    description: "Check market prices and economy status.",
  },
  {
    id: "bank",
    label: "Bank / Loan",
    description: "Borrow, repay, and preview interest.",
  },
  {
    id: "auction",
    label: "Auction",
    description: "Join active classroom auctions.",
  },
  {
    id: "inventory",
    label: "Inventory",
    description: "Check items and resources owned by teams.",
  },
  {
    id: "activity",
    label: "Activity",
    description: "Review your recent orders and actions.",
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

function InfoCard({
  title,
  value,
  hint,
}: {
  title: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {title}
      </div>

      <div className="mt-1 text-xl font-bold text-slate-100">{value}</div>

      {hint && <div className="mt-1 text-xs text-slate-400">{hint}</div>}
    </div>
  );
}

function getPhaseAdvice(phase: string) {
  if (phase === "LIVE") {
    return {
      title: "Round is live",
      message:
        "Focus on production orders, trade requests, and rental decisions. Submit before the teacher ends the round.",
      recommendedMode: "production" as StudentMode,
      recommendedLabel: "Go to Production",
    };
  }

  if (phase === "INTERVAL") {
    return {
      title: "Interval time",
      message:
        "Review your result, check resources, manage rentals, manage loans, and prepare your next strategy.",
      recommendedMode: "overview" as StudentMode,
      recommendedLabel: "Go to Overview",
    };
  }

  if (phase === "SETTLEMENT") {
    return {
      title: "Settlement phase",
      message:
        "Wait while the teacher processes results. Check your activity, rental status, and team status.",
      recommendedMode: "activity" as StudentMode,
      recommendedLabel: "Go to Activity",
    };
  }

  return {
    title: "Waiting for teacher",
    message:
      "Check your team status and wait for the teacher to start or update the game phase.",
    recommendedMode: "overview" as StudentMode,
    recommendedLabel: "Go to Overview",
  };
}

export default function TeamDashboard({
  gameId,
  teamId,
}: {
  gameId: string;
  teamId: string;
}) {
  const [activeMode, setActiveMode] = useState<StudentMode>("overview");

  const [incomingTradeCount, setIncomingTradeCount] = useState(0);
  const [sentTradeUpdateCount, setSentTradeUpdateCount] = useState(0);

  const [incomingRentalCount, setIncomingRentalCount] = useState(0);
  const [sentRentalUpdateCount, setSentRentalUpdateCount] = useState(0);
  const [ownerReturnAlertCount, setOwnerReturnAlertCount] = useState(0);
  const [borrowerReturnAlertCount, setBorrowerReturnAlertCount] = useState(0);

  const { game, err } = useGame(gameId);
  const phase = game?.phase ?? "-";
  const roundNumber = game?.roundNumber ?? 0;

  const activeAuctionId = (game as any)?.activeAuctionId ?? null;
  const hasActiveAuction = Boolean(activeAuctionId);

  const activeModeInfo = modes.find((mode) => mode.id === activeMode);

  const phaseAdvice = useMemo(() => {
    return getPhaseAdvice(phase);
  }, [phase]);

  const totalTradeBadge = incomingTradeCount + sentTradeUpdateCount;

  const returnDueCount = ownerReturnAlertCount + borrowerReturnAlertCount;

  const totalRentalBadge =
    incomingRentalCount + sentRentalUpdateCount + returnDueCount;

  useEffect(() => {
    if (!gameId || !teamId) return;

    const tradesRef = collection(db, "games", gameId, "trades");

    const receivedQuery = query(tradesRef, where("toTeamId", "==", teamId));

    const unsubReceived = onSnapshot(
      receivedQuery,
      (snap) => {
        let count = 0;

        snap.forEach((d) => {
          const trade = d.data() as any;

          if (
            trade.status === "WAITING_TEAM" &&
            Number(trade.roundNumber ?? 0) === roundNumber
          ) {
            count += 1;
          }
        });

        setIncomingTradeCount(count);
      },
      (error) => {
        console.error("Incoming trade alert error:", error);
        setIncomingTradeCount(0);
      }
    );

    const sentQuery = query(tradesRef, where("fromTeamId", "==", teamId));

    const unsubSent = onSnapshot(
      sentQuery,
      (snap) => {
        let count = 0;

        snap.forEach((d) => {
          const trade = d.data() as any;

          if (
            Number(trade.roundNumber ?? 0) === roundNumber &&
            trade.status !== "WAITING_TEAM" &&
            !trade.senderSeenAt
          ) {
            count += 1;
          }
        });

        setSentTradeUpdateCount(count);
      },
      (error) => {
        console.error("Sent trade update alert error:", error);
        setSentTradeUpdateCount(0);
      }
    );

    return () => {
      unsubReceived();
      unsubSent();
    };
  }, [gameId, teamId, roundNumber]);

  useEffect(() => {
    if (!gameId || !teamId) return;

    const rentalsRef = collection(db, "games", gameId, "rentals");

    const ownerQuery = query(rentalsRef, where("ownerTeamId", "==", teamId));

    const unsubOwner = onSnapshot(
      ownerQuery,
      (snap) => {
        let waitingOwnerCount = 0;
        let ownerReturnCount = 0;

        snap.forEach((d) => {
          const rental = d.data() as any;

          if (
            rental.status === "WAITING_OWNER" &&
            Number(rental.roundNumber ?? 0) === roundNumber
          ) {
            waitingOwnerCount += 1;
          }

          if (
            rental.status === "RETURN_DUE" ||
            rental.status === "RETURN_REQUESTED"
          ) {
            ownerReturnCount += 1;
          }
        });

        setIncomingRentalCount(waitingOwnerCount);
        setOwnerReturnAlertCount(ownerReturnCount);
      },
      (error) => {
        console.error("Owner rental alert error:", error);
        setIncomingRentalCount(0);
        setOwnerReturnAlertCount(0);
      }
    );

    const borrowerQuery = query(
      rentalsRef,
      where("borrowerTeamId", "==", teamId)
    );

    const unsubBorrower = onSnapshot(
      borrowerQuery,
      (snap) => {
        let updateCount = 0;
        let borrowerReturnCount = 0;

        snap.forEach((d) => {
          const rental = d.data() as any;

          if (
            Number(rental.roundNumber ?? 0) === roundNumber &&
            rental.status !== "WAITING_OWNER" &&
            !rental.borrowerSeenAt
          ) {
            updateCount += 1;
          }

          if (rental.status === "RETURN_DUE") {
            borrowerReturnCount += 1;
          }
        });

        setSentRentalUpdateCount(updateCount);
        setBorrowerReturnAlertCount(borrowerReturnCount);
      },
      (error) => {
        console.error("Borrower rental alert error:", error);
        setSentRentalUpdateCount(0);
        setBorrowerReturnAlertCount(0);
      }
    );

    return () => {
      unsubOwner();
      unsubBorrower();
    };
  }, [gameId, teamId, roundNumber]);

  if (!gameId || !teamId) {
    return (
      <div className="p-4 text-red-300">
        Missing gameId or teamId. Please log in again or check your user
        profile.
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-6xl p-4 md:p-6">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold">Team Dashboard</h2>

            <div className="mt-1 text-sm text-slate-300">
              <span className="font-semibold text-slate-200">Team:</span>{" "}
              {teamId}
              <span className="mx-2 text-slate-600">•</span>
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

        {/* Quick status cards */}
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <InfoCard title="Team" value={teamId} hint="Your group account" />
          <InfoCard title="Round" value={roundNumber} hint="Current round" />
          <InfoCard title="Phase" value={phase} hint="Game state now" />
          <InfoCard
            title="Suggested"
            value={phaseAdvice.recommendedLabel.replace("Go to ", "")}
            hint="Best place to start"
          />
        </div>

        {/* Trade notification */}
        {totalTradeBadge > 0 && (
          <div className="mt-6 rounded-2xl border border-amber-500/40 bg-amber-950/40 p-4 text-amber-100">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="font-semibold">Trade needs your attention</div>

                <div className="mt-1 text-sm text-amber-100/80">
                  {incomingTradeCount > 0 && (
                    <span className="mr-3">
                      Received requests: {incomingTradeCount}
                    </span>
                  )}

                  {sentTradeUpdateCount > 0 && (
                    <span className="mr-3">
                      Sent request updates: {sentTradeUpdateCount}
                    </span>
                  )}
                </div>
              </div>

              <button
                type="button"
                onClick={() => setActiveMode("trade")}
                className="rounded-lg bg-amber-500 px-3 py-2 text-sm font-semibold text-slate-950 hover:bg-amber-400"
              >
                Review Trade
              </button>
            </div>
          </div>
        )}

        {/* Rental notification */}
        {totalRentalBadge > 0 && (
          <div className="mt-6 rounded-2xl border border-cyan-500/40 bg-cyan-950/40 p-4 text-cyan-100">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="font-semibold">Rental needs your attention</div>

                <div className="mt-1 text-sm text-cyan-100/80">
                  {incomingRentalCount > 0 && (
                    <span className="mr-3">
                      Rental requests to your team: {incomingRentalCount}
                    </span>
                  )}

                  {sentRentalUpdateCount > 0 && (
                    <span className="mr-3">
                      Rental request updates: {sentRentalUpdateCount}
                    </span>
                  )}

                  {returnDueCount > 0 && (
                    <span className="mr-3">
                      Return alerts: {returnDueCount}
                    </span>
                  )}
                </div>
              </div>

              <button
                type="button"
                onClick={() => setActiveMode("rent")}
                className="rounded-lg bg-cyan-500 px-3 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400"
              >
                Review Rentals
              </button>
            </div>
          </div>
        )}

        {/* Auction notification */}
        {hasActiveAuction && (
          <div className="mt-6 rounded-2xl border border-purple-500/40 bg-purple-950/40 p-4 text-purple-100">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="font-semibold">Auction is open now</div>

                <div className="mt-1 text-sm text-purple-100/80">
                  The teacher has opened an auction. Go to the Auction section
                  to check the item and place your bid.
                </div>
              </div>

              <button
                type="button"
                onClick={() => setActiveMode("auction")}
                className="rounded-lg bg-purple-500 px-3 py-2 text-sm font-semibold text-white hover:bg-purple-400"
              >
                Go to Auction
              </button>
            </div>
          </div>
        )}

        {/* Phase guidance */}
        <div className="mt-6 rounded-2xl border border-blue-500/40 bg-blue-950/30 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold text-blue-100">
                {phaseAdvice.title}
              </h3>

              <p className="mt-1 text-sm text-blue-200/80">
                {phaseAdvice.message}
              </p>
            </div>

            <button
              type="button"
              onClick={() => setActiveMode(phaseAdvice.recommendedMode)}
              className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-500"
            >
              {phaseAdvice.recommendedLabel}
            </button>
          </div>
        </div>

        {/* Student control modes */}
        <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/60 p-3">
          <div className="mb-3">
            <h3 className="text-sm font-semibold text-slate-200">
              Student Control Sections
            </h3>

            <p className="text-xs text-slate-400">
              Choose one section at a time. This keeps the game screen easier to
              read and easier to use.
            </p>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-4">
            {modes.map((mode) => {
              const isActive = activeMode === mode.id;
              const showTradeBadge =
                mode.id === "trade" && totalTradeBadge > 0;
              const showRentalBadge =
                mode.id === "rent" && totalRentalBadge > 0;
              const showAuctionBadge =
                mode.id === "auction" && hasActiveAuction;

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

                    {showTradeBadge && (
                      <span className="rounded-full bg-red-500 px-2 py-0.5 text-xs font-bold text-white">
                        {totalTradeBadge}
                      </span>
                    )}

                    {showRentalBadge && (
                      <span className="rounded-full bg-cyan-500 px-2 py-0.5 text-xs font-bold text-slate-950">
                        {totalRentalBadge}
                      </span>
                    )}

                    {showAuctionBadge && (
                      <span className="rounded-full bg-purple-500 px-2 py-0.5 text-xs font-bold text-white">
                        LIVE
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

        {/* Active section content */}
        <div className="mt-6">
          {activeMode === "overview" && (
            <Section
              title="Overview"
              description={activeModeInfo?.description}
            >
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
                  <h4 className="mb-3 font-semibold text-slate-100">
                    Your Team Status
                  </h4>

                  <TeamStatus gameId={gameId} teamId={teamId} />
                </div>

                <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
                  <h4 className="mb-3 font-semibold text-slate-100">
                    Game Status
                  </h4>

                  <GameStatus gameId={gameId} />
                </div>
              </div>
            </Section>
          )}

          {activeMode === "production" && (
            <Section
              title="Production Order"
              description={activeModeInfo?.description}
            >
              <div className="mb-4 rounded-xl border border-amber-500/40 bg-amber-950/40 p-4 text-amber-100">
                <h4 className="font-semibold">
                  Important Production Submission Rule
                </h4>

                <p className="mt-2 text-sm leading-6">
                  Submit each product shape in <b>one bulk request</b>. If your
                  team wants to produce the same shape, enter the total amount
                  at once.
                </p>

                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <div className="rounded-lg border border-red-500/30 bg-red-950/30 p-3">
                    <div className="font-semibold text-red-200">
                      Wrong example
                    </div>

                    <p className="mt-1 text-sm text-red-100/90">
                      First submit <b>2 circles</b>, then later submit{" "}
                      <b>3 circles</b>. The system will count the latest circle
                      request as <b>3 circles</b>, not 5.
                    </p>
                  </div>

                  <div className="rounded-lg border border-green-500/30 bg-green-950/30 p-3">
                    <div className="font-semibold text-green-200">
                      Correct example
                    </div>

                    <p className="mt-1 text-sm text-green-100/90">
                      Submit <b>5 circles</b> in one request. If you also want
                      another shape, such as <b>4 rectangles</b>, submit
                      rectangles separately. Different shapes are counted
                      separately.
                    </p>
                  </div>
                </div>

                <p className="mt-3 text-sm font-semibold">
                  Simple rule: one shape = one final bulk submission.
                </p>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
                <TeamOrderForm
                  gameId={gameId}
                  teamId={teamId}
                  roundNumber={roundNumber}
                  phase={phase}
                />
              </div>
            </Section>
          )}

          {activeMode === "trade" && (
            <Section title="Trade" description={activeModeInfo?.description}>
              <div className="space-y-4">
                <TeamTradeInbox
                  gameId={gameId}
                  teamId={teamId}
                  roundNumber={roundNumber}
                />

                <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
                  <TeamTradeForm
                    gameId={gameId}
                    teamId={teamId}
                    roundNumber={roundNumber}
                  />
                </div>
              </div>
            </Section>
          )}

          {activeMode === "rent" && (
            <Section
              title="Rent / Borrow"
              description={activeModeInfo?.description}
            >
              <div className="mb-4 rounded-xl border border-cyan-500/40 bg-cyan-950/40 p-4 text-cyan-100">
                <h4 className="font-semibold">Rental Rule</h4>

                <p className="mt-2 text-sm leading-6 text-cyan-100/90">
                  Renting is temporary. Your team can borrow equipment from
                  another team for a set number of rounds and pay a rental fee
                  per round. The owner team must accept first, then the teacher
                  gives final approval.
                </p>

                <p className="mt-2 text-sm leading-6 text-cyan-100/90">
                  This system uses one simple direction: <b>the borrowing team
                  sends the official rental request</b>. If your team wants to
                  rent out an item, ask the borrowing team to send you a rental
                  request. Your team can then accept or reject it.
                </p>

                <p className="mt-2 text-sm leading-6 text-cyan-100/90">
                  When the rental period ends, the borrowed item must be
                  returned. Any unpaid rental fee remains as debt until paid.
                </p>
              </div>

              <div className="space-y-4">
                <TeamRentalInbox
                  gameId={gameId}
                  teamId={teamId}
                  roundNumber={roundNumber}
                />

                <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
                  <TeamRentalForm
                    gameId={gameId}
                    teamId={teamId}
                    roundNumber={roundNumber}
                  />
                </div>
              </div>
            </Section>
          )}

          {activeMode === "market" && (
            <Section title="Market" description={activeModeInfo?.description}>
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
                  <h4 className="mb-3 font-semibold text-slate-100">
                    Shape Market
                  </h4>

                  <GameStatus gameId={gameId} />
                </div>

                <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
                  <h4 className="mb-3 font-semibold text-slate-100">
                    Item Market
                  </h4>

                  <ItemMarket gameId={gameId} />
                </div>
              </div>
            </Section>
          )}

          {activeMode === "bank" && (
            <Section
              title="Bank / Loan"
              description={activeModeInfo?.description}
            >
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
                  <TeamLoanInfo gameId={gameId} teamId={teamId} />
                </div>

                <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
                  <TeamLoanPanel gameId={gameId} teamId={teamId} />
                </div>
              </div>
            </Section>
          )}

          {activeMode === "auction" && (
            <Section title="Auction" description={activeModeInfo?.description}>
              {hasActiveAuction && (
                <div className="mb-4 rounded-xl border border-purple-500/40 bg-purple-950/40 p-4 text-purple-100">
                  <h4 className="font-semibold">Auction is live</h4>

                  <p className="mt-1 text-sm text-purple-100/80">
                    Check the auction details below and submit your bid before
                    the teacher closes it.
                  </p>
                </div>
              )}

              <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
                <TeamAuctionPanel gameId={gameId} teamId={teamId} />
              </div>
            </Section>
          )}

          {activeMode === "inventory" && (
            <Section
              title="Inventory"
              description={activeModeInfo?.description}
            >
              <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
                <InventoryBoard gameId={gameId} />
              </div>
            </Section>
          )}

          {activeMode === "activity" && (
            <Section
              title="Recent Activity"
              description={activeModeInfo?.description}
            >
              <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
                <TeamRecentActivity
                  gameId={gameId}
                  teamId={teamId}
                  roundNumber={roundNumber}
                />
              </div>
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}