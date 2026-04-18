import type { DatabaseSync } from "node:sqlite";

/** دفعة مؤقتة للاستيراد عندما لا يُحدد المستخدم دفعة؛ تُفرَّغ بعد الربط من عمود المركز. */
export const TEMP_IMPORT_BATCH_TITLE = "استيراد Excel (مؤقت)";

/**
 * ينشئ دفعة لكل مركز تسجيل مميز (مدرسة) ويربط الناخبين بها تلقائياً.
 * يُستدعى عند تشغيل الخادم — لا حاجة لإنشاء الدفعات يدوياً.
 */
export function autoAssignBatchesFromAreas(db: DatabaseSync) {
  const areas = db
    .prepare(
      `SELECT DISTINCT TRIM(area) AS a FROM voters
       WHERE area IS NOT NULL AND TRIM(area) != ''
       ORDER BY a COLLATE NOCASE`
    )
    .all() as { a: string }[];

  for (const { a } of areas) {
    let batch = db.prepare("SELECT id FROM import_batches WHERE title = ? LIMIT 1").get(a) as { id: number } | undefined;
    if (!batch) {
      const info = db.prepare("INSERT INTO import_batches (title) VALUES (?)").run(a);
      batch = { id: Number(info.lastInsertRowid) };
    }
    db.prepare("UPDATE voters SET batch_id = ?, updated_at = datetime('now') WHERE TRIM(area) = ?").run(batch.id, a);
  }

  const nullBatch = (
    db.prepare("SELECT COUNT(*) as c FROM voters WHERE batch_id IS NULL").get() as { c: number }
  ).c;
  if (nullBatch > 0) {
    const title = "بدون مركز تسجيل";
    let batch = db.prepare("SELECT id FROM import_batches WHERE title = ? LIMIT 1").get(title) as
      | { id: number }
      | undefined;
    if (!batch) {
      const info = db.prepare("INSERT INTO import_batches (title) VALUES (?)").run(title);
      batch = { id: Number(info.lastInsertRowid) };
    }
    db.prepare("UPDATE voters SET batch_id = ?, updated_at = datetime('now') WHERE batch_id IS NULL").run(batch.id);
  }

  const legacyTitle = "البيانات الحالية (قبل التصنيف)";
  const legacy = db.prepare("SELECT id FROM import_batches WHERE title = ?").get(legacyTitle) as { id: number } | undefined;
  if (legacy) {
    const cnt = (
      db.prepare("SELECT COUNT(*) as c FROM voters WHERE batch_id = ?").get(legacy.id) as { c: number }
    ).c;
    if (cnt === 0) {
      db.prepare("DELETE FROM import_batches WHERE id = ?").run(legacy.id);
    }
  }

  const tempRows = db.prepare("SELECT id FROM import_batches WHERE title = ?").all(TEMP_IMPORT_BATCH_TITLE) as {
    id: number;
  }[];
  for (const { id } of tempRows) {
    const cnt = (db.prepare("SELECT COUNT(*) as c FROM voters WHERE batch_id = ?").get(id) as { c: number }).c;
    if (cnt === 0) db.prepare("DELETE FROM import_batches WHERE id = ?").run(id);
  }
}
