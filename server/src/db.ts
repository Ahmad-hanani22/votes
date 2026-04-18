import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import { runMigrations } from "./migrate.js";
import { autoAssignBatchesFromAreas } from "./batchFromAreas.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.SQLITE_PATH ?? path.join(__dirname, "..", "data", "app.db");

const dir = path.dirname(dbPath);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

export const db = new DatabaseSync(dbPath);

export function runTransaction<T>(fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (e) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw e;
  }
}

export function initSchema() {
  db.exec(`PRAGMA journal_mode = WAL;`);
  db.exec(`PRAGMA foreign_keys = ON;`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin','staff')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS voters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      national_id TEXT NOT NULL UNIQUE,
      status INTEGER NOT NULL DEFAULT 0 CHECK(status IN (0,1)),
      voted_at TEXT,
      area TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_voters_name ON voters(full_name COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_voters_nid ON voters(national_id);
    CREATE INDEX IF NOT EXISTS idx_voters_status ON voters(status);

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      entity TEXT NOT NULL,
      entity_id TEXT,
      details TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);
  `);

  runMigrations(db);

  try {
    autoAssignBatchesFromAreas(db);
  } catch (e) {
    console.error("autoAssignBatchesFromAreas:", e);
  }

  const count = db.prepare("SELECT COUNT(*) as c FROM users").get() as { c: number };
  if (count.c === 0) {
    const hash = bcrypt.hashSync("admin123", 10);
    db.prepare("INSERT INTO users (username, password_hash, role) VALUES (?,?,?)").run("admin", hash, "admin");
  }

  const staffRow = db.prepare("SELECT id FROM users WHERE username = ?").get("staff") as { id: number } | undefined;
  if (staffRow) {
    db.prepare("DELETE FROM audit_logs WHERE user_id = ?").run(staffRow.id);
    db.prepare("DELETE FROM users WHERE id = ?").run(staffRow.id);
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
