import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

export default function LoginPage() {
  const { user, login, loading } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!loading && user) return <Navigate to="/" replace />;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await login(username, password);
    } catch {
      setErr("فشل تسجيل الدخول. تحقق من البيانات.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center px-4">
      <div className="pointer-events-none fixed inset-0 -z-10 keffiyeh-bg" aria-hidden />
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900/95 p-8 shadow-xl shadow-sky-900/20 backdrop-blur-sm">
        <h1 className="text-center text-2xl font-bold text-white">تسجيل الدخول</h1>
        <form className="mt-8 space-y-4" onSubmit={onSubmit}>
          <div>
            <label className="block text-sm text-slate-300">اسم المستخدم</label>
            <input
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white outline-none ring-sky-500 focus:ring-2"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              dir="ltr"
            />
          </div>
          <div>
            <label className="block text-sm text-slate-300">كلمة المرور</label>
            <input
              type="password"
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white outline-none ring-sky-500 focus:ring-2"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              dir="ltr"
            />
          </div>
          {err && <p className="text-sm text-rose-400">{err}</p>}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-sky-600 py-2.5 font-semibold text-white hover:bg-sky-500 disabled:opacity-60"
          >
            {busy ? "جاري الدخول…" : "دخول"}
          </button>
        </form>
      </div>
    </div>
  );
}
