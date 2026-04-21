import { Router } from "express";
import { query, queryOne } from "../db.js";
import { requireAuth } from "../middleware/auth.js";

const r = Router();
r.use(requireAuth);

function parseOptionalBatchId(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const raw = Array.isArray(v) ? v[0] : v;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

r.get("/stats", async (req, res) => {
  try {
    const batchId = parseOptionalBatchId(req.query.batchId);
    const where = batchId ? "WHERE batch_id = $1" : "";
    const args: (number | undefined)[] = batchId ? [batchId] : [];

    const totalResult = await query<{ c: number }>(`SELECT COUNT(*) as c FROM voters ${where}`, args);
    const total = totalResult[0]?.c || 0;

    const votedResult = await query<{ c: number }>(
      `SELECT COUNT(*) as c FROM voters ${where}${batchId ? " AND" : " WHERE"} status = 1`,
      args
    );
    const voted = votedResult[0]?.c || 0;

    const pending = total - voted;
    const pct = total === 0 ? 0 : Math.round((voted / total) * 1000) / 10;

    const byArea = await query<{ area: string; total: number; voted: number }>(
      batchId
        ? `SELECT COALESCE(NULLIF(TRIM(area), ''), 'بدون مركز') as area,
                  COUNT(*) as total,
                  SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END) as voted
           FROM voters WHERE batch_id = $1
           GROUP BY COALESCE(NULLIF(TRIM(area), ''), 'بدون مركز')
           ORDER BY total DESC`
        : `SELECT COALESCE(NULLIF(TRIM(area), ''), 'بدون مركز') as area,
                  COUNT(*) as total,
                  SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END) as voted
           FROM voters
           GROUP BY COALESCE(NULLIF(TRIM(area), ''), 'بدون مركز')
           ORDER BY total DESC`,
      args
    );

    let batchTitle: string | null = null;
    if (batchId) {
      const br = await queryOne<{ title: string }>("SELECT title FROM import_batches WHERE id = $1", [batchId]);
      batchTitle = br?.title ?? null;
    }

    let byBatch: any[] | null = null;
    if (!batchId) {
      byBatch = await query<{
        batch_id: number;
        title: string;
        total: number;
        voted: number;
      }>(
        `SELECT b.id AS batch_id, b.title AS title,
                COUNT(v.id) AS total,
                SUM(CASE WHEN v.status = 1 THEN 1 ELSE 0 END) AS voted
         FROM import_batches b
         LEFT JOIN voters v ON v.batch_id = b.id
         GROUP BY b.id
         HAVING COUNT(v.id) > 0
         ORDER BY b.id DESC`
      );
    }

    res.json({
      total,
      voted,
      pending,
      percentVoted: pct,
      byArea: byArea.map((a) => ({
        area: a.area,
        total: a.total,
        voted: a.voted,
        pending: a.total - a.voted,
        percent: a.total === 0 ? 0 : Math.round((a.voted / a.total) * 1000) / 10,
      })),
      byBatch: byBatch
        ? byBatch.map((b) => ({
            batchId: b.batch_id,
            title: b.title,
            total: b.total,
            voted: b.voted,
            pending: b.total - b.voted,
            percent: b.total === 0 ? 0 : Math.round((b.voted / b.total) * 1000) / 10,
          }))
        : null,
      batchId,
      batchTitle,
    });
  } catch (err) {
    console.error("dashboard stats error:", err);
    res.status(500).json({ error: "خطأ الخادم" });
  }
});

export default r;
