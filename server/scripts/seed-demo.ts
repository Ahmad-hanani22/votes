import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db, initSchema, runTransaction } from "../src/db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, "..", "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

initSchema();

const COUNT = Number(process.env.SEED_COUNT) || 500;
const insert = db.prepare(
  `INSERT OR IGNORE INTO voters (full_name, national_id, area) VALUES (?,?,?)`
);

runTransaction(() => {
  for (let i = 1; i <= COUNT; i++) {
    const nid = `DEMO-${String(i).padStart(6, "0")}`;
    insert.run(`ناخب تجريبي ${i}`, nid, i % 5 === 0 ? "منطقة أ" : i % 5 === 1 ? "منطقة ب" : "منطقة ج");
  }
});
console.log(`تم إدراج حتى ${COUNT} سجل (تجاهل المكرر national_id إن وُجد).`);
db.close();
