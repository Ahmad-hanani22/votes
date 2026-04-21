import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import type { UserRow } from "../db.js";
import { queryOne } from "../db.js";

const JWT_SECRET = process.env.JWT_SECRET ?? "dev-only-change-me";

export type JwtPayload = { sub: number; role: "admin" | "staff"; username: string };

declare global {
  namespace Express {
    interface Request {
      auth?: JwtPayload;
    }
  }
}

export function signToken(user: Pick<UserRow, "id" | "role" | "username">) {
  return jwt.sign(
    { sub: user.id, role: user.role, username: user.username },
    JWT_SECRET,
    { expiresIn: "12h" }
  );
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const h = req.headers.authorization;
  const token = h?.startsWith("Bearer ") ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: "غير مصرح" });
  try {
    const payload = jwt.verify(token, JWT_SECRET) as unknown as JwtPayload;
    req.auth = payload;
    next();
  } catch {
    return res.status(401).json({ error: "جلسة منتهية أو غير صالحة" });
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.auth) return res.status(401).json({ error: "غير مصرح" });
  if (req.auth.role !== "admin") return res.status(403).json({ error: "صلاحية المدير مطلوبة" });
  next();
}

export async function getUserById(id: number) {
  return await queryOne<{ id: number; username: string; role: "admin" | "staff"; created_at: string }>(
    "SELECT id, username, role, created_at FROM users WHERE id = $1",
    [id]
  );
}
