import { useCallback, useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import api from "../api/client";
import { useBatchScope } from "../scope/BatchScopeContext";
import { useBatchIdFromUrl } from "../scope/useBatchIdFromUrl";
import type { DashboardStats } from "../types";

export default function DashboardPage() {
  const { activeBatchId, activeLabel, setActiveBatchId } = useBatchScope();
  useBatchIdFromUrl();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const loadStats = useCallback(async () => {
    try {
      const { data } = await api.get<DashboardStats>("/dashboard/stats", {
        params: { batchId: activeBatchId ?? undefined },
      });
      setStats(data);
      setErr(null);
    } catch {
      setErr("تعذر تحميل الإحصائيات");
    }
  }, [activeBatchId]);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!alive) return;
      await loadStats();
    })();
    const pollMs = activeBatchId != null ? 4000 : 6000;
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadStats();
    }, pollMs);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [loadStats]);

  if (err && !stats) return <p className="text-rose-400">{err}</p>;
  if (!stats) return <p className="text-slate-400">جاري تحميل لوحة التحكم…</p>;

  const chartData = stats.byArea.slice(0, 12).map((a) => ({
    name: a.area.length > 14 ? `${a.area.slice(0, 14)}…` : a.area,
    انتخب: a.voted,
    متبقي: a.pending,
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">لوحة التحكم</h1>
          {activeBatchId != null && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-300">
              <span className="font-medium text-emerald-200">{stats.batchTitle ?? activeLabel}</span>
              <span className="text-slate-600">·</span>
              <span>
                {stats.total} / {stats.voted} / {stats.pending}
              </span>
              <NavLink
                to={activeBatchId != null ? `/voters?batch=${activeBatchId}` : "/voters"}
                className="rounded-md bg-emerald-700 px-2 py-0.5 text-xs text-white hover:bg-emerald-600"
              >
                الناخبون
              </NavLink>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => void loadStats()}
          className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800"
        >
          تحديث الآن
        </button>
      </div>

      {err && stats && <p className="text-sm text-amber-400">{err}</p>}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="إجمالي الناخبين" value={stats.total} accent="border-sky-500/40" />
        <StatCard title="من انتخبوا" value={stats.voted} accent="border-emerald-500/40" />
        <StatCard title="المتبقي" value={stats.pending} accent="border-amber-500/40" />
        <StatCard title="نسبة الإقبال" value={`${stats.percentVoted}%`} accent="border-violet-500/40" />
      </div>

      {activeBatchId === null && stats.byBatch && stats.byBatch.length > 0 && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
          <h2 className="mb-3 text-lg font-semibold text-white">المدارس</h2>
          <div className="overflow-x-auto rounded-lg border border-slate-800">
            <table className="min-w-full text-right text-sm">
              <thead className="bg-slate-900 text-slate-400">
                <tr>
                  <th className="px-3 py-2">الدفعة</th>
                  <th className="px-3 py-2">الإجمالي</th>
                  <th className="px-3 py-2">انتخبوا</th>
                  <th className="px-3 py-2">متبقي</th>
                  <th className="px-3 py-2">%</th>
                  <th className="px-3 py-2">عرض</th>
                </tr>
              </thead>
              <tbody>
                {stats.byBatch.map((b) => (
                  <tr key={b.batchId} className="border-t border-slate-800/80">
                    <td className="px-3 py-2 font-medium text-white">{b.title}</td>
                    <td className="px-3 py-2">{b.total}</td>
                    <td className="px-3 py-2 text-emerald-300">{b.voted}</td>
                    <td className="px-3 py-2 text-slate-300">{b.pending}</td>
                    <td className="px-3 py-2" dir="ltr">
                      {b.percent}%
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        className="text-sky-400 hover:underline"
                        onClick={() => setActiveBatchId(b.batchId)}
                      >
                        عرض
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
        <h2 className="mb-4 text-lg font-semibold text-white">
          {activeBatchId != null ? "التوزيع حسب المركز" : "التوزيع حسب مركز التسجيل والاقتراع"}
        </h2>
        {chartData.length === 0 ? (
          <p className="text-slate-500">لا توجد بيانات مراكز في هذا النطاق.</p>
        ) : (
          <div className="h-72 w-full" dir="ltr">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8 }}
                  labelStyle={{ color: "#e2e8f0" }}
                />
                <Bar dataKey="انتخب" stackId="a" fill="#22c55e" radius={[4, 4, 0, 0]} />
                <Bar dataKey="متبقي" stackId="a" fill="#334155" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({
  title,
  value,
  accent,
}: {
  title: string;
  value: string | number;
  accent: string;
}) {
  return (
    <div className={`rounded-2xl border bg-slate-900/60 p-4 ${accent}`}>
      <p className="text-sm text-slate-400">{title}</p>
      <p className="mt-2 text-3xl font-bold text-white">{value}</p>
    </div>
  );
}
