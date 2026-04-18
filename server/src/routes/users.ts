import { Router } from "express";
import bcrypt from "bcryptjs";
import { db } from "../db.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { logAudit } from "../audit.js";

const r = Router();
r.use(requireAuth, requireAdmin);

r.get("/", (_req, res) => {
  const rows = db
    .prepare("SELECT id, username, role, created_at FROM users ORDER BY id")
    .all() as { id: number; username: string; role: string; created_at: string }[];
  res.json(rows);
});

r.post("/", (req, res) => {
  const { username, password, role } = req.body as {
    username?: string;
    password?: string;
    role?: string;
  };
  const u = username?.trim();
  const p = password?.trim();
  if (!u || !p || p.length < 6) return res.status(400).json({ error: "اسم مستخدم وكلمة مرور (6 أحرف على الأقل)" });
  if (role !== "admin" && role !== "staff") return res.status(400).json({ error: "الدور يجب أن يكون admin أو staff" });
  try {
    const hash = bcrypt.hashSync(p, 10);
    const info = db.prepare("INSERT INTO users (username, password_hash, role) VALUES (?,?,?)").run(u, hash, role);
    const newId = Number(info.lastInsertRowid);
    logAudit(req.auth!.sub, "create", "user", newId, { username: u, role });
    res.status(201).json({ id: newId, username: u, role });
  } catch {
    res.status(400).json({ error: "اسم المستخدم موجود مسبقاً" });
  }
});

export default r;
