import fs from "node:fs";
import * as XLSX from "xlsx";

function normalizeHeaderKey(k: string): string {
  return k
    .replace(/^\uFEFF/, "")
    .replace(/\u200e|\u200f/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function coerceRowInt(v: unknown): number | null {
  if (v === "" || v === null || v === undefined) return null;
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  const s = String(v).trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/** قراءة عمود التسلسل من Excel رغم BOM أو مسافات في اسم العمود */
function parseListNumber(row: Record<string, unknown>): number | null {
  const wanted = new Set(["#", "رقم", "تسلسل", "الرقم", "الرقم التسلسلي"]);

  for (const [key, val] of Object.entries(row)) {
    const nk = normalizeHeaderKey(key);
    if (wanted.has(nk) || nk === "#" || /^#+$/u.test(nk)) {
      const n = coerceRowInt(val);
      if (n != null) return n;
    }
  }
  return null;
}

/** يستخرج الاسم الكامل والرمز ومركز التسجيل ورقم الصف (#) من Excel بعدة تنسيقات (منها ملف بيت فوريك). */
export function parseVoterFromExcelRow(row: Record<string, unknown>): {
  full_name: string;
  national_id: string;
  area: string | null;
  list_number: number | null;
} | null {
  const centerRaw =
    row["مركز التسجيل والاقتراع"] ?? row["area"] ?? row["المنطقة"] ?? row["section"] ?? "";
  const area = String(centerRaw).trim() || null;

  const codeRaw = row["رمز الناخب"] ?? row["national_id"] ?? row["الرقم التعريفي"] ?? row["id_number"] ?? "";
  const national_id = String(codeRaw).trim();

  let full_name = String(row["full_name"] ?? row["الاسم الكامل"] ?? row["name"] ?? "").trim();
  if (!full_name) {
    const parts = [
      row["الاسم الاول"],
      row["اسم الاب"],
      row["اسم الجد"],
      row["اسم العائلة"],
    ]
      .map((x) => String(x ?? "").trim())
      .filter(Boolean);
    full_name = parts.join(" ");
  }

  if (!full_name || !national_id) return null;
  const list_number = parseListNumber(row);
  return { full_name, national_id, area, list_number };
}

export function parseVotedAt(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString();
  const s = String(v).trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toISOString();
}

export function readVoterRowsFromBuffer(buffer: Buffer): Record<string, unknown>[] {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
}

export function readVoterRowsFromPath(filePath: string): Record<string, unknown>[] {
  const buffer = fs.readFileSync(filePath);
  return readVoterRowsFromBuffer(buffer);
}
