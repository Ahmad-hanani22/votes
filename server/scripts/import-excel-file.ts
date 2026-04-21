/**
 * استيراد ناخبين من ملف Excel (مثل بيت فوريك).
 *
 *   npx tsx scripts/import-excel-file.ts "C:\path\file.xlsx" --title="مدرسة صبحة"
 *   npx tsx scripts/import-excel-file.ts "...\file.xlsx" --batch-id=2
 *   npx tsx scripts/import-excel-file.ts "...\file.xlsx" --title="..." --wipe
 */
import "dotenv/config";
import { db, initSchema, queryOne } from "../src/db.js";
import { parseVotedAt, parseVoterFromExcelRow, readVoterRowsFromPath } from "../src/excelVoters.js";

const filePathArg = process.argv.find((a) => a.endsWith(".xlsx") || a.endsWith(".xls"));
const wipe = process.argv.includes("--wipe");
const titleArg = process.argv.find((a) => a.startsWith("--title="))?.slice("--title=".length).trim();
const batchIdRaw = process.argv.find((a) => a.startsWith("--batch-id="))?.slice("--batch-id=".length).trim();

if (!filePathArg) {
  console.error("مرر مسار ملف Excel. مثال: --title=\"اسم الدفعة\" أو --batch-id=1");
  process.exit(1);
}
const filePath = filePathArg;

async function main() {
  await initSchema();

  if (wipe) {
    const countRow = await queryOne<{ c: number }>("SELECT COUNT(*)::int as c FROM voters");
    const n = countRow?.c ?? 0;
    await db.query("DELETE FROM voters");
    await db.query("DELETE FROM import_batches");
    console.log(`تم حذف ${n} ناخب وجميع الدفعات (--wipe).`);
  }

  let batchId: number;
  if (batchIdRaw && Number.isFinite(Number(batchIdRaw))) {
    batchId = Number(batchIdRaw);
    const ok = await queryOne<{ id: number }>("SELECT id FROM import_batches WHERE id = $1", [batchId]);
    if (!ok) {
      console.error("batch-id غير موجود");
      process.exit(1);
    }
  } else if (titleArg) {
    const created = await queryOne<{ id: number }>(
      "INSERT INTO import_batches (title) VALUES ($1) RETURNING id",
      [titleArg]
    );
    if (!created?.id) {
      console.error("تعذر إنشاء الدفعة");
      process.exit(1);
    }
    batchId = created.id;
    console.log("تم إنشاء دفعة:", batchId, titleArg);
  } else {
    console.error("حدد --title=\"عنوان الدفعة\" أو --batch-id=رقم");
    process.exit(1);
  }

  const raw = readVoterRowsFromPath(filePath);
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  await db.query("BEGIN");

  try {
    const parsedRows: Array<{
      full_name: string;
      national_id: string;
      status: 0 | 1;
      voted_at: string | null;
      area: string | null;
      batch_id: number;
      list_number: number | null;
    }> = [];

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
      parsedRows.push({ full_name, national_id, status, voted_at, area, batch_id: batchId, list_number });
    }

    const chunkSize = 500;
    for (let i = 0; i < parsedRows.length; i += chunkSize) {
      const chunk = parsedRows.slice(i, i + chunkSize);
      const placeholders: string[] = [];
      const values: Array<string | number | null> = [];

      chunk.forEach((r, idx) => {
        const base = idx * 7;
        placeholders.push(
          `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`
        );
        values.push(r.full_name, r.national_id, r.status, r.voted_at, r.area, r.batch_id, r.list_number);
      });

      const result = await db.query<{ inserted: boolean }>(
        `INSERT INTO voters (full_name, national_id, status, voted_at, area, batch_id, list_number)
         VALUES ${placeholders.join(",")}
         ON CONFLICT(national_id) DO UPDATE SET
           full_name = EXCLUDED.full_name,
           status = EXCLUDED.status,
           voted_at = EXCLUDED.voted_at,
           area = EXCLUDED.area,
           batch_id = EXCLUDED.batch_id,
           list_number = EXCLUDED.list_number,
           updated_at = CURRENT_TIMESTAMP
         RETURNING (xmax = 0) AS inserted`,
        values
      );

      for (const row of result.rows) {
        if (row.inserted) inserted++;
        else updated++;
      }
    }
    await db.query("COMMIT");
  } catch (err) {
    await db.query("ROLLBACK");
    throw err;
  }

  console.log("تم الاستيراد:", { inserted, updated, skipped, rowsRead: raw.length }, "batchId:", batchId);
  const totalRow = await queryOne<{ c: number }>("SELECT COUNT(*)::int as c FROM voters");
  console.log("إجمالي الناخبين في القاعدة الآن:", totalRow?.c ?? 0);
}

main()
  .catch((err) => {
    console.error("خطأ أثناء الاستيراد:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.end();
  });
