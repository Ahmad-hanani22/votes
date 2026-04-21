import { query, queryOne } from "./db.js";

/** دفعة مؤقتة للاستيراد عندما لا يُحدد المستخدم دفعة؛ تُفرَّغ بعد الربط من عمود المركز. */
export const TEMP_IMPORT_BATCH_TITLE = "استيراد Excel (مؤقت)";

/**
 * ينشئ دفعة لكل مركز تسجيل مميز (مدرسة) ويربط الناخبين بها تلقائياً.
 * يُستدعى عند تشغيل الخادم — لا حاجة لإنشاء الدفعات يدوياً.
 */
export async function autoAssignBatchesFromAreas() {
  try {
    const areasResult = await query<{ a: string }>(
      `SELECT DISTINCT TRIM(area) AS a FROM voters
       WHERE area IS NOT NULL AND TRIM(area) != ''
       ORDER BY a COLLATE "C"`
    );

    for (const { a } of areasResult) {
      let batch = await queryOne<{ id: number }>(
        "SELECT id FROM import_batches WHERE title = $1 LIMIT 1",
        [a]
      );
      if (!batch) {
        batch = await queryOne<{ id: number }>(
          "INSERT INTO import_batches (title) VALUES ($1) RETURNING id",
          [a]
        );
      }
      if (batch?.id) {
        await query("UPDATE voters SET batch_id = $1, updated_at = CURRENT_TIMESTAMP WHERE TRIM(area) = $2", [
          batch.id,
          a,
        ]);
      }
    }

    const nullBatchResult = await query<{ c: number }>(
      "SELECT COUNT(*) as c FROM voters WHERE batch_id IS NULL"
    );
    const nullBatch = nullBatchResult[0]?.c || 0;

    if (nullBatch > 0) {
      const title = "بدون مركز تسجيل";
      let batch = await queryOne<{ id: number }>(
        "SELECT id FROM import_batches WHERE title = $1 LIMIT 1",
        [title]
      );
      if (!batch) {
        batch = await queryOne<{ id: number }>(
          "INSERT INTO import_batches (title) VALUES ($1) RETURNING id",
          [title]
        );
      }
      if (batch?.id) {
        await query("UPDATE voters SET batch_id = $1, updated_at = CURRENT_TIMESTAMP WHERE batch_id IS NULL", [
          batch.id,
        ]);
      }
    }

    const legacy = await queryOne<{ id: number }>(
      "SELECT id FROM import_batches WHERE title = $1",
      ["البيانات الحالية (قبل التصنيف)"]
    );
    if (legacy?.id) {
      const cntResult = await query<{ c: number }>(
        "SELECT COUNT(*) as c FROM voters WHERE batch_id = $1",
        [legacy.id]
      );
      const cnt = cntResult[0]?.c || 0;
      if (cnt === 0) {
        await query("DELETE FROM import_batches WHERE id = $1", [legacy.id]);
      }
    }

    const tempRows = await query<{ id: number }>(
      "SELECT id FROM import_batches WHERE title = $1",
      [TEMP_IMPORT_BATCH_TITLE]
    );
    for (const { id } of tempRows) {
      const cntResult = await query<{ c: number }>(
        "SELECT COUNT(*) as c FROM voters WHERE batch_id = $1",
        [id]
      );
      const cnt = cntResult[0]?.c || 0;
      if (cnt === 0) {
        await query("DELETE FROM import_batches WHERE id = $1", [id]);
      }
    }
  } catch (err) {
    console.error("autoAssignBatchesFromAreas error:", err);
    throw err;
  }
}
