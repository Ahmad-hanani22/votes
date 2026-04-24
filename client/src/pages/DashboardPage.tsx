import { useCallback, useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
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

  const familyChartData = stats.byFamily.map((f, i) => ({
    slot: i + 1,
    name: f.family,
    value: f.voted,
  }));
  const batchChartData =
    activeBatchId === null && stats.byBatch
      ? stats.byBatch.slice(0, 8).map((b, i) => ({
          slot: i + 1,
          name: b.title,
          voted: b.voted,
        }))
      : [];
  const familyColors = ["#22c55e", "#06b6d4", "#6366f1", "#f59e0b", "#ec4899", "#64748b"];
  const schoolColors = ["#38bdf8", "#22c55e", "#a78bfa", "#f59e0b", "#ec4899", "#14b8a6", "#64748b", "#60a5fa"];
  const schoolMaxY = getDynamicAxisMax(batchChartData.map((x) => x.voted));
  const familyMaxY = getDynamicAxisMax(familyChartData.map((x) => x.value));

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
            <table className="min-w-full table-fixed text-right text-sm">
              <colgroup>
                <col className="w-[48%] sm:w-[52%]" />
                <col className="w-[10%]" />
                <col className="w-[10%]" />
                <col className="w-[10%]" />
                <col className="w-[8%]" />
                <col className="w-[14%] sm:w-[10%]" />
              </colgroup>
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
                    <td className="px-3 py-2 font-medium leading-6 text-white whitespace-normal break-words">{b.title}</td>
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
          <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950/40 p-3">
            <h3 className="mb-2 text-sm font-semibold text-slate-300">الرسم البياني للمدارس (عدد من انتخبوا)</h3>
            <div className="h-72 w-full" dir="ltr">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={batchChartData} margin={{ top: 8, right: 10, left: 0, bottom: 18 }}>
                  <XAxis dataKey="slot" tick={{ fill: "#cbd5e1", fontSize: 11 }} />
                  <YAxis
                    tick={{ fill: "#94a3b8", fontSize: 11 }}
                    allowDecimals={false}
                    domain={[0, schoolMaxY]}
                    tickFormatter={(v) => Number(v).toLocaleString("en-US")}
                  />
                  <Tooltip
                    formatter={(value) => [Number(value).toLocaleString("en-US"), "عدد من انتخبوا"]}
                    labelFormatter={(_, payload) => {
                      const row = payload?.[0]?.payload as { name?: string } | undefined;
                      return row?.name ?? "";
                    }}
                    contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8 }}
                    labelStyle={{ color: "#ffffff" }}
                    itemStyle={{ color: "#86efac" }}
                  />
                  <Bar dataKey="voted" radius={[6, 6, 0, 0]}>
                    {batchChartData.map((entry, i) => (
                      <Cell key={`school-cell-${entry.slot}-${i}`} fill={schoolColors[i % schoolColors.length]} />
                    ))}
                    <LabelList
                      dataKey="voted"
                      position="top"
                      formatter={(v: number) => Number(v).toLocaleString("en-US")}
                      style={{ fill: "#86efac", fontSize: 11, fontWeight: 700 }}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-1 text-xs text-slate-300">
              {batchChartData.map((entry, i) => (
                <div key={`school-legend-${entry.slot}-${i}`} className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: schoolColors[i % schoolColors.length] }} />
                    <span className="text-slate-400">#{entry.slot}</span>
                    <span className="break-words">{entry.name}</span>
                  </div>
                  <span className="font-semibold text-emerald-300">{entry.voted.toLocaleString("en-US")}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
        <h2 className="mb-3 text-lg font-semibold text-white">إحصائيات العائلات (من انتخبوا)</h2>
        {stats.byFamily.length === 0 ? (
          <p className="text-slate-500">لا توجد بيانات عائلات في هذا النطاق.</p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="overflow-x-auto rounded-lg border border-slate-800">
              <table className="min-w-full table-fixed text-right text-sm">
                <colgroup>
                  <col className="w-[50%]" />
                  <col className="w-[25%]" />
                  <col className="w-[25%]" />
                </colgroup>
                <thead className="bg-slate-900 text-slate-400">
                  <tr>
                    <th className="px-3 py-2">العائلة</th>
                    <th className="px-3 py-2">عدد من انتخبوا</th>
                    <th className="px-3 py-2">النسبة من المصوّتين</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.byFamily.map((f) => (
                    <tr key={f.family} className="border-t border-slate-800/80">
                      <td className="px-3 py-2 font-medium text-white">{f.family}</td>
                      <td className="px-3 py-2 font-semibold text-emerald-300">{f.voted}</td>
                      <td className="px-3 py-2" dir="ltr">
                        {f.percent}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
              <h3 className="mb-2 text-sm font-semibold text-slate-300">الرسم البياني للعائلات (عدد من انتخبوا)</h3>
              <div className="h-72 w-full" dir="ltr">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={familyChartData} margin={{ top: 8, right: 10, left: 0, bottom: 18 }}>
                    <XAxis dataKey="slot" tick={{ fill: "#cbd5e1", fontSize: 11 }} />
                    <YAxis
                      type="number"
                      tick={{ fill: "#94a3b8", fontSize: 11 }}
                      allowDecimals={false}
                      domain={[0, familyMaxY]}
                      tickFormatter={(v) => Number(v).toLocaleString("en-US")}
                    />
                    <Tooltip
                      formatter={(value) => [Number(value).toLocaleString("en-US"), "عدد من انتخبوا"]}
                      labelFormatter={(_, payload) => {
                        const row = payload?.[0]?.payload as { name?: string } | undefined;
                        return row?.name ?? "";
                      }}
                      contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8 }}
                      labelStyle={{ color: "#ffffff" }}
                      itemStyle={{ color: "#86efac" }}
                      cursor={{ fill: "rgba(148, 163, 184, 0.16)" }}
                    />
                    <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                      {familyChartData.map((entry, i) => (
                        <Cell key={`family-cell-${entry.slot}-${i}`} fill={familyColors[i % familyColors.length]} />
                      ))}
                      <LabelList
                        dataKey="value"
                        position="top"
                        formatter={(v: number) => Number(v).toLocaleString("en-US")}
                        style={{ fill: "#86efac", fontSize: 12, fontWeight: 700 }}
                      />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-3 grid grid-cols-1 gap-1 text-xs text-slate-300">
                {familyChartData.map((entry, i) => (
                  <div key={`family-legend-${entry.slot}-${i}`} className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: familyColors[i % familyColors.length] }} />
                      <span className="text-slate-400">#{entry.slot}</span>
                      <span className="break-words">{entry.name}</span>
                    </div>
                    <span className="font-semibold text-emerald-300">{entry.value.toLocaleString("en-US")}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function getDynamicAxisMax(values: number[]): number {
  const maxVal = values.length ? Math.max(...values) : 0;
  if (maxVal <= 0) return 5;
  const padded = maxVal * 1.2;
  const base = padded <= 10 ? 1 : padded <= 100 ? 5 : padded <= 1000 ? 25 : 100;
  return Math.ceil(padded / base) * base;
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
