import { query, queryOne } from "./db.js";

async function voterHasColumn(col: string) {
  try {
    await query(`SELECT ${col} FROM voters LIMIT 1`);
    return true;
  } catch {
    return false;
  }
}

/** ترقية مخطط قاعدة موجودة (دفعات استيراد + رقم الصف من Excel). */
export async function runMigrations() {
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS import_batches (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Check and add columns if needed
    const hasBatchId = await voterHasColumn("batch_id");
    if (!hasBatchId) {
      await query("ALTER TABLE voters ADD COLUMN batch_id INTEGER REFERENCES import_batches(id)");
    }

    const hasListNumber = await voterHasColumn("list_number");
    if (!hasListNumber) {
      await query("ALTER TABLE voters ADD COLUMN list_number INTEGER");
    }

    await query(`CREATE INDEX IF NOT EXISTS idx_batches_created ON import_batches(created_at DESC)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_voters_batch ON voters(batch_id)`);

    const batchCountResult = await query<{ c: number }>("SELECT COUNT(*) as c FROM import_batches");
    const batchCount = batchCountResult[0]?.c || 0;

    const voterNullBatchResult = await query<{ c: number }>(
      "SELECT COUNT(*) as c FROM voters WHERE batch_id IS NULL"
    );
    const voterNullBatch = voterNullBatchResult[0]?.c || 0;

    if (batchCount === 0 && voterNullBatch > 0) {
      const result = await queryOne<{ id: number }>(
        "INSERT INTO import_batches (title) VALUES ($1) RETURNING id",
        ["البيانات الحالية (قبل التصنيف)"]
      );
      const bid = result?.id;
      if (bid) {
        await query("UPDATE voters SET batch_id = $1 WHERE batch_id IS NULL", [bid]);
      }
    }
  } catch (err) {
    console.error("migration error:", err);
  }
}
