import { collection, doc, runTransaction, serverTimestamp } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import { db } from "../lib/firebase";
import type { TeamRow } from "../lib/useTeams";

const SHAPES = ["circle", "rectangle", "protractor", "equilateral", "triangle"] as const;

// ✅ Added 0x option (no pay, delivery only)
const MULTS = [
  { label: "0x (no pay)", value: 0 },
  { label: "0.5x", value: 0.5 },
  { label: "0.75x", value: 0.75 },
  { label: "1.0x", value: 1 },
  { label: "1.25x", value: 1.25 },
  { label: "1.5x", value: 1.5 },
] as const;

type Buckets = Record<string, number>;

function clamp0(n: any) {
  const v = Math.floor(Number(n));
  return Number.isFinite(v) ? Math.max(0, v) : 0;
}

export default function TeacherAcceptSaleBuckets({
  gameId,
  roundNumber,
  teams,
}: {
  gameId: string;
  roundNumber: number;
  teams: TeamRow[];
}) {
  const teamIds = useMemo(() => teams.map((t) => t.teamId), [teams]);

  const [teamId, setTeamId] = useState(teamIds[0] ?? "A");
  const [shape, setShape] = useState<(typeof SHAPES)[number]>("circle");
  const [deliveredQty, setDeliveredQty] = useState<number>(0);
  const [note, setNote] = useState<string>("");

  // ✅ Sticker rule switch (default ON)
  const [stickerRuleOn, setStickerRuleOn] = useState(true);

  // ✅ Added "0" bucket
  const [buckets, setBuckets] = useState<Buckets>({
    "0": 0,
    "0.5": 0,
    "0.75": 0,
    "1": 0,
    "1.25": 0,
    "1.5": 0,
  });

  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!teamIds.includes(teamId) && teamIds.length > 0) setTeamId(teamIds[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamIds.join("|")]);

  const acceptedTotal = useMemo(() => {
    return Object.values(buckets).reduce((a, b) => a + clamp0(b), 0);
  }, [buckets]);

  // ✅ This is the part that will be PAID and consumes demand
  const soldQty = useMemo(() => {
    return Math.max(0, acceptedTotal - clamp0(buckets["0"]));
  }, [acceptedTotal, buckets]);

  // ✅ This is delivered-but-not-sold (0 money, no demand use)
  const unpaidQty = useMemo(() => clamp0(buckets["0"]), [buckets]);

  // ✅ Only sold buckets affect money
  const weightedUnits = useMemo(() => {
    return (
      clamp0(buckets["0.5"]) * 0.5 +
      clamp0(buckets["0.75"]) * 0.75 +
      clamp0(buckets["1"]) * 1 +
      clamp0(buckets["1.25"]) * 1.25 +
      clamp0(buckets["1.5"]) * 1.5
    );
  }, [buckets]);

  // ✅ Stickers only for SOLD 1.25x / 1.5x (not 0x)
  const stickerQtyAuto = useMemo(() => {
    return clamp0(buckets["1.25"]) + clamp0(buckets["1.5"]);
  }, [buckets]);

  return (
    <div style={{ border: "1px solid #444", borderRadius: 12, padding: 12, maxWidth: 980 }}>
      <h3>Accept Sale (Quality Buckets + 0x Delivery Only)</h3>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <label>
          Team{" "}
          <select value={teamId} onChange={(e) => setTeamId(e.target.value)}>
            {teamIds.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </label>

        <label>
          Shape{" "}
          <select value={shape} onChange={(e) => setShape(e.target.value as any)}>
            {SHAPES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>

        <label>
          Delivered{" "}
          <input
            type="number"
            min={0}
            value={deliveredQty}
            onChange={(e) => setDeliveredQty(clamp0(e.target.value))}
            style={{ width: 90 }}
          />
        </label>

        <label style={{ flex: "1 1 240px" }}>
          Note{" "}
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="quality / sticker / bad cut..."
            style={{ width: "100%" }}
          />
        </label>
      </div>

      <div style={{ marginTop: 10, display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="checkbox"
            checked={stickerRuleOn}
            onChange={(e) => setStickerRuleOn(e.target.checked)}
          />
          Auto-consume stickers for 1.25x / 1.5x buckets (sold only)
        </label>

        <div style={{ opacity: 0.85 }}>
          <b>Sticker qty (auto):</b> {stickerRuleOn ? stickerQtyAuto : 0}
        </div>
      </div>

      <div
        style={{
          marginTop: 12,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: 10,
        }}
      >
        {MULTS.map((m) => (
          <div key={m.value} style={{ border: "1px solid #333", borderRadius: 10, padding: 10 }}>
            <div style={{ fontWeight: 700 }}>{m.label}</div>
            <div style={{ opacity: 0.8, fontSize: 12 }}>qty processed</div>

            <input
              type="number"
              min={0}
              value={buckets[String(m.value)] ?? 0}
              onChange={(e) => {
                const v = clamp0(e.target.value);
                setBuckets((prev) => ({ ...prev, [String(m.value)]: v }));
              }}
              style={{ width: "100%", padding: 8, marginTop: 6 }}
            />
          </div>
        ))}
      </div>

      <div style={{ marginTop: 12, display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
        <div>
          <b>Accepted total:</b> {acceptedTotal}
        </div>
        <div>
          <b>Sold (uses demand):</b> {soldQty}
        </div>
        <div>
          <b>Unpaid delivery (0x):</b> {unpaidQty}
        </div>
        <div>
          <b>Weighted units (sold only):</b> {weightedUnits.toFixed(2)}
        </div>

        <button
          style={{ padding: "8px 12px" }}
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            setErr(null);
            setMsg(null);

            try {
              const gameRef = doc(db, "games", gameId);
              const teamRef = doc(db, "games", gameId, "teams", teamId);

              await runTransaction(db, async (tx) => {
                const gameSnap = await tx.get(gameRef);
                if (!gameSnap.exists()) throw new Error("Game not found");
                const game = gameSnap.data() as any;

                const teamSnap = await tx.get(teamRef);
                if (!teamSnap.exists()) throw new Error("Team not found");
                const team = teamSnap.data() as any;

                const phase = String(game.phase ?? "");
                const currentRoundNum = Number(game.roundNumber ?? 0);

                if (phase !== "INTERVAL") throw new Error(`Cannot process: only during INTERVAL (current: ${phase})`);

                if (currentRoundNum !== roundNumber) throw new Error("Round mismatch (refresh page)");

                const pricesMap = game.currentRound?.prices ?? {};
                const remainingMap = game.currentRound?.remainingDemand ?? {};

                const unitPrice = Number(pricesMap[shape] ?? 0);
                const remainingDemand = Number(remainingMap[shape] ?? 0);

                const delivered = clamp0(deliveredQty);
                const accepted = clamp0(acceptedTotal);

                const unpaid = clamp0(buckets["0"]);
                const sold = Math.max(0, accepted - unpaid);

                if (delivered <= 0) throw new Error("Delivered must be > 0");
                if (accepted <= 0) throw new Error("Accepted total must be > 0");
                if (accepted > delivered) throw new Error("Accepted total cannot exceed delivered");

                // ✅ Still enforce: SOLD part cannot exceed remaining demand
                if (sold > remainingDemand) {
                  throw new Error(
                    `Sold qty exceeds remaining demand (remaining: ${remainingDemand}).\n` +
                      `Move the excess into 0x (no pay) bucket.`
                  );
                }

                // ✅ Sticker rule only applies to sold 1.25/1.5
                const stickersNeeded =
                  stickerRuleOn ? clamp0(buckets["1.25"]) + clamp0(buckets["1.5"]) : 0;

                const currentStickers = Number(team?.inventory?.sticker ?? 0);
                if (stickersNeeded > 0 && currentStickers < stickersNeeded) {
                  throw new Error(`Not enough stickers. Need ${stickersNeeded}, but team has ${currentStickers}.`);
                }

                // ✅ Money only for SOLD buckets
                const total = Math.round(unitPrice * weightedUnits);

                // ✅ Update remaining demand (never negative)
                const nextRemaining = Math.max(0, remainingDemand - sold);
                tx.update(gameRef, {
                  [`currentRound.remainingDemand.${shape}`]: nextRemaining,
                });

                // ✅ Always count ACCEPTED as deliveredThisRound (prevents fines)
                const cash = Number(team.cash ?? 0);
                const deliveredMap = team.deliveredThisRound ?? {};
                const prevDelivered = Number(deliveredMap[shape] ?? 0);

                tx.update(teamRef, {
                  cash: cash + total, // total=0 if sold buckets are 0
                  [`deliveredThisRound.${shape}`]: prevDelivered + accepted,
                  "inventory.sticker": currentStickers - stickersNeeded,
                });

                // ✅ Record what happened (sold vs unpaid)
                const saleRef = doc(collection(db, "games", gameId, "sales"));
                const displayQty = accepted;     // show in Recent Activity
const econQty = sold;            // only sold should count for price updates
const displayUnitPrice = sold > 0 ? unitPrice : 0; // show @0 when no-pay delivery

               tx.set(saleRef, {
  teamId,
  roundNumber,
  item: shape,
  shape,

  // ✅ UI display fields (what your activity likely reads)
  qty: displayQty,
  price: displayUnitPrice,
  unitPrice: displayUnitPrice,

  // ✅ Economy fields (what your pricing logic should read)
  qtySold: econQty,
  qtyUnpaid: unpaid,
  marketUnitPrice: unitPrice, // keep original market price if you want it later

  deliveredQty: delivered,
  acceptedQty: accepted,

  buckets: {
    "0": clamp0(buckets["0"]),
    "0.5": clamp0(buckets["0.5"]),
    "0.75": clamp0(buckets["0.75"]),
    "1": clamp0(buckets["1"]),
    "1.25": clamp0(buckets["1.25"]),
    "1.5": clamp0(buckets["1.5"]),
  },

  weightedUnits,
  total,

  stickerRuleOn: Boolean(stickerRuleOn),
  stickersUsed: stickersNeeded,

  note: note || "",
  createdAt: serverTimestamp(),
});

                const logRef = doc(collection(db, "games", gameId, "logs"));
                tx.set(logRef, {
                  type: unpaid > 0 && sold === 0 ? "DELIVERED_NO_SALE" : unpaid > 0 ? "SALE_PLUS_UNPAID" : "SALE",
                  roundNumber,
                  createdAt: serverTimestamp(),
                  message:
                    `R${roundNumber}: Team ${teamId} processed ${accepted} ${shape} | sold=${sold} (cash ${total}) | unpaid=${unpaid}` +
                    (stickersNeeded > 0 ? ` | stickers used: ${stickersNeeded}` : ""),
                });
              });

              setMsg("Processed ✅");
              setDeliveredQty(0);
              setBuckets({ "0": 0, "0.5": 0, "0.75": 0, "1": 0, "1.25": 0, "1.5": 0 });
              setNote("");
            } catch (e: any) {
              setErr(e?.message ?? String(e));
            } finally {
              setSaving(false);
            }
          }}
        >
          {saving ? "Saving..." : "Process"}
        </button>
      </div>

      {msg && <div style={{ marginTop: 8, color: "lightgreen" }}>{msg}</div>}
      {err && <div style={{ marginTop: 8, color: "crimson", whiteSpace: "pre-line" }}>{err}</div>}

      <small style={{ opacity: 0.8 }}>
        Rule: Only SOLD qty (0.5x–1.5x) uses demand + pays money. Put extra delivered units into 0x bucket (no pay) so teams
        aren’t fined.
      </small>
    </div>
  );
}
