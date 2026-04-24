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

  const familyChartData = stats.byFamily.map((f) => ({
    name: f.family,
    shortName: f.family.length > 12 ? `${f.family.slice(0, 12)}…` : f.family,
    fullName: f.family,
    value: f.voted,
  }));
  const batchChartData =
    activeBatchId === null && stats.byBatch
      ? stats.byBatch.slice(0, 8).map((b) => ({
          name: b.title,
          shortName: b.title.length > 20 ? `${b.title.slice(0, 20)}…` : b.title,
          fullName: b.title,
          voted: b.voted,
        }))
      : [];
  const familyColors = ["#22c55e", "#06b6d4", "#6366f1", "#f59e0b", "#ec4899", "#64748b"];
  const schoolColors = ["#38bdf8", "#22c55e", "#a78bfa", "#f59e0b", "#ec4899", "#14b8a6", "#64748b", "#60a5fa"];

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
            <div className="hidden h-72 w-full sm:block" dir="ltr">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={batchChartData} margin={{ top: 8, right: 8, left: 0, bottom: 42 }}>
                  <XAxis
                    dataKey="name"
                    interval={0}
                    height={74}
                    tick={(props) => <WrappedAxisTick {...props} />}
                  />
                  <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} allowDecimals={false} />
                  <Tooltip
                    formatter={(value) => [value, "عدد من انتخبوا"]}
                    labelFormatter={(_, payload) => payload?.[0]?.payload?.fullName ?? ""}
                    contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8 }}
                    labelStyle={{ color: "#ffffff" }}
                    itemStyle={{ color: "#86efac" }}
                  />
                  <Bar dataKey="voted" radius={[6, 6, 0, 0]}>
                    {batchChartData.map((entry, i) => (
                      <Cell key={`school-cell-${entry.name}-${i}`} fill={schoolColors[i % schoolColors.length]} />
                    ))}
                    <LabelList dataKey="voted" position="top" style={{ fill: "#86efac", fontSize: 11, fontWeight: 700 }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="h-[300px] w-full sm:hidden" dir="ltr">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={batchChartData} layout="vertical" margin={{ top: 8, right: 10, left: 10, bottom: 6 }}>
                  <XAxis type="number" tick={{ fill: "#94a3b8", fontSize: 11 }} allowDecimals={false} />
                  <YAxis
                    type="category"
                    dataKey="shortName"
                    width={128}
                    interval={0}
                    tick={{ fill: "#cbd5e1", fontSize: 11 }}
                  />
                  <Tooltip
                    formatter={(value) => [value, "عدد من انتخبوا"]}
                    labelFormatter={(_, payload) => payload?.[0]?.payload?.fullName ?? ""}
                    contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8 }}
                    labelStyle={{ color: "#ffffff" }}
                    itemStyle={{ color: "#86efac" }}
                  />
                  <Bar dataKey="voted" radius={[0, 6, 6, 0]}>
                    {batchChartData.map((entry, i) => (
                      <Cell key={`school-mobile-cell-${entry.shortName}-${i}`} fill={schoolColors[i % schoolColors.length]} />
                    ))}
                    <LabelList dataKey="voted" position="right" style={{ fill: "#86efac", fontSize: 11, fontWeight: 700 }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
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
              <div className="hidden h-72 w-full sm:block" dir="ltr">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={familyChartData} margin={{ top: 8, right: 8, left: 0, bottom: 20 }}>
                    <XAxis dataKey="name" tick={{ fill: "#cbd5e1", fontSize: 12 }} interval={0} />
                    <YAxis type="number" tick={{ fill: "#94a3b8", fontSize: 11 }} allowDecimals={false} />
                    <Tooltip
                      formatter={(value) => [`${value}`, "عدد من انتخبوا"]}
                      labelFormatter={(_, payload) => payload?.[0]?.payload?.fullName ?? ""}
                      contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8 }}
                      labelStyle={{ color: "#ffffff" }}
                      itemStyle={{ color: "#86efac" }}
                      cursor={{ fill: "rgba(148, 163, 184, 0.16)" }}
                    />
                    <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                      {familyChartData.map((entry, i) => (
                        <Cell key={`family-cell-${entry.name}-${i}`} fill={familyColors[i % familyColors.length]} />
                      ))}
                      <LabelList dataKey="value" position="top" style={{ fill: "#86efac", fontSize: 12, fontWeight: 700 }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="h-[320px] w-full sm:hidden" dir="ltr">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={familyChartData} layout="vertical" margin={{ top: 8, right: 10, left: 10, bottom: 6 }}>
                    <XAxis type="number" tick={{ fill: "#94a3b8", fontSize: 11 }} allowDecimals={false} />
                    <YAxis
                      type="category"
                      dataKey="shortName"
                      width={95}
                      interval={0}
                      tick={{ fill: "#cbd5e1", fontSize: 11 }}
                    />
                    <Tooltip
                      formatter={(value) => [`${value}`, "عدد من انتخبوا"]}
                      labelFormatter={(_, payload) => payload?.[0]?.payload?.fullName ?? ""}
                      contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8 }}
                      labelStyle={{ color: "#ffffff" }}
                      itemStyle={{ color: "#86efac" }}
                    />
                    <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                      {familyChartData.map((entry, i) => (
                        <Cell key={`family-mobile-cell-${entry.shortName}-${i}`} fill={familyColors[i % familyColors.length]} />
                      ))}
                      <LabelList dataKey="value" position="right" style={{ fill: "#86efac", fontSize: 11, fontWeight: 700 }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function WrappedAxisTick(props: { x?: number; y?: number; payload?: { value?: string | number } }) {
  const x = props.x ?? 0;
  const y = props.y ?? 0;
  const raw = String(props.payload?.value ?? "").trim();
  const words = raw.split(/\s+/).filter(Boolean);
  const lines: string[] = [];

  for (let i = 0; i < words.length; i += 2) {
    lines.push(words.slice(i, i + 2).join(" "));
  }

  const maxLines = 3;
  const shown = lines.slice(0, maxLines);
  if (lines.length > maxLines && shown.length > 0) shown[shown.length - 1] = `${shown[shown.length - 1]}…`;

  return (
    <g transform={`translate(${x},${y})`}>
      <text textAnchor="middle" fill="#cbd5e1" fontSize={11}>
        {shown.map((line, idx) => (
          <tspan key={`${line}-${idx}`} x={0} dy={idx === 0 ? 14 : 13}>
            {line}
          </tspan>
        ))}
      </text>
    </g>
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
