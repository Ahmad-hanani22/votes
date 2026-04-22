import { Router } from "express";
import bcrypt from "bcryptjs";
import { db, query, queryOne } from "../db.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { logAudit } from "../audit.js";

const r = Router();
r.use(requireAuth, requireAdmin);

r.get("/", async (_req, res) => {
  try {
    const rows = await query<{ id: number; username: string; role: string; created_at: string }>(
      "SELECT id, username, role, created_at FROM users ORDER BY id"
    );
    res.json(rows);
  } catch (err) {
    console.error("get users error:", err);
    res.status(500).json({ error: "خطأ الخادم" });
  }
});

r.post("/", async (req, res) => {
  try {
    const { username, password, role } = req.body as {
      username?: string;
      password?: string;
      role?: string;
    };
    const u = username?.trim();
    const p = password?.trim();
    if (!u || !p || p.length < 6) return res.status(400).json({ error: "اسم مستخدم وكلمة مرور (6 أحرف على الأقل)" });
    if (role !== "admin" && role !== "staff") return res.status(400).json({ error: "الدور يجب أن يكون admin أو staff" });
    
    const hash = bcrypt.hashSync(p, 10);
    const result = await queryOne<{ id: number }>(
      "INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3) RETURNING id",
      [u, hash, role]
    );
    const newId = result?.id;
    logAudit(req.auth!.sub, "create", "user", newId || null, { username: u, role });
    res.status(201).json({ id: newId, username: u, role });
  } catch (err) {
    console.error("create user error:", err);
    res.status(400).json({ error: "اسم المستخدم موجود مسبقاً" });
  }
});

r.patch("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id < 1) return res.status(400).json({ error: "معرف غير صالح" });

    const current = await queryOne<{ id: number; username: string; role: "admin" | "staff" }>(
      "SELECT id, username, role FROM users WHERE id = $1",
      [id]
    );
    if (!current) return res.status(404).json({ error: "المستخدم غير موجود" });

    const { username, password, role } = req.body as {
      username?: string;
      password?: string;
      role?: "admin" | "staff";
    };

    const nextUsername = username === undefined ? current.username : String(username).trim();
    if (!nextUsername) return res.status(400).json({ error: "اسم المستخدم مطلوب" });

    const nextRole = role === undefined ? current.role : role;
    if (nextRole !== "admin" && nextRole !== "staff") {
      return res.status(400).json({ error: "الدور يجب أن يكون admin أو staff" });
    }

    let updated: { id: number; username: string; role: "admin" | "staff"; created_at: string } | null = null;
    if (password !== undefined && String(password).trim() !== "") {
      const p = String(password).trim();
      if (p.length < 6) return res.status(400).json({ error: "كلمة المرور 6 أحرف على الأقل" });
      updated = await queryOne<{ id: number; username: string; role: "admin" | "staff"; created_at: string }>(
        `UPDATE users
         SET username = $1, role = $2, password_hash = $3
         WHERE id = $4
         RETURNING id, username, role, created_at`,
        [nextUsername, nextRole, bcrypt.hashSync(p, 10), id]
      );
    } else {
      updated = await queryOne<{ id: number; username: string; role: "admin" | "staff"; created_at: string }>(
        `UPDATE users
         SET username = $1, role = $2
         WHERE id = $3
         RETURNING id, username, role, created_at`,
        [nextUsername, nextRole, id]
      );
    }

    logAudit(req.auth!.sub, "update", "user", id, { username: updated?.username, role: updated?.role });
    res.json(updated);
  } catch (err) {
    console.error("update user error:", err);
    res.status(400).json({ error: "تعذر تحديث المستخدم (قد يكون الاسم مستخدماً)" });
  }
});

r.delete("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id < 1) return res.status(400).json({ error: "معرف غير صالح" });
    if (req.auth?.sub === id) return res.status(400).json({ error: "لا يمكنك حذف حسابك الحالي" });

    const current = await queryOne<{ id: number; username: string; role: "admin" | "staff" }>(
      "SELECT id, username, role FROM users WHERE id = $1",
      [id]
    );
    if (!current) return res.status(404).json({ error: "المستخدم غير موجود" });

    await queryOne("DELETE FROM users WHERE id = $1", [id]);
    logAudit(req.auth!.sub, "delete", "user", id, { username: current.username, role: current.role });
    res.json({ ok: true });
  } catch (err) {
    console.error("delete user error:", err);
    res.status(500).json({ error: "خطأ الخادم" });
  }
});

export default r;
