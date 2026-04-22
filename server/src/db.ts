import pkg from "pg";
import bcrypt from "bcryptjs";
import { runMigrations } from "./migrate.js";
import { autoAssignBatchesFromAreas } from "./batchFromAreas.js";
import { runBundledVotersSeed } from "./bundledVotersSeed.js";
import { loadBundledVoterIndex } from "./bundledVoterIndex.js";

const { Pool } = pkg;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL environment variable is required");
}

export const db = new Pool({
  connectionString,
  max: Number(process.env.PG_POOL_MAX) || 25,
  ssl:
    process.env.DATABASE_SSL === "true" ||
    process.env.NODE_ENV === "production" ||
    connectionString.includes("render.com")
      ? { rejectUnauthorized: false }
      : false,
});

db.on("error", (err: Error) => {
  console.error("Unexpected error on idle client", err);
});

export async function query<T = any>(text: string, params?: unknown[]): Promise<T[]> {
  const res = await db.query(text, params);
  return res.rows as T[];
}

export async function queryOne<T = any>(text: string, params?: unknown[]): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] || null;
}

export async function runTransaction<T>(fn: () => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await fn();
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}


export async function initSchema() {
  try {
    // Create tables
    await db.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('admin','staff')),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS voters (
        id SERIAL PRIMARY KEY,
        full_name TEXT NOT NULL,
        national_id TEXT NOT NULL UNIQUE,
        status INTEGER NOT NULL DEFAULT 0 CHECK(status IN (0,1)),
        voted_at TIMESTAMP,
        area TEXT,
        batch_id INTEGER,
        list_number INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS audit_logs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        action TEXT NOT NULL,
        entity TEXT NOT NULL,
        entity_id TEXT,
        details TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS import_batches (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create indices
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_voters_name ON voters(full_name);
      CREATE INDEX IF NOT EXISTS idx_voters_nid ON voters(national_id);
      CREATE INDEX IF NOT EXISTS idx_voters_status ON voters(status);
      CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_voters_batch ON voters(batch_id);
      CREATE INDEX IF NOT EXISTS idx_batches_created ON import_batches(created_at DESC);
    `);

    await runMigrations();

    await runBundledVotersSeed();
    loadBundledVoterIndex();

    // Run area-to-batch syncing in background so API startup is not blocked.
    void autoAssignBatchesFromAreas().catch((e) => {
      console.error("autoAssignBatchesFromAreas:", e);
    });

    const defaultUsername = "ahmad_hanani";
    const defaultPassword = "123456789";
    const hash = bcrypt.hashSync(defaultPassword, 10);
    await db.query(
      `INSERT INTO users (username, password_hash, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (username)
       DO UPDATE SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role`,
      [defaultUsername, hash, "admin"]
    );
    console.log(`✓ Default admin user ensured (username: ${defaultUsername})`);

    const staffRow = await queryOne<{ id: number }>("SELECT id FROM users WHERE username = $1", ["staff"]);
    if (staffRow?.id) {
      await db.query("DELETE FROM audit_logs WHERE user_id = $1", [staffRow.id]);
      await db.query("DELETE FROM users WHERE id = $1", [staffRow.id]);
    }

    console.log("✓ Database schema initialized successfully");
  } catch (err) {
    console.error("Error initializing schema:", err);
    throw err;
  }
}

export type UserRow = {
  id: number;
  username: string;
  password_hash: string;
  role: "admin" | "staff";
  created_at: string;
};

export type VoterRow = {
  id: number;
  full_name: string;
  national_id: string;
  status: 0 | 1;
  voted_at: string | null;
  area: string | null;
  created_at: string;
  updated_at: string;
  batch_id: number | null;
  list_number: number | null;
};
