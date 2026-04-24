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

const FAMILY_DEFS = [
  { key: "حنني", aliases: ["حنني", "هنني", "مصلح", "ابو غلمي", "ابوغلمي", "غلمي", "ابو سمره", "ابو سمرة", "ابوسمره", "ابوسمرة"] },
  { key: "مليطات", aliases: ["مليطات", "حمدون"] },
  { key: "خطاطبه", aliases: ["خطاطبه", "خطاطبة"] },
  { key: "نصاصره", aliases: ["نصاصره", "نصاصرة"] },
  { key: "ابو حيط", aliases: ["ابو حيط", "ابوحيط"] },
  { key: "حج محمد", aliases: ["حج محمد", "حجمحمد"] },
] as const;

function normalizeArabicLoose(v: string): string {
  return v
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/[ى]/g, "ي")
    .replace(/[\u064B-\u0652]/g, "")
    .replace(/ـ/g, "");
}

function normalizeForFamilyMatch(v: string): string {
  return normalizeArabicLoose(v).replace(/\s+/g, "");
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

    const votedPeople = await query<{ full_name: string }>(
      batchId
        ? `SELECT full_name FROM voters WHERE batch_id = $1 AND status = 1`
        : `SELECT full_name FROM voters WHERE status = 1`,
      args
    );

    const familyCounts = new Map<string, number>();
    for (const f of FAMILY_DEFS) familyCounts.set(f.key, 0);
    familyCounts.set("عائلات أخرى", 0);

    for (const row of votedPeople) {
      const normalizedName = normalizeForFamilyMatch(row.full_name ?? "");
      let matchedFamily: string | null = null;
      for (const f of FAMILY_DEFS) {
        const hasAlias = f.aliases.some((a) => normalizedName.includes(normalizeForFamilyMatch(a)));
        if (hasAlias) {
          matchedFamily = f.key;
          break;
        }
      }
      const bucket = matchedFamily ?? "عائلات أخرى";
      familyCounts.set(bucket, (familyCounts.get(bucket) ?? 0) + 1);
    }

    const byFamily = [...familyCounts.entries()]
      .map(([family, votedCount]) => ({
        family,
        voted: votedCount,
        percent: voted === 0 ? 0 : Math.round((votedCount / voted) * 1000) / 10,
      }))
      .sort((a, b) => {
        const ai = FAMILY_DEFS.findIndex((f) => f.key === a.family);
        const bi = FAMILY_DEFS.findIndex((f) => f.key === b.family);
        if (ai >= 0 && bi >= 0) return ai - bi;
        if (ai >= 0) return -1;
        if (bi >= 0) return 1;
        if (a.family === "عائلات أخرى" && b.family !== "عائلات أخرى") return 1;
        if (b.family === "عائلات أخرى" && a.family !== "عائلات أخرى") return -1;
        return b.voted - a.voted;
      });

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
      byFamily,
      batchId,
      batchTitle,
    });
  } catch (err) {
    console.error("dashboard stats error:", err);
    res.status(500).json({ error: "خطأ الخادم" });
  }
});

export default r;
