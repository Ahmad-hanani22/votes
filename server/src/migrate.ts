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
    // Full-text style substring search in Postgres is much faster with pg_trgm + GIN indexes.
    // Some hosted DBs disallow CREATE EXTENSION; if it fails, we just skip the indexes.
    try {
      await query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
    } catch {
      // ignore
    }

    try {
      await query(`
        CREATE INDEX IF NOT EXISTS idx_voters_full_name_trgm
          ON voters USING GIN (full_name gin_trgm_ops);
        CREATE INDEX IF NOT EXISTS idx_voters_national_id_trgm
          ON voters USING GIN (national_id gin_trgm_ops);
        CREATE INDEX IF NOT EXISTS idx_voters_area_trgm
          ON voters USING GIN (area gin_trgm_ops);
      `);
    } catch {
      // ignore
    }

    await query(`
      CREATE TABLE IF NOT EXISTS import_batches (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS app_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
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

    // Precomputed "no space" fields for fast matching without per-row REPLACE() in WHERE clauses.
    const hasFullNameNoSpace = await voterHasColumn("full_name_nospace");
    if (!hasFullNameNoSpace) {
      try {
        await query(`
          ALTER TABLE voters
            ADD COLUMN full_name_nospace TEXT GENERATED ALWAYS AS (REGEXP_REPLACE(COALESCE(full_name, ''), '\\s+', '', 'g')) STORED
        `);
      } catch {
        await query("ALTER TABLE voters ADD COLUMN full_name_nospace TEXT");
        await query("UPDATE voters SET full_name_nospace = REGEXP_REPLACE(COALESCE(full_name, ''), '\\s+', '', 'g')");
      }
    }

    const hasNationalIdNoSpace = await voterHasColumn("national_id_nospace");
    if (!hasNationalIdNoSpace) {
      try {
        await query(`
          ALTER TABLE voters
            ADD COLUMN national_id_nospace TEXT GENERATED ALWAYS AS (REGEXP_REPLACE(COALESCE(national_id, ''), '\\s+', '', 'g')) STORED
        `);
      } catch {
        await query("ALTER TABLE voters ADD COLUMN national_id_nospace TEXT");
        await query("UPDATE voters SET national_id_nospace = REGEXP_REPLACE(COALESCE(national_id, ''), '\\s+', '', 'g')");
      }
    }

    try {
      await query(
        "CREATE INDEX IF NOT EXISTS idx_voters_full_name_nospace_trgm ON voters USING GIN (full_name_nospace gin_trgm_ops)"
      );
      await query(
        "CREATE INDEX IF NOT EXISTS idx_voters_national_id_nospace_trgm ON voters USING GIN (national_id_nospace gin_trgm_ops)"
      );
    } catch {
      // ignore
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
