import { Router } from "express";
import bcrypt from "bcryptjs";
import { db } from "../db.js";
import type { UserRow } from "../db.js";
import { requireAuth, signToken } from "../middleware/auth.js";

const r = Router();

r.post("/login", (req, res) => {
  const { username, password } = req.body as { username?: string; password?: string };
  if (!username || !password) return res.status(400).json({ error: "اسم المستخدم وكلمة المرور مطلوبان" });
  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username.trim()) as UserRow | undefined;
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: "بيانات الدخول غير صحيحة" });
  }
  const token = signToken(user);
  res.json({
    token,
    user: { id: user.id, username: user.username, role: user.role },
  });
});

r.get("/me", requireAuth, (req, res) => {
  const row = db
    .prepare("SELECT id, username, role, created_at FROM users WHERE id = ?")
    .get(req.auth!.sub) as { id: number; username: string; role: string; created_at: string } | undefined;
  if (!row) return res.status(401).json({ error: "مستخدم غير موجود" });
  res.json(row);
});

export default r;
