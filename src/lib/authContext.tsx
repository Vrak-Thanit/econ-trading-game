import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import type { User } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "./firebase";

export type UserRole = "teacher" | "team";

export type UserProfile =
  | { role: "teacher"; displayName?: string }
  | { role: "team"; teamId: string; displayName?: string };

type AuthState = {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
};

const AuthCtx = createContext<AuthState>({ user: null, profile: null, loading: true });

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      setProfile(null);
      if (!u) {
        setLoading(false);
        return;
      }

      try {
        const snap = await getDoc(doc(db, "users", u.uid));
        if (!snap.exists()) {
          // profile missing => rules might block later; show clearly
          setProfile(null);
        } else {
          setProfile(snap.data() as UserProfile);
        }
      } finally {
        setLoading(false);
      }
    });

    return () => unsub();
  }, []);

  const value = useMemo(() => ({ user, profile, loading }), [user, profile, loading]);

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth() {
  return useContext(AuthCtx);
}
