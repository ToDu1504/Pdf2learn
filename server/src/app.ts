import express from "express";
import cors from "cors";
import { env } from "./config/env.js";
import { sequelize } from "./config/db.js";
import { api } from "./routes/index.js";
import { errorHandler } from "./middlewares/error.js";
import { hashFile, resumePendingDocuments } from "./jobs/processDocument.js";
import { pdfPath } from "./middlewares/upload.js";
import { Document } from "./models/index.js";

/** Tài liệu cũ (trước khi có cache theo file) chưa có sha256 → tính bù để dùng được cho cache. */
async function backfillFileHashes() {
  for (const d of await Document.findAll({ where: { file_hash: null } })) {
    await d.update({ file_hash: await hashFile(pdfPath(d.file_path)).catch(() => null) });
  }
}
import { cleanupUploads } from "./services/cleanup.service.js";

export const app = express();
app.use(cors({ origin: env.CLIENT_URL }));
app.use(express.json({ limit: "1mb" }));
app.use("/api/v1", api);
app.use("/api", (_req, res) => res.status(404).json({ error: "Không tìm thấy endpoint" }));
app.use(errorHandler);

async function start() {
  try {
    await sequelize.authenticate();
    console.log("[db] connected");
  } catch (err) {
    console.error("[db] connection failed:", (err as Error).message);
    process.exit(1);
  }
  // Chỉ chạy job nền khi đã giữ được cổng: nếu đã có 1 server khác chạy (cổng bận) thì thoát,
  // tránh 2 tiến trình cùng xử lý 1 tài liệu và ghi trùng dữ liệu.
  await new Promise<void>((resolve) => {
    const server = app.listen(env.PORT, () => resolve());
    server.on("error", (err: NodeJS.ErrnoException) => {
      console.error(err.code === "EADDRINUSE" ? `[server] cổng ${env.PORT} đang bận (đã có server khác chạy), thoát.` : err);
      process.exit(1);
    });
  });
  console.log(`[server] http://localhost:${env.PORT}`);
  await cleanupUploads().catch((err) => console.error("[cleanup]", err));
  await backfillFileHashes().catch((err) => console.error("[hash]", err));
  await resumePendingDocuments();
}

if (process.env.NODE_ENV !== "test") void start();
