import { Router } from "express";
import { query } from "../db.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";

const r = Router();
r.use(requireAuth);
r.use(requireAdmin);

r.get("/", async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(200, Math.max(10, Number(req.query.pageSize) || 40));
    const offset = (page - 1) * pageSize;
    
    const countResult = await query<{ c: number }>("SELECT COUNT(*) as c FROM audit_logs");
    const total = countResult[0]?.c || 0;
    
    const rows = await query<{
      id: number;
      user_id: number;
      username: string;
      action: string;
      entity: string;
      entity_id: string | null;
      details: string | null;
      created_at: string;
    }>(
      `SELECT l.id, l.user_id, u.username, l.action, l.entity, l.entity_id, l.details, l.created_at
       FROM audit_logs l
       JOIN users u ON u.id = l.user_id
       ORDER BY l.id DESC
       LIMIT $1 OFFSET $2`,
      [pageSize, offset]
    );
    
    res.json({
      logs: rows.map((l) => ({
        ...l,
        details: l.details ? (JSON.parse(l.details) as unknown) : null,
      })),
      total,
      page,
      pageSize,
    });
  } catch (err) {
    console.error("get logs error:", err);
    res.status(500).json({ error: "خطأ الخادم" });
  }
});

export default r;
