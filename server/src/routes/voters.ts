import { Router } from "express";
import multer from "multer";
import * as XLSX from "xlsx";
import { query, queryOne, runTransaction } from "../db.js";
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

function parseListStatusFilter(v: unknown): "pending" | "voted" | null {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "pending" || s === "0") return "pending";
  if (s === "voted" || s === "1") return "voted";
  return null;
}

async function ensureTempImportBatchId(): Promise<number> {
  const row = await queryOne<{ id: number }>(
    "SELECT id FROM import_batches WHERE title = $1 LIMIT 1",
    [TEMP_IMPORT_BATCH_TITLE]
  );
  if (row) return row.id;
  const result = await queryOne<{ id: number }>(
    "INSERT INTO import_batches (title) VALUES ($1) RETURNING id",
    [TEMP_IMPORT_BATCH_TITLE]
  );
  return result?.id || 0;
}

function orderByForList(batchId: number | null): string {
  if (batchId) {
    return `(list_number IS NULL), list_number ASC, id ASC`;
  }
  return `batch_id, (list_number IS NULL), list_number ASC, id ASC`;
}

r.get("/search", async (req, res) => {
  try {
    const q = String(req.query.q ?? "").trim();
    const min = 3;
    const batchId = parseOptionalBatchId(req.query.batchId);
    if (q.length < min) {
      return res.json({ voters: [], message: `اكتب ${min} أحرف على الأقل للبحث المباشر` });
    }
    const safe = q.replace(/%/g, "").replace(/_/g, "");
    const like = `%${safe}%`;
    const batchSql = batchId ? " AND batch_id = $3" : "";
    const params: (string | number)[] = [like, like];
    if (batchId) params.push(batchId);
    const rows = await query<VoterRow>(
      `SELECT ${VOTER_COLS}
       FROM voters
       WHERE (full_name ILIKE $1 OR national_id ILIKE $2)${batchSql}
       ORDER BY full_name COLLATE "C"
       LIMIT 50`,
      params
    );
    res.json({ voters: rows });
  } catch (err) {
    console.error("search error:", err);
    res.status(500).json({ error: "خطأ الخادم" });
  }
});

r.get("/lookup/national-id/:nid", async (req, res) => {
  try {
    const nid = String(req.params.nid ?? "").trim();
    const batchId = parseOptionalBatchId(req.query.batchId);
    if (nid.length < 3) return res.status(400).json({ error: "رقم قصير جداً" });
    
    const batchSql = batchId ? " AND batch_id = $2" : "";
    const params: (string | number)[] = [nid];
    if (batchId) params.push(batchId);
    
    const row = await queryOne<VoterRow>(
      `SELECT id, full_name, national_id, status, voted_at, area, batch_id, list_number FROM voters WHERE national_id = $1${batchSql}`,
      params
    );
    if (!row) return res.status(404).json({ error: "لا يوجد ناخب بهذا الرمز في النطاق الحالي" });
    res.json(row);
  } catch (err) {
    console.error("lookup error:", err);
    res.status(500).json({ error: "خطأ الخادم" });
  }
});

r.get("/export", async (req, res) => {
  try {
    const batchId = parseOptionalBatchId(req.query.batchId);
    const batchSql = batchId ? " WHERE batch_id = $1" : "";
    const params: (number | undefined)[] = batchId ? [batchId] : [];
    
    const rows = await query<VoterRow>(
      `SELECT ${VOTER_COLS} FROM voters${batchSql} ORDER BY ${orderByForList(batchId)}`,
      params
    );
    
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
  } catch (err) {
    console.error("export error:", err);
    res.status(500).json({ error: "خطأ الخادم" });
  }
});

r.post("/import", requireAdmin, upload.single("file"), async (req, res) => {
  try {
    if (!req.file?.buffer) return res.status(400).json({ error: "لم يُرفع ملف" });
    let batchId = Number(req.body?.batchId);
    const useAutoBatch =
      !Number.isFinite(batchId) || batchId < 1 || String(req.body?.batchId ?? "").trim() === "auto";
    
    if (useAutoBatch) {
      batchId = await ensureTempImportBatchId();
    } else {
      const batchOk = await queryOne<{ id: number }>(
        "SELECT id FROM import_batches WHERE id = $1",
        [batchId]
      );
      if (!batchOk) return res.status(400).json({ error: "دفعة الاستيراد غير موجودة" });
    }

    let raw: Record<string, unknown>[];
    try {
      raw = readVoterRowsFromBuffer(req.file.buffer);
    } catch {
      return res.status(400).json({ error: "ملف Excel غير صالح" });
    }
    if (raw.length === 0) return res.status(400).json({ error: "الجدول فارغ" });

    const { inserted, updated } = await runTransaction(async () => {
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
        
        const exists = await queryOne<{ id: number }>(
          "SELECT id FROM voters WHERE national_id = $1",
          [national_id]
        );
        
        await queryOne(
          `INSERT INTO voters (full_name, national_id, status, voted_at, area, batch_id, list_number)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT(national_id) DO UPDATE SET
             full_name = EXCLUDED.full_name,
             area = EXCLUDED.area,
             batch_id = EXCLUDED.batch_id,
             list_number = EXCLUDED.list_number,
             updated_at = CURRENT_TIMESTAMP`,
          [full_name, national_id, status, voted_at, area, batchId, list_number]
        );
        
        if (exists) updated++;
        else inserted++;
      }
      return { inserted, updated };
    });

    logAudit(req.auth!.sub, "import", "voters", batchId, { rows: raw.length, inserted, updated });
    try {
      await autoAssignBatchesFromAreas();
    } catch (syncErr) {
      console.error("autoAssignBatchesFromAreas after import:", syncErr);
    }
    res.json({ ok: true, rowsRead: raw.length, inserted, updated, batchId });
  } catch (err) {
    console.error("import error:", err);
    const msg = err instanceof Error ? err.message : "فشل الاستيراد";
    res.status(400).json({ error: msg });
  }
});

r.post("/sync-row-numbers", requireAdmin, upload.single("file"), async (req, res) => {
  try {
    if (!req.file?.buffer) return res.status(400).json({ error: "لم يُرفع ملف" });
    let raw: Record<string, unknown>[];
    try {
      raw = readVoterRowsFromBuffer(req.file.buffer);
    } catch {
      return res.status(400).json({ error: "ملف Excel غير صالح" });
    }

    let votersUpdated = 0;
    await runTransaction(async () => {
      for (const row of raw) {
        const parsed = parseVoterFromExcelRow(row);
        if (!parsed?.national_id || parsed.list_number == null) continue;
        await queryOne(
          "UPDATE voters SET list_number = $1, updated_at = CURRENT_TIMESTAMP WHERE national_id = $2",
          [parsed.list_number, parsed.national_id]
        );
        votersUpdated++;
      }
    });

    logAudit(req.auth!.sub, "sync_row_numbers", "voters", null, { rowsRead: raw.length, votersUpdated });
    res.json({ ok: true, rowsRead: raw.length, votersUpdated });
  } catch (err) {
    console.error("sync-row-numbers error:", err);
    const msg = err instanceof Error ? err.message : "فشل التحديث";
    res.status(400).json({ error: msg });
  }
});

r.get("/", async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(5, Number(req.query.pageSize) || 25));
    const offset = (page - 1) * pageSize;
    const q = String(req.query.q ?? "").trim();
    const batchId = parseOptionalBatchId(req.query.batchId);
    const statusF = parseListStatusFilter(req.query.status);
    const statusSql = statusF === "pending" ? " AND status = 0" : statusF === "voted" ? " AND status = 1" : "";
    const batchSql = batchId ? " AND batch_id = $1" : "";
    const ord = orderByForList(batchId);

    let list: VoterRow[];
    let total: number;
    
    if (q.length >= 2) {
      const like = `%${q.replace(/%/g, "")}%`;
      const countParams: (string | number)[] = [like, like];
      const listParams: (string | number)[] = [like, like];
      if (batchId) {
        countParams.push(batchId);
        listParams.push(batchId);
      }
      countParams.push(batchId || 1, offset, pageSize);
      listParams.push(pageSize, offset);

      const countResult = await query<{ c: number }>(
        `SELECT COUNT(*) as c FROM voters WHERE (full_name ILIKE $1 OR national_id ILIKE $2)${batchSql}${statusSql}`,
        countParams.slice(0, countParams.length - 3)
      );
      total = countResult[0]?.c || 0;

      list = await query<VoterRow>(
        `SELECT ${VOTER_COLS}
         FROM voters WHERE (full_name ILIKE $1 OR national_id ILIKE $2)${batchSql}${statusSql}
         ORDER BY ${ord} LIMIT $3 OFFSET $4`,
        [...listParams.slice(0, listParams.length - 2), pageSize, offset]
      );
    } else {
      const countParams: (number | undefined)[] = [];
      const listParams: (number | undefined)[] = [];
      const whereParts: string[] = [];
      let paramIdx = 1;

      if (batchId) {
        whereParts.push(`batch_id = $${paramIdx++}`);
        countParams.push(batchId);
        listParams.push(batchId);
      }
      if (statusF === "pending") whereParts.push("status = 0");
      if (statusF === "voted") whereParts.push("status = 1");

      const whereSql = whereParts.length ? ` WHERE ${whereParts.join(" AND ")}` : "";

      const countResult = await query<{ c: number }>(
        `SELECT COUNT(*) as c FROM voters${whereSql}`,
        countParams
      );
      total = countResult[0]?.c || 0;

      list = await query<VoterRow>(
        `SELECT ${VOTER_COLS} FROM voters${whereSql} ORDER BY ${ord} LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
        [...listParams, pageSize, offset]
      );
    }

    res.json({ voters: list, total, page, pageSize });
  } catch (err) {
    console.error("list voters error:", err);
    res.status(500).json({ error: "خطأ الخادم" });
  }
});

r.get("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "معرف غير صالح" });
    const row = await queryOne<VoterRow>(`SELECT ${VOTER_COLS} FROM voters WHERE id = $1`, [id]);
    if (!row) return res.status(404).json({ error: "غير موجود" });
    res.json(row);
  } catch (err) {
    console.error("get voter error:", err);
    res.status(500).json({ error: "خطأ الخادم" });
  }
});

r.post("/", requireAdmin, async (req, res) => {
  try {
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
      const ok = await queryOne<{ id: number }>("SELECT id FROM import_batches WHERE id = $1", [bid]);
      if (!ok) return res.status(400).json({ error: "دفعة غير صالحة" });
    }
    
    const ln =
      list_number === undefined || list_number === null
        ? null
        : Number.isFinite(Number(list_number))
          ? Math.trunc(Number(list_number))
          : null;
    
    const newRecord = await queryOne<VoterRow>(
      `INSERT INTO voters (full_name, national_id, area, batch_id, list_number) VALUES ($1,$2,$3,$4,$5) RETURNING ${VOTER_COLS}`,
      [fn, nid, area?.trim() || null, bid, ln]
    );
    
    logAudit(req.auth!.sub, "create", "voter", newRecord?.id || null, { national_id: nid, batch_id: bid });
    res.status(201).json(newRecord);
  } catch (err) {
    console.error("create voter error:", err);
    res.status(400).json({ error: "الرمز مكرر أو بيانات غير صالحة" });
  }
});

r.patch("/:id", requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "معرف غير صالح" });
    
    const cur = await queryOne<VoterRow>("SELECT * FROM voters WHERE id = $1", [id]);
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
        const ok = await queryOne<{ id: number }>("SELECT id FROM import_batches WHERE id = $1", [bid]);
        if (!ok) return res.status(400).json({ error: "دفعة غير موجودة" });
      }
    }
    
    const updated = await queryOne<VoterRow>(
      `UPDATE voters SET full_name = $1, national_id = $2, area = $3, status = $4, voted_at = $5, list_number = $6, batch_id = $7, updated_at = CURRENT_TIMESTAMP WHERE id = $8 RETURNING ${VOTER_COLS}`,
      [fn, nid, ar, st, votedAt, ln, bid, id]
    );
    
    logAudit(req.auth!.sub, "update", "voter", id, { full_name: fn, national_id: nid, status: st });
    res.json(updated);
  } catch (err) {
    console.error("update voter error:", err);
    res.status(400).json({ error: "تعارض في الرمز أو بيانات غير صالحة" });
  }
});

r.delete("/:id", requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "معرف غير صالح" });
    
    const cur = await queryOne<VoterRow>("SELECT * FROM voters WHERE id = $1", [id]);
    if (!cur) return res.status(404).json({ error: "غير موجود" });
    
    await queryOne("DELETE FROM voters WHERE id = $1", [id]);
    logAudit(req.auth!.sub, "delete", "voter", id, { national_id: cur.national_id });
    res.json({ ok: true });
  } catch (err) {
    console.error("delete voter error:", err);
    res.status(500).json({ error: "خطأ الخادم" });
  }
});

r.post("/:id/vote", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "معرف غير صالح" });
    
    const out = await runTransaction(async () => {
      const cur = await queryOne<VoterRow>("SELECT * FROM voters WHERE id = $1", [id]);
      if (!cur) return { error: "غير موجود" as const };
      if (cur.status === 1) return { error: "تم تسجيل انتخاب هذا الناخب مسبقاً", voter: cur } as const;
      
      const votedAt = new Date().toISOString();
      const updated = await queryOne<VoterRow>(
        `UPDATE voters SET status = 1, voted_at = $1, updated_at = CURRENT_TIMESTAMP
         WHERE id = $2 AND status = 0 RETURNING *`,
        [votedAt, id]
      );
      
      if (!updated) {
        const again = await queryOne<VoterRow>("SELECT * FROM voters WHERE id = $1", [id]);
        return { error: "تم الانتخاب مسبقاً", voter: again } as const;
      }
      return { voter: updated } as const;
    });
    
    if ("error" in out && out.error) {
      const code = out.voter ? 409 : 404;
      return res.status(code).json({ error: out.error, voter: out.voter });
    }
    
    logAudit(req.auth!.sub, "vote", "voter", id, { national_id: out.voter.national_id });
    res.json({ ok: true, voter: out.voter });
  } catch (err) {
    console.error("vote error:", err);
    res.status(500).json({ error: "خطأ الخادم" });
  }
});

export default r;
