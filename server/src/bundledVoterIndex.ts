import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseVoterFromExcelRow, readVoterRowsFromBuffer } from "./excelVoters.js";

export type BundledIdxRow = {
  national_id: string;
  full_name: string;
  area: string | null;
  list_number: number | null;
};

const DATA_SEGMENTS = ["..", "data", "bait-fureik.xlsx"] as const;

let INDEX: BundledIdxRow[] = [];
let loaded = false;

export function isBundledVoterIndexLoaded(): boolean {
  return loaded && INDEX.length > 0;
}

export function bundledVoterIndexSize(): number {
  return INDEX.length;
}

function compact(s: string): string {
  return s.replace(/\s+/g, "").replace(/[\u200c\u200f\u200e]/g, "").toLowerCase();
}

/** تحميل قائمة بيت فوريك من الملف المضمّن إلى الذاكرة (بحث سريع بدون ILIKE على الجدول الكامل). */
export function loadBundledVoterIndex(): void {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const filePath = path.join(__dirname, ...DATA_SEGMENTS);
  if (!existsSync(filePath)) {
    console.warn(`[index] ملف بيت فوريك غير موجود: ${filePath}`);
    INDEX = [];
    loaded = false;
    return;
  }
  try {
    const buf = readFileSync(filePath);
    const raw = readVoterRowsFromBuffer(buf);
    const map = new Map<string, BundledIdxRow>();
    for (const row of raw) {
      const p = parseVoterFromExcelRow(row);
      if (!p) continue;
      map.set(p.national_id, {
        national_id: p.national_id,
        full_name: p.full_name,
        area: p.area,
        list_number: p.list_number,
      });
    }
    INDEX = [...map.values()].sort((a, b) => {
      const la = a.list_number ?? 1_000_000_000;
      const lb = b.list_number ?? 1_000_000_000;
      if (la !== lb) return la - lb;
      return a.national_id.localeCompare(b.national_id, "ar");
    });
    loaded = true;
    console.log(`✓ فهرس بيت فوريك في الذاكرة: ${INDEX.length} ناخب`);
  } catch (e) {
    console.error("[index] فشل تحميل فهرس بيت فوريك:", e);
    INDEX = [];
    loaded = false;
  }
}

/**
 * يعيد national_id بالترتيب الثابت (رقم الصف ثم الرمز) لكل من يطابق النص.
 * batchAreaTitle: عنوان دفعة المدرسة من import_batches — يُقارن مع عمود area.
 */
export function matchBundledNationalIds(q: string, batchAreaTitle: string | null): string[] {
  const rawNeedle = q.replace(/%/g, "").replace(/_/g, "").trim();
  const needle = compact(rawNeedle);
  if (!needle) return [];

  const title = batchAreaTitle?.trim() || null;
  const out: string[] = [];

  for (const r of INDEX) {
    if (title) {
      const a = (r.area || "").trim();
      if (!a) continue;
      if (!(a === title || a.includes(title) || title.includes(a))) continue;
    }
    const blob = compact(r.full_name + r.national_id + (r.area || ""));
    const hit =
      blob.includes(needle) ||
      compact(r.full_name).includes(needle) ||
      compact(r.national_id).includes(needle) ||
      (r.area || "").includes(rawNeedle);
    if (hit) out.push(r.national_id);
  }
  return out;
}
