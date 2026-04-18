import { Router } from "express";
import { db } from "../db.js";
import { requireAuth } from "../middleware/auth.js";

const r = Router();
r.use(requireAuth);

function parseOptionalBatchId(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const raw = Array.isArray(v) ? v[0] : v;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

r.get("/stats", (req, res) => {
  const batchId = parseOptionalBatchId(req.query.batchId);
  const where = batchId ? "WHERE batch_id = ?" : "";
  const args: unknown[] = batchId ? [batchId] : [];

  const total = (db.prepare(`SELECT COUNT(*) as c FROM voters ${where}`).get(...(args as (string | number)[])) as { c: number }).c;
  const voted = (
    db
      .prepare(`SELECT COUNT(*) as c FROM voters ${where}${batchId ? " AND" : " WHERE"} status = 1`)
      .get(...(args as (string | number)[])) as { c: number }
  ).c;
  const pending = total - voted;
  const pct = total === 0 ? 0 : Math.round((voted / total) * 1000) / 10;

  const byArea = (
    batchId
      ? db
          .prepare(
            `SELECT COALESCE(NULLIF(TRIM(area), ''), 'بدون مركز') as area,
                    COUNT(*) as total,
                    SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END) as voted
             FROM voters WHERE batch_id = ?
             GROUP BY COALESCE(NULLIF(TRIM(area), ''), 'بدون مركز')
             ORDER BY total DESC`
          )
          .all(batchId)
      : db
          .prepare(
            `SELECT COALESCE(NULLIF(TRIM(area), ''), 'بدون مركز') as area,
                    COUNT(*) as total,
                    SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END) as voted
             FROM voters
             GROUP BY COALESCE(NULLIF(TRIM(area), ''), 'بدون مركز')
             ORDER BY total DESC`
          )
          .all()
  ) as { area: string; total: number; voted: number }[];

  let batchTitle: string | null = null;
  if (batchId) {
    const br = db.prepare("SELECT title FROM import_batches WHERE id = ?").get(batchId) as { title: string } | undefined;
    batchTitle = br?.title ?? null;
  }

  const byBatch = batchId
    ? null
    : (db
        .prepare(
          `SELECT b.id AS batch_id, b.title AS title,
                  COUNT(v.id) AS total,
                  SUM(CASE WHEN v.status = 1 THEN 1 ELSE 0 END) AS voted
           FROM import_batches b
           LEFT JOIN voters v ON v.batch_id = b.id
           GROUP BY b.id
           ORDER BY b.id DESC`
        )
        .all() as { batch_id: number; title: string; total: number; voted: number }[]);

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
});

export default r;
