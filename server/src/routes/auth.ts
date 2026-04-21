import { Router } from "express";
import bcrypt from "bcryptjs";
import { db, queryOne } from "../db.js";
import type { UserRow } from "../db.js";
import { requireAuth, signToken } from "../middleware/auth.js";

const r = Router();

r.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body as { username?: string; password?: string };
    if (!username || !password) return res.status(400).json({ error: "اسم المستخدم وكلمة المرور مطلوبان" });
    const user = await queryOne<UserRow>("SELECT * FROM users WHERE username = $1", [username.trim()]);
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: "بيانات الدخول غير صحيحة" });
    }
    const token = signToken(user);
    res.json({
      token,
      user: { id: user.id, username: user.username, role: user.role },
    });
  } catch (err) {
    console.error("login error:", err);
    res.status(500).json({ error: "خطأ الخادم" });
  }
});

r.get("/me", requireAuth, async (req, res) => {
  try {
    const row = await queryOne<{ id: number; username: string; role: string; created_at: string }>(
      "SELECT id, username, role, created_at FROM users WHERE id = $1",
      [req.auth!.sub]
    );
    if (!row) return res.status(401).json({ error: "مستخدم غير موجود" });
    res.json(row);
  } catch (err) {
    console.error("me error:", err);
    res.status(500).json({ error: "خطأ الخادم" });
  }
});

export default r;
