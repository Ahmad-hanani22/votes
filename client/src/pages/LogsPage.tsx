import { useEffect, useState } from "react";
import api from "../api/client";
import type { AuditLog } from "../types";

export default function LogsPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 40;

  useEffect(() => {
    (async () => {
      const { data } = await api.get<{ logs: AuditLog[]; total: number }>("/logs", {
        params: { page, pageSize },
      });
      setLogs(data.logs);
      setTotal(data.total);
    })();
  }, [page]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-white">سجل العمليات</h1>
      </div>
      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="min-w-full text-right text-sm">
          <thead className="bg-slate-900 text-slate-400">
            <tr>
              <th className="px-3 py-2">الوقت</th>
              <th className="px-3 py-2">المستخدم</th>
              <th className="px-3 py-2">الإجراء</th>
              <th className="px-3 py-2">الكيان</th>
              <th className="px-3 py-2">تفاصيل</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.id} className="border-t border-slate-800/80 bg-slate-950/40">
                <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-400" dir="ltr">
                  {new Date(l.created_at).toLocaleString("ar-EG")}
                </td>
                <td className="px-3 py-2 text-slate-200">{l.username}</td>
                <td className="px-3 py-2 font-mono text-xs text-sky-300">{l.action}</td>
                <td className="px-3 py-2 text-slate-300">
                  {l.entity} {l.entity_id ? `#${l.entity_id}` : ""}
                </td>
                <td className="max-w-xs truncate px-3 py-2 text-xs text-slate-500" dir="ltr" title={JSON.stringify(l.details)}>
                  {l.details ? JSON.stringify(l.details) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex justify-between text-sm text-slate-400">
        <span>إجمالي {total}</span>
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
