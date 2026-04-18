import "dotenv/config";
import express from "express";
import cors from "cors";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db, initSchema } from "./db.js";
import authRoutes from "./routes/auth.js";
import dashboardRoutes from "./routes/dashboard.js";
import votersRoutes from "./routes/voters.js";
import logsRoutes from "./routes/logs.js";
import usersRoutes from "./routes/users.js";
import batchesRoutes from "./routes/batches.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, "..", "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

initSchema();

const app = express();
const port = Number(process.env.PORT) || 4000;
const clientOrigin = process.env.CLIENT_ORIGIN ?? "http://localhost:5173";

app.use(cors({ origin: clientOrigin, credentials: true }));
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.use("/api/auth", authRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/voters", votersRoutes);
app.use("/api/logs", logsRoutes);
app.use("/api/users", usersRoutes);
app.use("/api/batches", batchesRoutes);

const clientDist = path.join(__dirname, "..", "..", "client", "dist");
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api")) return next();
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "خطأ داخلي في الخادم" });
});

const server = app.listen(port, () => {
  console.log(`API يعمل على http://localhost:${port}`);
});

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `\n[خطأ] المنفذ ${port} مستخدم — الواجهة لن تتصل بالـ API. أوقف العملية القديمة أو شغّل من جذر المشروع: npm run dev (يحرّر 4000 تلقائياً).\n`
    );
  } else {
    console.error(err);
  }
  process.exit(1);
});

process.on("SIGINT", () => {
  db.close();
  process.exit(0);
});
