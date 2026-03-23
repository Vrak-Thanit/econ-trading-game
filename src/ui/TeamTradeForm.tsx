import { useEffect, useMemo, useState } from "react";
import { addDoc, collection, onSnapshot, orderBy, query, serverTimestamp } from "firebase/firestore";
import { db } from "../lib/firebase";
import { ASSETS, type AssetId, assetLabel } from "../lib/items";

type TeamRow = { id: string };

export default function TeamTradeForm({
  gameId,
  teamId,
  roundNumber,
}: {
  gameId: string;
  teamId: string;
  roundNumber: number;
}) {
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [toTeamId, setToTeamId] = useState<string>("");

  const [offerAsset, setOfferAsset] = useState<AssetId>("cash");
  const [offerQty, setOfferQty] = useState<number>(0);

  const [requestAsset, setRequestAsset] = useState<AssetId>("paper");
  const [requestQty, setRequestQty] = useState<number>(1);

  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    const ref = collection(db, "games", gameId, "teams");
    const q = query(ref, orderBy("incomeTier", "asc")); // harmless ordering; small list anyway

    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows: TeamRow[] = [];
        snap.forEach((d) => rows.push({ id: d.id }));
        const others = rows.filter((t) => t.id !== teamId);
        setTeams(others);
        if (!toTeamId && others.length > 0) setToTeamId(others[0].id);
      },
      (e) => setErr(e.message)
    );

    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId, teamId]);

  const canSend = useMemo(() => {
    if (!toTeamId) return false;
    if (toTeamId === teamId) return false;
    if (offerQty <= 0) return false;
    if (requestQty <= 0) return false;
    return true;
  }, [toTeamId, teamId, offerQty, requestQty]);

  return (
    <div style={{ border: "1px solid #444", borderRadius: 12, padding: 12, maxWidth: 900 }}>
      <h3 style={{ marginTop: 0 }}>Trade Request</h3>

      {err && <div style={{ color: "crimson", marginBottom: 8 }}>{err}</div>}
      {msg && <div style={{ color: "lightgreen", marginBottom: 8 }}>{msg}</div>}

      <div style={{ display: "grid", gap: 10 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <div>
            <b>To team:</b>{" "}
            <select value={toTeamId} onChange={(e) => setToTeamId(e.target.value)}>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.id}
                </option>
              ))}
            </select>
          </div>

          <div style={{ opacity: 0.8 }}>
            <b>Round:</b> {roundNumber}
          </div>
        </div>

        <div style={{ display: "grid", gap: 8, border: "1px solid #333", borderRadius: 10, padding: 10 }}>
          <div><b>You give</b></div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <select value={offerAsset} onChange={(e) => setOfferAsset(e.target.value as AssetId)}>
              {ASSETS.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>

            <input
              type="number"
              min={0}
              value={offerQty}
              onChange={(e) => setOfferQty(Math.max(0, Number(e.target.value || 0)))}
              style={{ width: 120, padding: 6, textAlign: "right" }}
            />
            <span style={{ opacity: 0.8 }}>{offerAsset === "cash" ? "$" : "qty"}</span>
          </div>
        </div>

        <div style={{ display: "grid", gap: 8, border: "1px solid #333", borderRadius: 10, padding: 10 }}>
          <div><b>You want</b></div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <select value={requestAsset} onChange={(e) => setRequestAsset(e.target.value as AssetId)}>
              {ASSETS.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>

            <input
              type="number"
              min={0}
              value={requestQty}
              onChange={(e) => setRequestQty(Math.max(0, Number(e.target.value || 0)))}
              style={{ width: 120, padding: 6, textAlign: "right" }}
            />
            <span style={{ opacity: 0.8 }}>{requestAsset === "cash" ? "$" : "qty"}</span>
          </div>
        </div>

        <button
          disabled={!canSend || sending}
          style={{ padding: "10px 14px" }}
          onClick={async () => {
            setErr(null);
            setMsg(null);
            setSending(true);
            try {
              const tradesRef = collection(db, "games", gameId, "trades");
              await addDoc(tradesRef, {
                status: "PENDING",
                roundNumber,
                fromTeamId: teamId,
                toTeamId,
                offerAsset,
                offerQty,
                requestAsset,
                requestQty,
                createdAt: serverTimestamp(),
              });

              setMsg(
                `Sent: give ${offerQty} ${assetLabel(offerAsset)} → want ${requestQty} ${assetLabel(requestAsset)} ✅`
              );
              setOfferQty(0);
            } catch (e: any) {
              setErr(e?.message ?? String(e));
            } finally {
              setSending(false);
            }
          }}
        >
          {sending ? "Sending..." : "Send Trade Request"}
        </button>

        <small style={{ opacity: 0.75 }}>
          Teacher will approve/decline to prevent cheating and keep it fair.
        </small>
      </div>
    </div>
  );
}
