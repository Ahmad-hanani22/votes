import { useCallback, useEffect, useState } from "react";
import api from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useBatchScope } from "../scope/BatchScopeContext";
import { useBatchIdFromUrl } from "../scope/useBatchIdFromUrl";
import type { Voter } from "../types";

type ListStatusFilter = "all" | "pending" | "voted";

export default function VotersPage() {
  const { user } = useAuth();
  const { activeBatchId, activeLabel } = useBatchScope();
  useBatchIdFromUrl();
  const isAdmin = user?.role === "admin";
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<ListStatusFilter>("all");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [rows, setRows] = useState<Voter[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const pageSize = 25;

  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      const silent = opts?.silent === true;
      if (!silent) {
        setLoading(true);
        setMsg(null);
      }
      try {
        const { data } = await api.get<{ voters: Voter[]; total: number }>("/voters", {
          params: {
            page,
            pageSize,
            q: q.trim() || undefined,
            batchId: activeBatchId ?? undefined,
            status: statusFilter === "all" ? undefined : statusFilter,
          },
        });
        setRows(data.voters);
        setTotal(data.total);
      } catch {
        if (!silent) setMsg("تعذر تحميل القائمة");
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [page, q, activeBatchId, statusFilter]
  );

  useEffect(() => {
    const t = setTimeout(() => void load(), q ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void load({ silent: true });
    }, 5000);
    return () => window.clearInterval(id);
  }, [load]);

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
          placeholder="بحث بالاسم أو رمز الناخب…"
          className="min-w-[200px] flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white outline-none ring-sky-500 focus:ring-2"
          value={q}
          onChange={(e) => {
            setPage(1);
            setQ(e.target.value);
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
      {loading ? (
        <p className="text-slate-400">جاري التحميل…</p>
      ) : (
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
                {isAdmin && <th className="px-3 py-2">إجراءات</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((v) => (
                <tr key={v.id} className="border-t border-slate-800/80 bg-slate-950/80">
                  <td className="px-3 py-2 font-mono text-slate-200" dir="ltr">
                    {v.list_number != null ? v.list_number : "—"}
                  </td>
                  <td className="px-3 py-2 font-medium text-white">{v.full_name}</td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-300" dir="ltr">
                    {v.national_id}
                  </td>
                  <td className="px-3 py-2 text-slate-300">{v.area ?? "—"}</td>
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
                  {isAdmin && (
                    <td className="px-3 py-2">
                      <RowActions voter={v} onChanged={load} />
                    </td>
                  )}
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

function RowActions({ voter, onChanged }: { voter: Voter; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  async function remove() {
    if (!confirm("حذف هذا الناخب؟")) return;
    await api.delete(`/voters/${voter.id}`);
    onChanged();
  }
  return (
    <div className="flex gap-2">
      <button type="button" className="text-sky-400 hover:underline" onClick={() => setOpen(true)}>
        تعديل
      </button>
      <button type="button" className="text-rose-400 hover:underline" onClick={remove}>
        حذف
      </button>
      {open && <EditModal voter={voter} onClose={() => setOpen(false)} onSaved={onChanged} />}
    </div>
  );
}

function EditModal({
  voter,
  defaultBatchId,
  onClose,
  onSaved,
}: {
  voter: Voter | null;
  defaultBatchId?: number | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { batches } = useBatchScope();
  const [full_name, setFullName] = useState(voter?.full_name ?? "");
  const [national_id, setNationalId] = useState(voter?.national_id ?? "");
  const [area, setArea] = useState(voter?.area ?? "");
  const [list_number, setListNumber] = useState(voter?.list_number != null ? String(voter.list_number) : "");
  const [batch_id, setBatchId] = useState<number | null>(
    voter?.batch_id ?? (defaultBatchId != null && defaultBatchId > 0 ? defaultBatchId : null)
  );
  const [status, setStatus] = useState<0 | 1>(voter?.status ?? 0);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const listPayload =
        list_number.trim() === "" || !Number.isFinite(Number(list_number))
          ? null
          : Math.trunc(Number(list_number));
      if (voter) {
        await api.patch(`/voters/${voter.id}`, {
          full_name,
          national_id,
          area,
          status,
          list_number: listPayload,
          batch_id,
        });
      } else {
        await api.post("/voters", {
          full_name,
          national_id,
          area,
          batch_id: batch_id ?? undefined,
          list_number: listPayload ?? undefined,
        });
      }
      onSaved();
      onClose();
    } catch {
      setErr("تعذر الحفظ (تحقق من عدم تكرار الرمز أو اختيار دفعة صحيحة)");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold text-white">{voter ? "تعديل ناخب" : "ناخب جديد"}</h3>
        <div className="mt-4 space-y-3">
          <Field label="الاسم الكامل" value={full_name} onChange={setFullName} />
          <Field label="رمز الناخب" value={national_id} onChange={setNationalId} dir="ltr" />
          <Field label="مركز التسجيل والاقتراع" value={area ?? ""} onChange={setArea} />
          <Field label="# من الملف (اختياري)" value={list_number} onChange={setListNumber} dir="ltr" />
          <div>
            <label className="text-sm text-slate-400">الدفعة</label>
            <select
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
              value={batch_id ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                setBatchId(v === "" ? null : Number(v));
              }}
            >
              <option value="">بدون دفعة</option>
              {batches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.title}
                </option>
              ))}
            </select>
          </div>
          {voter && (
            <div>
              <label className="text-sm text-slate-400">الحالة</label>
              <select
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
                value={status}
                onChange={(e) => setStatus(Number(e.target.value) as 0 | 1)}
              >
                <option value={0}>لم ينتخب</option>
                <option value={1}>تم الانتخاب</option>
              </select>
            </div>
          )}
        </div>
        {err && <p className="mt-2 text-sm text-rose-400">{err}</p>}
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" className="rounded-lg px-3 py-2 text-slate-300 hover:bg-slate-800" onClick={onClose}>
            إلغاء
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={save}
            className="rounded-lg bg-sky-600 px-4 py-2 font-medium text-white hover:bg-sky-500 disabled:opacity-50"
          >
            حفظ
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  dir,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  dir?: "ltr";
}) {
  return (
    <div>
      <label className="text-sm text-slate-400">{label}</label>
      <input
        className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white outline-none ring-sky-500 focus:ring-2"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        dir={dir}
      />
    </div>
  );
}
