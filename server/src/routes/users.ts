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

export default r;
