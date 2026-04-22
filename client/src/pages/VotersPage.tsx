import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import api from "../api/client";
import { useBatchScope } from "../scope/BatchScopeContext";
import { useBatchIdFromUrl } from "../scope/useBatchIdFromUrl";
import type { Voter } from "../types";

type ListStatusFilter = "all" | "pending" | "voted";

export default function VotersPage() {
  const { activeBatchId, activeLabel } = useBatchScope();
  useBatchIdFromUrl();
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<ListStatusFilter>("all");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [rows, setRows] = useState<Voter[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const listAbortRef = useRef<AbortController | null>(null);
  const loadGenerationRef = useRef(0);
  const qRef = useRef(q);
  const pageRef = useRef(page);
  /** يمنع طلبًا مزدوجًا عند الكتابة مع إعادة الصفحة إلى 1 */
  const skipNextScopeEffectFetch = useRef(false);
  qRef.current = q;
  pageRef.current = page;
  const pageSize = 25;

  /** جلب القائمة: مرّر `queryText` / `pageNum` من onChange حتى ما نستنى دورة React */
  const fetchList = useCallback(
    async (opts?: { silent?: boolean; soft?: boolean; queryText?: string; pageNum?: number }) => {
      const silent = opts?.silent === true;
      const soft = opts?.soft === true;
      const qParam = (opts?.queryText !== undefined ? opts.queryText : qRef.current).trim();
      const pageParam = opts?.pageNum ?? pageRef.current;
      loadGenerationRef.current += 1;
      const loadId = loadGenerationRef.current;
      if (!silent) {
        setLoading(soft ? false : true);
        if (!soft) setMsg(null);
      }
      const ac = new AbortController();
      if (!silent) {
        if (listAbortRef.current) listAbortRef.current.abort();
        listAbortRef.current = ac;
      }
      try {
        const { data } = await api.get<{ voters: Voter[]; total: number }>("/voters", {
          params: {
            page: pageParam,
            pageSize,
            q: qParam || undefined,
            batchId: activeBatchId ?? undefined,
            status: statusFilter === "all" ? undefined : statusFilter,
          },
          signal: ac.signal,
        });
        if (loadId !== loadGenerationRef.current) return;
        setRows(data.voters);
        setTotal(data.total);
      } catch (e: unknown) {
        if (axios.isCancel(e)) {
          // ignore
        } else {
          if (!silent) setMsg("تعذر تحميل القائمة");
        }
      } finally {
        if (!silent && loadId === loadGenerationRef.current) {
          setLoading(false);
        }
      }
    },
    [activeBatchId, statusFilter]
  );

  useEffect(() => {
    if (skipNextScopeEffectFetch.current) {
      skipNextScopeEffectFetch.current = false;
      return;
    }
    void fetchList({ soft: qRef.current.trim().length > 0 });
  }, [fetchList, page, statusFilter, activeBatchId]);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (qRef.current.trim() !== "") return;
      void fetchList({ silent: true });
    }, 20000);
    return () => window.clearInterval(id);
  }, [fetchList]);

  async function onExport() {
    const res = await api.get("/voters/export", {
      responseType: "blob",
      params: { batchId: activeBatchId ?? undefined },
    });
    const url = URL.createObjectURL(res.data);
    const a = document.createElement("a");
    a.href = url;
    a.download = activeBatchId ? `voters-batch-${activeBatchId}.xlsx` : "voters-export.xlsx";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function setVoterStatus(voterId: number, status: 0 | 1) {
    setBusyId(voterId);
    setMsg(null);
    try {
      await api.patch(`/voters/${voterId}/status`, { status });
      setRows((prev) =>
        prev.map((v) =>
          v.id === voterId
            ? {
                ...v,
                status,
                voted_at: status === 1 ? new Date().toISOString() : null,
              }
            : v
        )
      );
    } catch {
      setMsg("تعذر تحديث حالة الناخب");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">الناخبون</h1>
          {activeBatchId != null && (
            <p className="mt-1 text-sm text-emerald-300/90">{activeLabel}</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onExport}
            className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-100 hover:bg-slate-800"
          >
            تصدير Excel
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          placeholder="بحث ذكي بالاسم أو الرمز أو المركز أو رقم التسلسل…"
          className="min-w-[200px] flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white outline-none ring-sky-500 focus:ring-2"
          value={q}
          onChange={(e) => {
            const v = e.target.value;
            if (pageRef.current !== 1) skipNextScopeEffectFetch.current = true;
            setPage(1);
            pageRef.current = 1;
            setQ(v);
            void fetchList({ soft: true, queryText: v, pageNum: 1 });
          }}
        />
        <span className="text-xs text-slate-500">الحالة:</span>
        {(
          [
            { key: "all" as const, label: "الكل" },
            { key: "pending" as const, label: "لم ينتخب" },
            { key: "voted" as const, label: "انتخبوا" },
          ] as const
        ).map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => {
              setPage(1);
              setStatusFilter(key);
            }}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              statusFilter === key ? "bg-sky-600 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {msg && <p className="text-sm text-sky-300">{msg}</p>}
      {loading && rows.length === 0 ? <p className="text-slate-400">جاري التحميل…</p> : null}

      {!(loading && rows.length === 0) && (
        <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/98">
          <table className="min-w-full text-right text-sm">
            <thead className="bg-slate-900 text-slate-400">
              <tr>
                <th className="px-3 py-2"># (من الملف)</th>
                <th className="px-3 py-2">الاسم</th>
                <th className="px-3 py-2">رمز الناخب</th>
                <th className="px-3 py-2">مركز التسجيل والاقتراع</th>
                <th className="px-3 py-2">الحالة</th>
                <th className="px-3 py-2">وقت الانتخاب</th>
                <th className="px-3 py-2">إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((v) => (
                <tr
                  key={v.id}
                  className={`border-t border-slate-800/80 ${v.status === 1 ? "bg-emerald-950/20" : "bg-slate-950/80"}`}
                >
                  <td className="px-3 py-2 font-mono text-slate-200" dir="ltr">
                    {v.list_number != null ? v.list_number : "—"}
                  </td>
                  <td className={`px-3 py-2 font-medium ${v.status === 1 ? "text-emerald-300" : "text-white"}`}>{v.full_name}</td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-300" dir="ltr">
                    {v.national_id}
                  </td>
                  <td className="px-3 py-2 text-slate-300 whitespace-normal break-words leading-6 min-w-[12rem] max-w-[28rem]">
                    {v.area ?? "—"}
                  </td>
                  <td className="px-3 py-2">
                    {v.status === 1 ? (
                      <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-emerald-300">تم</span>
                    ) : (
                      <span className="rounded-full bg-slate-700 px-2 py-0.5 text-slate-300">لم ينتخب</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-400" dir="ltr">
                    {v.voted_at ? new Date(v.voted_at).toLocaleString("ar-EG") : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <StatusActions voter={v} busy={busyId === v.id} onChange={setVoterStatus} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center justify-between text-sm text-slate-400">
        <span>
          عرض {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} من {total}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={page <= 1}
            className="rounded border border-slate-700 px-2 py-1 disabled:opacity-40"
            onClick={() => setPage((p) => p - 1)}
          >
            السابق
          </button>
          <button
            type="button"
            disabled={page * pageSize >= total}
            className="rounded border border-slate-700 px-2 py-1 disabled:opacity-40"
            onClick={() => setPage((p) => p + 1)}
          >
            التالي
          </button>
        </div>
      </div>

    </div>
  );
}

function StatusActions({
  voter,
  busy,
  onChange,
}: {
  voter: Voter;
  busy: boolean;
  onChange: (voterId: number, status: 0 | 1) => Promise<void>;
}) {
  return (
    <div className="flex gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={() => void onChange(voter.id, 1)}
        className={`rounded-md border px-2.5 py-1 text-xs font-semibold transition-all disabled:opacity-40 ${
          voter.status === 1
            ? "border-emerald-400 bg-emerald-500 text-white shadow-[0_0_0_1px_rgba(52,211,153,.5)]"
            : "border-emerald-700/70 bg-emerald-900/30 text-emerald-300 hover:bg-emerald-700/60 hover:text-white"
        }`}
      >
        انتخب
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => void onChange(voter.id, 0)}
        className={`rounded-md border px-2.5 py-1 text-xs font-semibold transition-all disabled:opacity-40 ${
          voter.status === 0
            ? "border-rose-400 bg-rose-500 text-white shadow-[0_0_0_1px_rgba(251,113,133,.55)]"
            : "border-rose-800/70 bg-rose-950/40 text-rose-300 hover:bg-rose-700/60 hover:text-white"
        }`}
      >
        لم ينتخب
      </button>
    </div>
  );
}
