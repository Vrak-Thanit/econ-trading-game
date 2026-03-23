import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "./firebase";

type OrderDoc = {
  teamId: string;
  roundNumber: number;
  shape: string;
  plannedQty: number;
  createdAt?: any;
};

export async function getLatestOrdersForRound(gameId: string, roundNumber: number) {
  const ref = collection(db, "games", gameId, "orders");
  const q = query(ref, where("roundNumber", "==", roundNumber));
  const snap = await getDocs(q);

  // latest by teamId+shape
  const latest = new Map<string, OrderDoc>();

  snap.forEach((d) => {
    const o = d.data() as OrderDoc;
    const key = `${o.teamId}__${o.shape}`;
    const prev = latest.get(key);

    // Compare by createdAt if present; otherwise keep last seen
    const prevTime = prev?.createdAt?.toMillis?.() ?? 0;
    const curTime = o?.createdAt?.toMillis?.() ?? 0;

    if (!prev || curTime >= prevTime) {
      latest.set(key, o);
    }
  });

  return Array.from(latest.values());
}
