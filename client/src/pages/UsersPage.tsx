import { useEffect, useState } from "react";
import api from "../api/client";

type U = { id: number; username: string; role: string; created_at: string };

export default function UsersPage() {
  const [users, setUsers] = useState<U[]>([]);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"admin" | "staff">("staff");
  const [msg, setMsg] = useState<string | null>(null);
  const [editing, setEditing] = useState<U | null>(null);

  async function load() {
    const { data } = await api.get<U[]>("/users");
    setUsers(data);
  }

  useEffect(() => {
    void load();
  }, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    try {
      await api.post("/users", { username, password, role });
      setUsername("");
      setPassword("");
      setRole("staff");
      setMsg("تم إنشاء المستخدم");
      await load();
    } catch {
      setMsg("فشل الإنشاء (ربما الاسم مكرر أو كلمة مرور قصيرة)");
    }
  }

  async function removeUser(u: U) {
    if (!confirm(`حذف المستخدم ${u.username}؟`)) return;
    setMsg(null);
    try {
      await api.delete(`/users/${u.id}`);
      setMsg("تم حذف المستخدم");
      await load();
    } catch {
      setMsg("تعذر حذف المستخدم");
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">المستخدمون</h1>
      </div>

      <form onSubmit={add} className="max-w-md space-y-3 rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
        <h2 className="font-semibold text-white">مستخدم جديد</h2>
        <input
          placeholder="اسم المستخدم"
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          dir="ltr"
        />
        <input
          type="password"
          placeholder="كلمة المرور (6+)"
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          dir="ltr"
        />
        <select
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
          value={role}
          onChange={(e) => setRole(e.target.value as "admin" | "staff")}
        >
          <option value="staff">موظف (تأشير فقط)</option>
          <option value="admin">مدير</option>
        </select>
        {msg && <p className="text-sm text-sky-300">{msg}</p>}
        <button type="submit" className="w-full rounded-lg bg-sky-600 py-2 font-medium text-white hover:bg-sky-500">
          إضافة
        </button>
      </form>

      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-900 text-slate-400">
            <tr>
              <th className="px-3 py-2">#</th>
              <th className="px-3 py-2">اسم المستخدم</th>
              <th className="px-3 py-2">الدور</th>
              <th className="px-3 py-2">تاريخ الإنشاء</th>
              <th className="px-3 py-2">إجراءات</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t border-slate-800">
                <td className="px-3 py-2 text-slate-500">{u.id}</td>
                <td className="px-3 py-2 text-white">{u.username}</td>
                <td className="px-3 py-2">{u.role === "admin" ? "مدير" : "موظف"}</td>
                <td className="px-3 py-2 text-xs text-slate-400" dir="ltr">
                  {new Date(u.created_at).toLocaleString("ar-EG")}
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-3">
                    <button type="button" className="text-sky-300 hover:text-sky-200 hover:underline" onClick={() => setEditing(u)}>
                      تعديل
                    </button>
                    <button type="button" className="text-rose-400 hover:text-rose-300 hover:underline" onClick={() => void removeUser(u)}>
                      حذف
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && <EditUserModal user={editing} onClose={() => setEditing(null)} onSaved={load} />}
    </div>
  );
}

function EditUserModal({
  user,
  onClose,
  onSaved,
}: {
  user: U;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [username, setUsername] = useState(user.username);
  const [role, setRole] = useState<"admin" | "staff">((user.role as "admin" | "staff") ?? "staff");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setErr(null);
    setBusy(true);
    try {
      await api.patch(`/users/${user.id}`, {
        username,
        role,
        password: password.trim() || undefined,
      });
      await onSaved();
      onClose();
    } catch {
      setErr("تعذر حفظ التعديلات");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold text-white">تعديل مستخدم</h3>
        <div className="mt-4 space-y-3">
          <input
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="اسم المستخدم"
            dir="ltr"
          />
          <select
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
            value={role}
            onChange={(e) => setRole(e.target.value as "admin" | "staff")}
          >
            <option value="staff">موظف (تأشير فقط)</option>
            <option value="admin">مدير</option>
          </select>
          <input
            type="password"
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="كلمة مرور جديدة (اختياري)"
            dir="ltr"
          />
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
