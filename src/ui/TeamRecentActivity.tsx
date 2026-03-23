// src/ui/TeamRecentActivity.tsx
import { useMemo, useState } from "react";
import { useTeamActivity } from "../lib/useTeamActivity";

function timeAgo(ms: number) {
  if (!ms) return "";
  const diff = Date.now() - ms;
  const s = Math.max(0, Math.floor(diff / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export default function TeamRecentActivity({
  gameId,
  teamId,
  roundNumber,
}: {
  gameId: string;
  teamId: string;
  roundNumber: number;
}) {
  const { events, err } = useTeamActivity({ gameId, teamId, maxPerType: 30 });
  const [showAll, setShowAll] = useState(false);

  const thisRound = useMemo(() => {
    return events.filter((e) => (e.roundNumber ?? -999) === roundNumber);
  }, [events, roundNumber]);

  const ordersThisRound = thisRound.filter((e) => e.type === "ORDER").length;
  const salesThisRound = thisRound.filter((e) => e.type === "SALE").length;

  const visible = showAll ? events : events.slice(0, 5);

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-lg font-semibold">Recent Activity</div>
          <div className="text-sm text-slate-300">
            Round {roundNumber} • Orders: <span className="font-semibold text-slate-100">{ordersThisRound}</span> • Sales:{" "}
            <span className="font-semibold text-slate-100">{salesThisRound}</span>
          </div>
        </div>

        <button
          className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm font-semibold text-slate-100 hover:bg-slate-700"
          onClick={() => setShowAll((v) => !v)}
        >
          {showAll ? "Show less" : "Show full history"}
        </button>
      </div>

      {err && (
        <div className="mt-3 rounded-lg border border-red-800 bg-red-950/40 p-3 text-sm text-red-200">
          {err}
        </div>
      )}

      <div className="mt-3 space-y-2">
        {visible.length === 0 ? (
          <div className="text-sm text-slate-300">No activity yet.</div>
        ) : (
          visible.map((e) => (
            <div
              key={`${e.type}_${e.id}`}
              className="flex items-start justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2"
            >
              <div>
                <div className="text-sm font-semibold text-slate-100">
                  {e.title}{" "}
                  <span className="ml-2 text-xs font-normal text-slate-400">
                    {e.roundNumber != null ? `R${e.roundNumber}` : ""}
                  </span>
                </div>
                {e.detail && <div className="text-sm text-slate-300">{e.detail}</div>}
              </div>
              <div className="text-xs text-slate-400">{timeAgo(e.tsMs)}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
