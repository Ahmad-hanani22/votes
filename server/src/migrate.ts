import type { DatabaseSync } from "node:sqlite";

function voterHasColumn(db: DatabaseSync, col: string) {
  const rows = db.prepare("PRAGMA table_info(voters)").all() as { name: string }[];
  return rows.some((c) => c.name === col);
}

/** ترقية مخطط قاعدة موجودة (دفعات استيراد + رقم الصف من Excel). */
export function runMigrations(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS import_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_batches_created ON import_batches(created_at DESC);
  `);

  if (!voterHasColumn(db, "batch_id")) {
    db.exec("ALTER TABLE voters ADD COLUMN batch_id INTEGER REFERENCES import_batches(id)");
  }
  if (!voterHasColumn(db, "list_number")) {
    db.exec("ALTER TABLE voters ADD COLUMN list_number INTEGER");
  }

  db.exec(`CREATE INDEX IF NOT EXISTS idx_voters_batch ON voters(batch_id);`);

  const batchCount = (db.prepare("SELECT COUNT(*) as c FROM import_batches").get() as { c: number }).c;
  const voterNullBatch = (
    db.prepare("SELECT COUNT(*) as c FROM voters WHERE batch_id IS NULL").get() as { c: number }
  ).c;

  if (batchCount === 0 && voterNullBatch > 0) {
    const info = db.prepare("INSERT INTO import_batches (title) VALUES (?)").run("البيانات الحالية (قبل التصنيف)");
    const bid = Number(info.lastInsertRowid);
    db.prepare("UPDATE voters SET batch_id = ? WHERE batch_id IS NULL").run(bid);
  }
}
