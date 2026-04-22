import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { queryOne } from "./db.js";
import { autoAssignBatchesFromAreas } from "./batchFromAreas.js";
import { parseVotedAt, parseVoterFromExcelRow, readVoterRowsFromBuffer } from "./excelVoters.js";

/** يُحدَّث تلقائيًا عند تغيير ملف Excel المضمّن — يعيد المزامنة عند إعادة التشغيل. */
const META_KEY = "bundled_bait_fureik_sha256";
const DATA_SEGMENTS = ["..", "data", "bait-fureik.xlsx"] as const;

export async function runBundledVotersSeed(): Promise<void> {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const filePath = path.join(__dirname, ...DATA_SEGMENTS);

  if (!existsSync(filePath)) {
    console.warn(`[seed] ملف الناخبين المضمّن غير موجود: ${filePath}`);
    return;
  }

  const buf = readFileSync(filePath);
  const checksum = createHash("sha256").update(buf).digest("hex");

  const prev = await queryOne<{ value: string }>("SELECT value FROM app_meta WHERE key = $1", [META_KEY]);
  if (prev?.value === checksum) {
    return;
  }

  let raw: Record<string, unknown>[];
  try {
    raw = readVoterRowsFromBuffer(buf);
  } catch (e) {
    console.error("[seed] فشل قراءة ملف Excel المضمّن:", e);
    return;
  }

  const normalized = new Map<
    string,
    {
      full_name: string;
      national_id: string;
      area: string | null;
      list_number: number | null;
      status: 0 | 1;
      voted_at: string | null;
    }
  >();

  for (const row of raw) {
    const parsed = parseVoterFromExcelRow(row);
    if (!parsed) continue;
    const statusRaw = row["status"] ?? row["الحالة"];
    let status: 0 | 1 = 0;
    if (statusRaw === 1 || statusRaw === "1" || String(statusRaw).includes("تم")) status = 1;
    const voted_at = status === 1 ? parseVotedAt(row["voted_at"] ?? row["وقت الانتخاب"]) : null;
    normalized.set(parsed.national_id, { ...parsed, status, voted_at });
  }

  const rows = [...normalized.values()];
  if (rows.length === 0) {
    console.warn("[seed] لا توجد صفوف صالحة في الملف المضمّن");
    return;
  }

  const chunkSize = 1000;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const valuesSql: string[] = [];
    const params: (string | number | null)[] = [];
    for (let j = 0; j < chunk.length; j++) {
      const base = j * 7;
      const r = chunk[j];
      valuesSql.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`);
      params.push(r.full_name, r.national_id, r.status, r.voted_at, r.area, null, r.list_number);
    }

    await queryOne(
      `INSERT INTO voters (full_name, national_id, status, voted_at, area, batch_id, list_number)
       VALUES ${valuesSql.join(",")}
       ON CONFLICT(national_id) DO UPDATE SET
         full_name = EXCLUDED.full_name,
         status = EXCLUDED.status,
         voted_at = EXCLUDED.voted_at,
         area = EXCLUDED.area,
         list_number = EXCLUDED.list_number,
         batch_id = COALESCE(voters.batch_id, EXCLUDED.batch_id),
         updated_at = CURRENT_TIMESTAMP`,
      params
    );
  }

  await queryOne(
    `INSERT INTO app_meta (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [META_KEY, checksum]
  );

  console.log(`✓ تم مزامنة ناخبين بيت فوريك من الملف المضمّن (${rows.length} صف فريد)`);

  await autoAssignBatchesFromAreas();
}
