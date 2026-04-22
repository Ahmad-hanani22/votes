import { Router } from "express";
import * as XLSX from "xlsx";
import { query, queryOne, runTransaction } from "../db.js";
import type { VoterRow } from "../db.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { logAudit } from "../audit.js";
import { isBundledVoterIndexLoaded, matchBundledNationalIds } from "../bundledVoterIndex.js";

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

function orderByForList(batchId: number | null): string {
  if (batchId) {
    return `(list_number IS NULL), list_number ASC, id ASC`;
  }
  return `batch_id, (list_number IS NULL), list_number ASC, id ASC`;
}

r.get("/search", async (req, res) => {
  try {
    const q = String(req.query.q ?? "").trim();
    const min = 1;
    const batchId = parseOptionalBatchId(req.query.batchId);
    if (q.length < min) {
      return res.json({ voters: [], message: `اكتب ${min} أحرف على الأقل للبحث المباشر` });
    }
    if (isBundledVoterIndexLoaded()) {
      let batchTitle: string | null = null;
      if (batchId) {
        const bt = await queryOne<{ title: string }>("SELECT title FROM import_batches WHERE id = $1", [batchId]);
        batchTitle = bt?.title?.trim() ?? null;
      }
      const orderedNids = matchBundledNationalIds(q, batchId ? batchTitle : null).slice(0, 50);
      if (orderedNids.length === 0) {
        return res.json({ voters: [] });
      }
      const batchSql = batchId ? " AND batch_id = $2" : "";
      const params: (string | number | string[])[] = [orderedNids];
      if (batchId) params.push(batchId);
      const dbRows = await query<VoterRow>(
        `SELECT ${VOTER_COLS} FROM voters
         WHERE national_id = ANY($1::text[])${batchSql}`,
        params
      );
      const m = new Map(dbRows.map((r) => [r.national_id, r]));
      const rows = orderedNids.map((id) => m.get(id)).filter((x): x is VoterRow => !!x);
      return res.json({ voters: rows });
    }
    const safe = q.replace(/%/g, "").replace(/_/g, "");
    const compact = safe.replace(/\s+/g, "");
    const compactLike = `%${compact}%`;
    const like = `%${safe}%`;
    const batchSql = batchId ? " AND batch_id = $3" : "";
    const params: (string | number)[] = [compactLike, like];
    if (batchId) params.push(batchId);
    const rows = await query<VoterRow>(
      `SELECT ${VOTER_COLS}
       FROM voters
       WHERE (full_name_nospace ILIKE $1 OR national_id_nospace ILIKE $1 OR COALESCE(area, '') ILIKE $2)${batchSql}
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

r.get("/", async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(5, Number(req.query.pageSize) || 25));
    const offset = (page - 1) * pageSize;
    const q = String(req.query.q ?? "").trim();
    const batchId = parseOptionalBatchId(req.query.batchId);
    const statusF = parseListStatusFilter(req.query.status);
    const ord = orderByForList(batchId);

    let list: VoterRow[];
    let total: number;
    
    if (q.length >= 1 && isBundledVoterIndexLoaded()) {
      let batchTitle: string | null = null;
      if (batchId) {
        const bt = await queryOne<{ title: string }>("SELECT title FROM import_batches WHERE id = $1", [batchId]);
        batchTitle = bt?.title?.trim() ?? null;
      }
      const orderedNids = matchBundledNationalIds(q, batchId ? batchTitle : null);
      if (orderedNids.length === 0) {
        list = [];
        total = 0;
      } else {
        const countParams: (string | number | string[])[] = [orderedNids];
        const countParts: string[] = ["national_id = ANY($1::text[])"];
        let cp = 2;
        if (batchId) {
          countParts.push(`batch_id = $${cp++}`);
          countParams.push(batchId);
        }
        if (statusF === "pending") countParts.push("status = 0");
        if (statusF === "voted") countParts.push("status = 1");
        const countWhere = ` WHERE ${countParts.join(" AND ")}`;
        const countSql = `SELECT COUNT(*)::int AS c FROM voters${countWhere}`;

        const pageSlice = orderedNids.slice(offset, offset + pageSize);
        const listParams: (string | number | string[])[] = [pageSlice];
        const listParts: string[] = ["national_id = ANY($1::text[])"];
        let lp = 2;
        if (batchId) {
          listParts.push(`batch_id = $${lp++}`);
          listParams.push(batchId);
        }
        if (statusF === "pending") listParts.push("status = 0");
        if (statusF === "voted") listParts.push("status = 1");
        const listWhere = ` WHERE ${listParts.join(" AND ")}`;

        const [countResult, dbRows] = await Promise.all([
          query<{ c: number }>(countSql, countParams),
          pageSlice.length === 0
            ? Promise.resolve([] as VoterRow[])
            : query<VoterRow>(`SELECT ${VOTER_COLS} FROM voters${listWhere}`, listParams),
        ]);
        total = countResult[0]?.c || 0;
        const m = new Map(dbRows.map((r) => [r.national_id, r]));
        list = pageSlice.map((id) => m.get(id)).filter((x): x is VoterRow => !!x);
      }
    } else if (q.length >= 1) {
      const safe = q.replace(/%/g, "").replace(/_/g, "");
      const compact = safe.replace(/\s+/g, "");
      const like = `%${safe}%`;
      const compactLike = `%${compact}%`;
      /** أخف على المخطّط: عمودان مفهرسان (nospace) + مركز — بدل 5× ILIKE */
      const whereParts: string[] = [
        "(full_name_nospace ILIKE $1 OR national_id_nospace ILIKE $1 OR COALESCE(area, '') ILIKE $2)",
      ];
      const whereParams: (string | number)[] = [compactLike, like];
      let paramIdx = 3;
      if (batchId) {
        whereParts.push(`batch_id = $${paramIdx}`);
        whereParams.push(batchId);
        paramIdx++;
      }
      if (statusF === "pending") whereParts.push("status = 0");
      if (statusF === "voted") whereParts.push("status = 1");
      const whereSql = ` WHERE ${whereParts.join(" AND ")}`;

      const limitParam = paramIdx;
      const offsetParam = paramIdx + 1;
      const countSql = `SELECT COUNT(*)::int AS c FROM voters${whereSql}`;
      const listSql = `SELECT ${VOTER_COLS} FROM voters${whereSql} ORDER BY ${ord} LIMIT $${limitParam} OFFSET $${offsetParam}`;

      const [countResult, listResult] = await Promise.all([
        query<{ c: number }>(countSql, whereParams),
        query<VoterRow>(listSql, [...whereParams, pageSize, offset]),
      ]);
      total = countResult[0]?.c || 0;
      list = listResult;
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

      const countSql = `SELECT COUNT(*)::int AS c FROM voters${whereSql}`;
      const listSql = `SELECT ${VOTER_COLS} FROM voters${whereSql} ORDER BY ${ord} LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`;

      const [countResult, listResult] = await Promise.all([
        query<{ c: number }>(countSql, countParams),
        query<VoterRow>(listSql, [...listParams, pageSize, offset]),
      ]);
      total = countResult[0]?.c || 0;
      list = listResult;
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

r.delete("/:id", requireAdmin, async (_req, res) => {
  res.status(403).json({ error: "غير مسموح بحذف سجلات الناخبين" });
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

r.patch("/:id/status", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "معرف غير صالح" });

    const current = await queryOne<VoterRow>("SELECT * FROM voters WHERE id = $1", [id]);
    if (!current) return res.status(404).json({ error: "غير موجود" });

    const input = Number((req.body as { status?: number }).status);
    if (input !== 0 && input !== 1) return res.status(400).json({ error: "الحالة يجب أن تكون 0 أو 1" });
    const status: 0 | 1 = input === 1 ? 1 : 0;
    const votedAt = status === 1 ? new Date().toISOString() : null;

    const updated = await queryOne<VoterRow>(
      `UPDATE voters
       SET status = $1, voted_at = $2, updated_at = CURRENT_TIMESTAMP
       WHERE id = $3
       RETURNING *`,
      [status, votedAt, id]
    );

    logAudit(req.auth!.sub, status === 1 ? "vote" : "unvote", "voter", id, { national_id: current.national_id });
    res.json({ ok: true, voter: updated });
  } catch (err) {
    console.error("set status error:", err);
    res.status(500).json({ error: "خطأ الخادم" });
  }
});

export default r;
