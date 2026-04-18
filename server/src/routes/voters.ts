import { Router } from "express";
import multer from "multer";
import * as XLSX from "xlsx";
import { db, runTransaction } from "../db.js";
import type { VoterRow } from "../db.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { logAudit } from "../audit.js";
import { parseVotedAt, parseVoterFromExcelRow, readVoterRowsFromBuffer } from "../excelVoters.js";
import { autoAssignBatchesFromAreas, TEMP_IMPORT_BATCH_TITLE } from "../batchFromAreas.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });
const r = Router();
r.use(requireAuth);

const VOTER_COLS = `id, full_name, national_id, status, voted_at, area, created_at, updated_at, batch_id, list_number`;

function parseOptionalBatchId(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const raw = Array.isArray(v) ? v[0] : v;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** pending = لم ينتخب، voted = انتخب */
function parseListStatusFilter(v: unknown): "pending" | "voted" | null {
  const s = String(v ?? "")
    .trim()
    .toLowerCase();
  if (s === "pending" || s === "0") return "pending";
  if (s === "voted" || s === "1") return "voted";
  return null;
}

function ensureTempImportBatchId(): number {
  const row = db.prepare("SELECT id FROM import_batches WHERE title = ? LIMIT 1").get(TEMP_IMPORT_BATCH_TITLE) as
    | { id: number }
    | undefined;
  if (row) return row.id;
  const info = db.prepare("INSERT INTO import_batches (title) VALUES (?)").run(TEMP_IMPORT_BATCH_TITLE);
  return Number(info.lastInsertRowid);
}

function orderByForList(batchId: number | null): string {
  if (batchId) {
    return `(list_number IS NULL), list_number ASC, id ASC`;
  }
  return `batch_id, (list_number IS NULL), list_number ASC, id ASC`;
}

r.get("/search", (req, res) => {
  const q = String(req.query.q ?? "").trim();
  const min = 3;
  const batchId = parseOptionalBatchId(req.query.batchId);
  if (q.length < min) {
    return res.json({ voters: [], message: `اكتب ${min} أحرف على الأقل للبحث المباشر` });
  }
  const safe = q.replace(/%/g, "").replace(/_/g, "");
  const like = `%${safe}%`;
  const batchSql = batchId ? " AND batch_id = ?" : "";
  const args: unknown[] = [like, like];
  if (batchId) args.push(batchId);
  const rows = db
    .prepare(
      `SELECT ${VOTER_COLS}
       FROM voters
       WHERE (full_name LIKE ? COLLATE NOCASE OR national_id LIKE ?)${batchSql}
       ORDER BY full_name COLLATE NOCASE
       LIMIT 50`
    )
    .all(...(args as (string | number)[])) as VoterRow[];
  res.json({ voters: rows });
});

r.get("/lookup/national-id/:nid", (req, res) => {
  const nid = String(req.params.nid ?? "").trim();
  const batchId = parseOptionalBatchId(req.query.batchId);
  if (nid.length < 3) return res.status(400).json({ error: "رقم قصير جداً" });
  const batchSql = batchId ? " AND batch_id = ?" : "";
  const args: unknown[] = [nid];
  if (batchId) args.push(batchId);
  const row = db
    .prepare(`SELECT id, full_name, national_id, status, voted_at, area, batch_id, list_number FROM voters WHERE national_id = ?${batchSql}`)
    .get(...(args as (string | number)[])) as VoterRow | undefined;
  if (!row) return res.status(404).json({ error: "لا يوجد ناخب بهذا الرمز في النطاق الحالي" });
  res.json(row);
});

r.get("/export", (req, res) => {
  const batchId = parseOptionalBatchId(req.query.batchId);
  const batchSql = batchId ? " WHERE batch_id = ?" : "";
  const args: unknown[] = [];
  if (batchId) args.push(batchId);
  const rows = db
    .prepare(`SELECT ${VOTER_COLS} FROM voters${batchSql} ORDER BY ${orderByForList(batchId)}`)
    .all(...(args as (string | number)[])) as VoterRow[];
  const sheet = XLSX.utils.json_to_sheet(
    rows.map((v) => ({
      "#": v.list_number ?? "",
      id: v.id,
      full_name: v.full_name,
      "رمز الناخب": v.national_id,
      status: v.status === 1 ? "تم الانتخاب" : "لم ينتخب",
      voted_at: v.voted_at,
      "مركز التسجيل والاقتراع": v.area ?? "",
      batch_id: v.batch_id,
      created_at: v.created_at,
      updated_at: v.updated_at,
    }))
  );
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "ناخبون");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  res.setHeader("Content-Disposition", 'attachment; filename="voters-export.xlsx"');
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.send(buf);
});

r.post("/import", requireAdmin, upload.single("file"), (req, res) => {
  if (!req.file?.buffer) return res.status(400).json({ error: "لم يُرفع ملف" });
  let batchId = Number(req.body?.batchId);
  const useAutoBatch = !Number.isFinite(batchId) || batchId < 1 || String(req.body?.batchId ?? "").trim() === "auto";
  if (useAutoBatch) {
    batchId = ensureTempImportBatchId();
  } else {
    const batchOk = db.prepare("SELECT id FROM import_batches WHERE id = ?").get(batchId) as { id: number } | undefined;
    if (!batchOk) return res.status(400).json({ error: "دفعة الاستيراد غير موجودة" });
  }

  let raw: Record<string, unknown>[];
  try {
    raw = readVoterRowsFromBuffer(req.file.buffer);
  } catch {
    return res.status(400).json({ error: "ملف Excel غير صالح" });
  }
  if (raw.length === 0) return res.status(400).json({ error: "الجدول فارغ" });

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

  try {
    const { inserted, updated } = runTransaction(() => {
      let inserted = 0;
      let updated = 0;
      for (const row of raw) {
        const parsed = parseVoterFromExcelRow(row);
        if (!parsed) continue;
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
      return { inserted, updated };
    });
    logAudit(req.auth!.sub, "import", "voters", batchId, { rows: raw.length, inserted, updated });
    try {
      autoAssignBatchesFromAreas(db);
    } catch (syncErr) {
      console.error("autoAssignBatchesFromAreas after import:", syncErr);
    }
    res.json({ ok: true, rowsRead: raw.length, inserted, updated, batchId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "فشل الاستيراد";
    res.status(400).json({ error: msg });
  }
});

/** يحدّث عمود list_number فقط من ملف Excel (نفس أعمدة الاستيراد) دون تغيير حالة الانتخاب */
r.post("/sync-row-numbers", requireAdmin, upload.single("file"), (req, res) => {
  if (!req.file?.buffer) return res.status(400).json({ error: "لم يُرفع ملف" });
  let raw: Record<string, unknown>[];
  try {
    raw = readVoterRowsFromBuffer(req.file.buffer);
  } catch {
    return res.status(400).json({ error: "ملف Excel غير صالح" });
  }
  const stmt = db.prepare(
    "UPDATE voters SET list_number = ?, updated_at = datetime('now') WHERE national_id = ?"
  );
  let votersUpdated = 0;
  try {
    runTransaction(() => {
      for (const row of raw) {
        const parsed = parseVoterFromExcelRow(row);
        if (!parsed?.national_id || parsed.list_number == null) continue;
        const out = stmt.run(parsed.list_number, parsed.national_id);
        votersUpdated += Number(out.changes);
      }
    });
    logAudit(req.auth!.sub, "sync_row_numbers", "voters", null, { rowsRead: raw.length, votersUpdated });
    res.json({ ok: true, rowsRead: raw.length, votersUpdated });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "فشل التحديث";
    res.status(400).json({ error: msg });
  }
});

r.get("/", (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(5, Number(req.query.pageSize) || 25));
  const offset = (page - 1) * pageSize;
  const q = String(req.query.q ?? "").trim();
  const batchId = parseOptionalBatchId(req.query.batchId);
  const statusF = parseListStatusFilter(req.query.status);
  const statusSql = statusF === "pending" ? " AND status = 0" : statusF === "voted" ? " AND status = 1" : "";
  const batchSql = batchId ? " AND batch_id = ?" : "";
  const ord = orderByForList(batchId);

  let list: VoterRow[];
  let total: number;
  if (q.length >= 2) {
    const like = `%${q.replace(/%/g, "")}%`;
    const countArgs: unknown[] = [like, like];
    const listArgs: unknown[] = [like, like];
    if (batchId) {
      countArgs.push(batchId);
      listArgs.push(batchId);
    }
    total = (
      db
        .prepare(
          `SELECT COUNT(*) as c FROM voters WHERE (full_name LIKE ? OR national_id LIKE ?)${batchSql}${statusSql}`
        )
        .get(...(countArgs as (string | number)[])) as { c: number }
    ).c;
    listArgs.push(pageSize, offset);
    list = db
      .prepare(
        `SELECT ${VOTER_COLS}
         FROM voters WHERE (full_name LIKE ? OR national_id LIKE ?)${batchSql}${statusSql}
         ORDER BY ${ord} LIMIT ? OFFSET ?`
      )
      .all(...(listArgs as (string | number)[])) as VoterRow[];
  } else {
    const countArgs: unknown[] = [];
    const listArgs: unknown[] = [];
    const whereParts: string[] = [];
    if (batchId) {
      whereParts.push("batch_id = ?");
      countArgs.push(batchId);
      listArgs.push(batchId);
    }
    if (statusF === "pending") whereParts.push("status = 0");
    if (statusF === "voted") whereParts.push("status = 1");
    const whereSql = whereParts.length ? ` WHERE ${whereParts.join(" AND ")}` : "";
    total = (db.prepare(`SELECT COUNT(*) as c FROM voters${whereSql}`).get(...(countArgs as (string | number)[])) as {
      c: number;
    }).c;
    listArgs.push(pageSize, offset);
    list = db
      .prepare(`SELECT ${VOTER_COLS} FROM voters${whereSql} ORDER BY ${ord} LIMIT ? OFFSET ?`)
      .all(...(listArgs as (string | number)[])) as VoterRow[];
  }
  res.json({ voters: list, total, page, pageSize });
});

r.get("/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "معرف غير صالح" });
  const row = db.prepare(`SELECT ${VOTER_COLS} FROM voters WHERE id = ?`).get(id) as VoterRow | undefined;
  if (!row) return res.status(404).json({ error: "غير موجود" });
  res.json(row);
});

r.post("/", requireAdmin, (req, res) => {
  const { full_name, national_id, area, batch_id, list_number } = req.body as {
    full_name?: string;
    national_id?: string;
    area?: string;
    batch_id?: number | null;
    list_number?: number | null;
  };
  const fn = full_name?.trim();
  const nid = national_id?.trim();
  if (!fn || !nid) return res.status(400).json({ error: "الاسم والرمز مطلوبان" });
  const bid =
    batch_id != null && Number.isFinite(Number(batch_id)) && Number(batch_id) > 0 ? Number(batch_id) : null;
  if (bid) {
    const ok = db.prepare("SELECT id FROM import_batches WHERE id = ?").get(bid);
    if (!ok) return res.status(400).json({ error: "دفعة غير صالحة" });
  }
  const ln =
    list_number === undefined || list_number === null
      ? null
      : Number.isFinite(Number(list_number))
        ? Math.trunc(Number(list_number))
        : null;
  try {
    const info = db
      .prepare(`INSERT INTO voters (full_name, national_id, area, batch_id, list_number) VALUES (?,?,?,?,?)`)
      .run(fn, nid, area?.trim() || null, bid, ln);
    const newId = Number(info.lastInsertRowid);
    logAudit(req.auth!.sub, "create", "voter", newId, { national_id: nid, batch_id: bid });
    const row = db.prepare(`SELECT ${VOTER_COLS} FROM voters WHERE id = ?`).get(newId) as VoterRow;
    res.status(201).json(row);
  } catch {
    res.status(400).json({ error: "الرمز مكرر أو بيانات غير صالحة" });
  }
});

r.patch("/:id", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "معرف غير صالح" });
  const cur = db.prepare("SELECT * FROM voters WHERE id = ?").get(id) as VoterRow | undefined;
  if (!cur) return res.status(404).json({ error: "غير موجود" });
  const { full_name, national_id, area, status, list_number, batch_id } = req.body as {
    full_name?: string;
    national_id?: string;
    area?: string;
    status?: 0 | 1;
    list_number?: number | null;
    batch_id?: number | null;
  };
  const fn = full_name !== undefined ? full_name.trim() : cur.full_name;
  const nid = national_id !== undefined ? national_id.trim() : cur.national_id;
  const ar = area !== undefined ? (area.trim() || null) : cur.area;
  let st: 0 | 1 = cur.status;
  let votedAt: string | null = cur.voted_at;
  if (status !== undefined) {
    st = status === 1 ? 1 : 0;
    votedAt = st === 1 ? new Date().toISOString() : null;
  }
  const ln = list_number !== undefined ? list_number : cur.list_number;
  let bid = cur.batch_id;
  if (batch_id !== undefined) {
    bid = batch_id === null ? null : Number(batch_id);
    if (bid != null && (!Number.isFinite(bid) || bid < 1)) return res.status(400).json({ error: "دفعة غير صالحة" });
    if (bid != null) {
      const ok = db.prepare("SELECT id FROM import_batches WHERE id = ?").get(bid);
      if (!ok) return res.status(400).json({ error: "دفعة غير موجودة" });
    }
  }
  try {
    db.prepare(
      `UPDATE voters SET full_name = ?, national_id = ?, area = ?, status = ?, voted_at = ?, list_number = ?, batch_id = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(fn, nid, ar, st, votedAt, ln, bid, id);
    logAudit(req.auth!.sub, "update", "voter", id, { full_name: fn, national_id: nid, status: st });
    const row = db.prepare(`SELECT ${VOTER_COLS} FROM voters WHERE id = ?`).get(id) as VoterRow;
    res.json(row);
  } catch {
    res.status(400).json({ error: "تعارض في الرمز أو بيانات غير صالحة" });
  }
});

r.delete("/:id", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "معرف غير صالح" });
  const cur = db.prepare("SELECT * FROM voters WHERE id = ?").get(id) as VoterRow | undefined;
  if (!cur) return res.status(404).json({ error: "غير موجود" });
  db.prepare("DELETE FROM voters WHERE id = ?").run(id);
  logAudit(req.auth!.sub, "delete", "voter", id, { national_id: cur.national_id });
  res.json({ ok: true });
});

r.post("/:id/vote", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "معرف غير صالح" });
  const out = runTransaction(() => {
    const cur = db.prepare("SELECT * FROM voters WHERE id = ?").get(id) as VoterRow | undefined;
    if (!cur) return { error: "غير موجود" as const };
    if (cur.status === 1) return { error: "تم تسجيل انتخاب هذا الناخب مسبقاً", voter: cur } as const;
    const votedAt = new Date().toISOString();
    const upd = db
      .prepare(
        `UPDATE voters SET status = 1, voted_at = ?, updated_at = datetime('now')
         WHERE id = ? AND status = 0`
      )
      .run(votedAt, id);
    if (upd.changes === 0) {
      const again = db.prepare("SELECT * FROM voters WHERE id = ?").get(id) as VoterRow;
      return { error: "تم الانتخاب مسبقاً", voter: again } as const;
    }
    const row = db.prepare("SELECT * FROM voters WHERE id = ?").get(id) as VoterRow;
    return { voter: row } as const;
  });
  if ("error" in out && out.error) {
    const code = out.voter ? 409 : 404;
    return res.status(code).json({ error: out.error, voter: out.voter });
  }
  logAudit(req.auth!.sub, "vote", "voter", id, { national_id: out.voter.national_id });
  res.json({ ok: true, voter: out.voter });
});

export default r;
