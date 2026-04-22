import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { useBatchScope } from "../scope/BatchScopeContext";

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-lg px-3 py-2 text-sm font-medium transition ${
    isActive ? "bg-sky-600 text-white" : "text-slate-300 hover:bg-slate-800 hover:text-white"
  }`;

export default function Layout() {
  const { user, logout } = useAuth();
  const isAdmin = user?.role === "admin";
  const { batches, activeBatchId, setActiveBatchId } = useBatchScope();
  const usernameInitial = user?.username?.trim().charAt(0).toUpperCase() ?? "ص";

  return (
    <div className="relative min-h-screen">
      <div className="keffiyeh-bg" aria-hidden />
      <div className="relative z-0 flex min-h-screen flex-col">
        <header className="border-b border-slate-800 bg-slate-900/95 shadow-sm backdrop-blur">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-600 font-bold text-white">
                {usernameInitial}
              </div>
              <div>
                <p className="text-sm font-semibold text-white">نظام إدارة الاقتراع</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-slate-800 px-3 py-1 text-xs text-slate-300">
                {user?.username} · {user?.role === "admin" ? "مدير" : "موظف"}
              </span>
              <button
                type="button"
                onClick={logout}
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800"
              >
                خروج
              </button>
            </div>
          </div>
          <nav className="mx-auto flex max-w-6xl flex-wrap gap-1 px-4 pb-2">
            <NavLink to="/" end className={linkClass}>
              لوحة التحكم
            </NavLink>
            <NavLink to="/voters" className={linkClass}>
              الناخبون
            </NavLink>
            {isAdmin && (
              <>
                <NavLink to="/logs" className={linkClass}>
                  سجل العمليات
                </NavLink>
                <NavLink to="/users" className={linkClass}>
                  المستخدمون
                </NavLink>
              </>
            )}
          </nav>
          <div className="mx-auto max-w-6xl border-t border-slate-800/80 px-4 py-2">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setActiveBatchId(null)}
                className={`rounded-full px-3 py-1 text-xs font-medium ${
                  activeBatchId === null
                    ? "bg-sky-600 text-white"
                    : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                }`}
              >
                الكل
              </button>
              {batches.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => setActiveBatchId(b.id)}
                  className={`max-w-full rounded-full px-3 py-1.5 text-left text-xs font-medium leading-5 sm:max-w-[min(100%,32rem)] sm:text-right ${
                    activeBatchId === b.id
                      ? "bg-emerald-600 text-white"
                      : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                  } whitespace-normal break-words`}
                  title={b.title}
                >
                  {b.title} ({b.voter_count})
                </button>
              ))}
            </div>
            {activeBatchId != null && (
              <div className="mt-2 flex flex-wrap gap-2">
                <NavLink
                  to={`/?batch=${activeBatchId}`}
                  className={({ isActive }) =>
                    `rounded-lg px-2.5 py-1 text-xs font-medium ${
                      isActive ? "bg-emerald-600 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                    }`
                  }
                  end
                >
                  لوحة المدرسة
                </NavLink>
                <NavLink
                  to={`/voters?batch=${activeBatchId}`}
                  className={({ isActive }) =>
                    `rounded-lg px-2.5 py-1 text-xs font-medium ${
                      isActive ? "bg-emerald-600 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                    }`
                  }
                >
                  الناخبون
                </NavLink>
              </div>
            )}
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
          <div className="rounded-2xl border border-slate-800/90 bg-slate-950/95 p-4 shadow-xl backdrop-blur-sm sm:p-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
