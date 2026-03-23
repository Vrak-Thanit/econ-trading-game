import { useEffect, useState } from "react";
import { collection, doc, onSnapshot, query, updateDoc } from "firebase/firestore";
import { db } from "../lib/firebase";

type TeamDoc = {
  cash?: number;
  inventory?: Record<string, number>;
};

export default function TeacherConsumablesAdjust({ gameId }: { gameId: string }) {
  const [teamIds, setTeamIds] = useState<string[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [team, setTeam] = useState<TeamDoc | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  // list teams
  useEffect(() => {
    setErr(null);
    const ref = collection(db, "games", gameId, "teams");
    const q = query(ref);

    const unsub = onSnapshot(
      q,
      (snap) => {
        const ids: string[] = [];
        snap.forEach((d) => ids.push(d.id));
        ids.sort();
        setTeamIds(ids);
        if (!selected && ids.length > 0) setSelected(ids[0]);
      },
      (e) => setErr(e.message)
    );

    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId]);

  // subscribe selected team
  useEffect(() => {
    if (!selected) return;
    setErr(null);
    const ref = doc(db, "games", gameId, "teams", selected);

    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) {
          setTeam(null);
          setErr("Team not found.");
          return;
        }
        setTeam(snap.data() as TeamDoc);
      },
      (e) => setErr(e.message)
    );

    return () => unsub();
  }, [gameId, selected]);

  async function adjust(item: "paper" | "sticker", delta: number) {
    setErr(null);
    setMsg(null);
    try {
      const inv = team?.inventory ?? {};
      const current = Number(inv[item] ?? 0);
      const next = Math.max(0, current + delta);

      const ref = doc(db, "games", gameId, "teams", selected);
      await updateDoc(ref, {
        [`inventory.${item}`]: next,
      });

      setMsg(`Updated ${selected}: ${item} ${current} → ${next}`);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    }
  }

  const paper = Number(team?.inventory?.paper ?? 0);
  const sticker = Number(team?.inventory?.sticker ?? 0);

  return (
    <div style={{ border: "1px solid #444", borderRadius: 12, padding: 12, maxWidth: 900 }}>
      <h3 style={{ marginTop: 0 }}>Teacher: Adjust Consumables</h3>

      {err && <div style={{ color: "crimson", marginBottom: 8 }}>{err}</div>}
      {msg && <div style={{ color: "lightgreen", marginBottom: 8 }}>{msg}</div>}

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <div>
          <b>Team:</b>{" "}
          <select value={selected} onChange={(e) => setSelected(e.target.value)}>
            {teamIds.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </div>

        <div style={{ opacity: 0.85 }}>
          Paper: <b>{paper}</b> | Sticker: <b>{sticker}</b>
        </div>
      </div>

      <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
        <div style={{ border: "1px solid #333", borderRadius: 10, padding: 10 }}>
          <b>Paper</b>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
            <button onClick={() => adjust("paper", -1)}>-1</button>
            <button onClick={() => adjust("paper", -5)}>-5</button>
            <button onClick={() => adjust("paper", +1)}>+1</button>
            <button onClick={() => adjust("paper", +5)}>+5</button>
          </div>
        </div>

        <div style={{ border: "1px solid #333", borderRadius: 10, padding: 10 }}>
          <b>Sticker</b>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
            <button onClick={() => adjust("sticker", -1)}>-1</button>
            <button onClick={() => adjust("sticker", -5)}>-5</button>
            <button onClick={() => adjust("sticker", +1)}>+1</button>
            <button onClick={() => adjust("sticker", +5)}>+5</button>
          </div>
        </div>
      </div>

      <small style={{ opacity: 0.75 }}>
        Use this during rounds to reflect real paper/sticker consumption.
      </small>
    </div>
  );
}
