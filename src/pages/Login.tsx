import { useState } from "react";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "../lib/firebase";
import { useNavigate } from "react-router-dom";

export default function Login() {
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);

    const e2 = email.trim();
    if (!e2) return setErr("Please enter email");
    if (!password) return setErr("Please enter password");

    try {
      setSaving(true);
      await signInWithEmailAndPassword(auth, e2, password);
      nav("/", { replace: true });
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900/40 p-6 shadow-sm">
        <h2 className="text-xl font-bold mb-4">Trading Game Login</h2>

        {err && (
          <div className="mb-3 rounded-xl border border-red-800 bg-red-950/40 p-3 text-red-200">
            {err}
          </div>
        )}

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-slate-300 mb-1">Email</label>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              name="email"
              autoComplete="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              inputMode="email"
              className="w-full rounded-lg bg-slate-950/60 border border-slate-700 px-3 py-3 outline-none focus:border-slate-500"
              style={{ fontSize: 16 }} // ✅ important for iPhone
              placeholder="team@game.local"
            />
          </div>

          <div>
            <label className="block text-sm text-slate-300 mb-1">Password</label>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              name="password"
              autoComplete="current-password"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="w-full rounded-lg bg-slate-950/60 border border-slate-700 px-3 py-3 outline-none focus:border-slate-500"
              style={{ fontSize: 16 }} // ✅ important for iPhone
              placeholder="••••••••"
            />
          </div>

          <button
            disabled={saving}
            className="w-full rounded-lg bg-slate-800 px-3 py-3 text-sm font-medium hover:bg-slate-700 disabled:opacity-60"
            type="submit"
          >
            {saving ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
