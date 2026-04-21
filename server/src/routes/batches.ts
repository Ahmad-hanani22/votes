import { Router } from "express";
import { query, queryOne, runTransaction } from "../db.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { logAudit } from "../audit.js";
import { autoAssignBatchesFromAreas } from "../batchFromAreas.js";

const r = Router();
r.use(requireAuth);

/** إعادة بناء الدفعات من عمود «مركز التسجيل والاقتراع» لكل ناخب (مفيد بعد استيراد دون إعادة تشغيل الخادم). */
r.post("/rebuild-from-areas", requireAdmin, async (req, res) => {
  try {
    await autoAssignBatchesFromAreas();
    logAudit(req.auth!.sub, "rebuild_batches", "import_batches", null, {});
    res.json({ ok: true });
  } catch (e) {
    console.error("rebuild-from-areas:", e);
    const msg = e instanceof Error ? e.message : "فشل إعادة الربط";
    res.status(500).json({ error: msg });
  }
});

r.get("/", async (_req, res) => {
  try {
    const rows = await query<{
      id: number;
      title: string;
      created_at: string;
      voter_count: number;
      voted_count: number;
    }>(
      `SELECT b.id, b.title, b.created_at,
        (SELECT COUNT(*) FROM voters v WHERE v.batch_id = b.id) AS voter_count,
        (SELECT COUNT(*) FROM voters v WHERE v.batch_id = b.id AND v.status = 1) AS voted_count
       FROM import_batches b
       WHERE EXISTS (SELECT 1 FROM voters v WHERE v.batch_id = b.id)
       ORDER BY b.id DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error("get batches error:", err);
    res.status(500).json({ error: "خطأ الخادم" });
  }
});

r.post("/", requireAdmin, async (req, res) => {
  try {
    const body = req.body as { title?: unknown };
    const title = String(body?.title ?? "").trim();
    if (!title) return res.status(400).json({ error: "عنوان الدفعة مطلوب (مثلاً اسم المدرسة)" });
    
    const result = await queryOne<{ id: number }>(
      "INSERT INTO import_batches (title) VALUES ($1) RETURNING id",
      [title]
    );
    const id = result?.id;
    try {
      logAudit(req.auth!.sub, "create", "import_batch", id || null, { title });
    } catch (logErr) {
      console.error("audit log (import_batch create):", logErr);
    }
    res.status(201).json({ id, title, created_at: new Date().toISOString() });
  } catch (e) {
    console.error("import_batches INSERT:", e);
    const msg = e instanceof Error ? e.message : "تعذر إنشاء الدفعة";
    res.status(500).json({ error: msg });
  }
});

r.delete("/:id", requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "معرف غير صالح" });
    
    const row = await queryOne<{ title: string }>("SELECT title FROM import_batches WHERE id = $1", [id]);
    if (!row) return res.status(404).json({ error: "الدفعة غير موجودة" });
    
    const removed = await runTransaction(async () => {
      const v = await queryOne<{ count: number }>(
        "DELETE FROM voters WHERE batch_id = $1 RETURNING COUNT(*) as count",
        [id]
      );
      await queryOne("DELETE FROM import_batches WHERE id = $1", [id]);
      return v?.count || 0;
    });
    
    logAudit(req.auth!.sub, "delete", "import_batch", id, { title: row.title, voters_removed: removed });
    res.json({ ok: true, voters_removed: removed });
  } catch (err) {
    console.error("delete batch error:", err);
    res.status(500).json({ error: "خطأ الخادم" });
  }
});

export default r;
