/**
 * استيراد ناخبين من ملف Excel (مثل بيت فوريك).
 *
 *   npx tsx scripts/import-excel-file.ts "C:\path\file.xlsx" --title="مدرسة صبحة"
 *   npx tsx scripts/import-excel-file.ts "...\file.xlsx" --batch-id=2
 *   npx tsx scripts/import-excel-file.ts "...\file.xlsx" --title="..." --wipe
 */
import "dotenv/config";
import { db, initSchema, runTransaction } from "../src/db.js";
import { parseVotedAt, parseVoterFromExcelRow, readVoterRowsFromPath } from "../src/excelVoters.js";

const filePath = process.argv.find((a) => a.endsWith(".xlsx") || a.endsWith(".xls"));
const wipe = process.argv.includes("--wipe");
const titleArg = process.argv.find((a) => a.startsWith("--title="))?.slice("--title=".length).trim();
const batchIdRaw = process.argv.find((a) => a.startsWith("--batch-id="))?.slice("--batch-id=".length).trim();

if (!filePath) {
  console.error("مرر مسار ملف Excel. مثال: --title=\"اسم الدفعة\" أو --batch-id=1");
  process.exit(1);
}

initSchema();

if (wipe) {
  const n = (db.prepare("SELECT COUNT(*) as c FROM voters").get() as { c: number }).c;
  db.exec("DELETE FROM voters");
  db.exec("DELETE FROM import_batches");
  console.log(`تم حذف ${n} ناخب وجميع الدفعات (--wipe).`);
}

let batchId: number;
if (batchIdRaw && Number.isFinite(Number(batchIdRaw))) {
  batchId = Number(batchIdRaw);
  const ok = db.prepare("SELECT id FROM import_batches WHERE id = ?").get(batchId);
  if (!ok) {
    console.error("batch-id غير موجود");
    process.exit(1);
  }
} else if (titleArg) {
  const info = db.prepare("INSERT INTO import_batches (title) VALUES (?)").run(titleArg);
  batchId = Number(info.lastInsertRowid);
  console.log("تم إنشاء دفعة:", batchId, titleArg);
} else {
  console.error("حدد --title=\"عنوان الدفعة\" أو --batch-id=رقم");
  process.exit(1);
}

const raw = readVoterRowsFromPath(filePath);
const insert = db.prepare(
  `INSERT INTO voters (full_name, national_id, status, voted_at, area, batch_id, list_number)
   VALUES (?,?,?,?,?,?,?)
   ON CONFLICT(national_id) DO UPDATE SET
     full_name = excluded.full_name,
     area = excluded.area,
     batch_id = excluded.batch_id,
     list_number = excluded.list_number,
     updated_at = datetime('now')`
);

const stats = runTransaction(() => {
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  for (const row of raw) {
    const parsed = parseVoterFromExcelRow(row);
    if (!parsed) {
      skipped++;
      continue;
    }
    const { full_name, national_id, area, list_number } = parsed;
    const statusRaw = row["status"] ?? row["الحالة"];
    let status: 0 | 1 = 0;
    if (statusRaw === 1 || statusRaw === "1" || String(statusRaw).includes("تم")) status = 1;
    const voted_at = status === 1 ? parseVotedAt(row["voted_at"] ?? row["وقت الانتخاب"]) : null;
    const exists = db.prepare("SELECT id FROM voters WHERE national_id = ?").get(national_id);
    insert.run(full_name, national_id, status, voted_at, area, batchId, list_number);
    if (exists) updated++;
    else inserted++;
  }
  return { inserted, updated, skipped, rowsRead: raw.length };
});

console.log("تم الاستيراد:", stats, "batchId:", batchId);
const total = (db.prepare("SELECT COUNT(*) as c FROM voters").get() as { c: number }).c;
console.log("إجمالي الناخبين في القاعدة الآن:", total);

db.close();
