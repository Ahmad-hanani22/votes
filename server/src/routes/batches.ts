import { Router } from "express";
import { db, runTransaction } from "../db.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { logAudit } from "../audit.js";
import { autoAssignBatchesFromAreas } from "../batchFromAreas.js";

const r = Router();
r.use(requireAuth);

/** إعادة بناء الدفعات من عمود «مركز التسجيل والاقتراع» لكل ناخب (مفيد بعد استيراد دون إعادة تشغيل الخادم). */
r.post("/rebuild-from-areas", requireAdmin, (req, res) => {
  try {
    autoAssignBatchesFromAreas(db);
    logAudit(req.auth!.sub, "rebuild_batches", "import_batches", null, {});
    res.json({ ok: true });
  } catch (e) {
    console.error("rebuild-from-areas:", e);
    const msg = e instanceof Error ? e.message : "فشل إعادة الربط";
    res.status(500).json({ error: msg });
  }
});

r.get("/", (_req, res) => {
  const rows = db
    .prepare(
      `SELECT b.id, b.title, b.created_at,
        (SELECT COUNT(*) FROM voters v WHERE v.batch_id = b.id) AS voter_count,
        (SELECT COUNT(*) FROM voters v WHERE v.batch_id = b.id AND v.status = 1) AS voted_count
       FROM import_batches b
       ORDER BY b.id DESC`
    )
    .all() as {
    id: number;
    title: string;
    created_at: string;
    voter_count: number;
    voted_count: number;
  }[];
  res.json(rows);
});

r.post("/", requireAdmin, (req, res) => {
  const body = req.body as { title?: unknown };
  const title = String(body?.title ?? "").trim();
  if (!title) return res.status(400).json({ error: "عنوان الدفعة مطلوب (مثلاً اسم المدرسة)" });
  try {
    const info = db.prepare("INSERT INTO import_batches (title) VALUES (?)").run(title);
    const id = Number(info.lastInsertRowid);
    try {
      logAudit(req.auth!.sub, "create", "import_batch", id, { title });
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

r.delete("/:id", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "معرف غير صالح" });
  const row = db.prepare("SELECT title FROM import_batches WHERE id = ?").get(id) as { title: string } | undefined;
  if (!row) return res.status(404).json({ error: "الدفعة غير موجودة" });
  const removed = runTransaction(() => {
    const v = db.prepare("DELETE FROM voters WHERE batch_id = ?").run(id);
    db.prepare("DELETE FROM import_batches WHERE id = ?").run(id);
    return v.changes;
  });
  logAudit(req.auth!.sub, "delete", "import_batch", id, { title: row.title, voters_removed: removed });
  res.json({ ok: true, voters_removed: removed });
});

export default r;
