import express from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import { env } from "./config/env.js";
import { sequelize } from "./config/db.js";
import { migrate } from "./db/migrate.js";
import { ensureLocalUser } from "./middlewares/auth.js";
import { api } from "./routes/index.js";
import { errorHandler } from "./middlewares/error.js";
import { hashFile, resumePendingDocuments } from "./jobs/processDocument.js";
import { startAutoPrepare } from "./services/autoPrepare.service.js";
import { pdfPath } from "./middlewares/upload.js";
import { Document } from "./models/index.js";

/** Tài liệu cũ (trước khi có cache theo file) chưa có sha256 → tính bù để dùng được cho cache. */
async function backfillFileHashes() {
  for (const d of await Document.findAll({ where: { file_hash: null } })) {
    await d.update({ file_hash: await hashFile(pdfPath(d.file_path)).catch(() => null) });
  }
}
import { cleanupUploads } from "./services/cleanup.service.js";
import { killAllChildren } from "./utils/children.js";

/**
 * Thoát sạch: kết thúc mọi tiến trình con (Python dịch, Chrome của engine), đóng SQLite. Gọi khi Electron yêu cầu
 * (tin nhắn "shutdown" / mất kênh IPC), khi nhận SIGTERM/SIGINT, hoặc khi tiến trình cha (Electron) không còn.
 */
let shuttingDown = false;
export async function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  killAllChildren();
  await sequelize.close().catch(() => {});
  process.exit(code);
}
function watchParent() {
  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
  if (process.send) {
    process.on("message", (m) => m === "shutdown" && void shutdown());
    process.on("disconnect", () => void shutdown()); // Electron đã thoát/bị tắt
  }
  const parent = Number(process.env.PDF2LEARN_PARENT_PID);
  if (parent)
    setInterval(() => {
      try {
        process.kill(parent, 0);
      } catch {
        void shutdown();
      }
    }, 5000).unref();
}

export const app = express();
app.use(cors({ origin: env.CLIENT_URL }));
app.use(express.json({ limit: "1mb" }));
app.use("/api/v1", api);
app.use("/api", (_req, res) => res.status(404).json({ error: "Không tìm thấy endpoint" }));
app.use(errorHandler);

// App desktop: server phục vụ luôn giao diện đã build (app/client/dist) cùng địa chỉ với /api → giao diện gọi
// "/api/v1" như cũ. Mọi đường dẫn khác trả index.html (giao diện tự định tuyến).
const CLIENT_DIST = process.env.CLIENT_DIST ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../client/dist");
if (existsSync(path.join(CLIENT_DIST, "index.html"))) {
  app.use(express.static(CLIENT_DIST, { index: false, maxAge: "1h" }));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(CLIENT_DIST, "index.html")));
}

async function start() {
  try {
    await sequelize.authenticate();
    await migrate(); // SQLite: tạo/cập nhật lược đồ ngay khi khởi động
    await ensureLocalUser(); // không có đăng nhập: 1 người dùng cục bộ
    console.log("[db] connected");
  } catch (err) {
    console.error("[db] connection failed:", (err as Error).message);
    process.exit(1);
  }
  // Chỉ chạy job nền khi đã giữ được cổng: nếu đã có 1 server khác chạy (cổng bận) thì thoát,
  // tránh 2 tiến trình cùng xử lý 1 tài liệu và ghi trùng dữ liệu.
  await new Promise<void>((resolve) => {
    // Chỉ nghe trên máy này: máy khác trong mạng không truy cập được.
    const server = app.listen(env.PORT, "127.0.0.1", () => resolve());
    server.on("error", (err: NodeJS.ErrnoException) => {
      console.error(err.code === "EADDRINUSE" ? `[server] cổng ${env.PORT} đang bận (đã có server khác chạy), thoát.` : err);
      process.exit(1);
    });
  });
  console.log(`[server] http://localhost:${env.PORT}`);
  process.send?.({ type: "ready", port: env.PORT }); // báo cho Electron mở cửa sổ
  await cleanupUploads().catch((err) => console.error("[cleanup]", err));
  await backfillFileHashes().catch((err) => console.error("[hash]", err));
  await resumePendingDocuments();
  startAutoPrepare(); // tự soạn trước bài giảng + tự dịch trước PDF ở nền
}

if (process.env.NODE_ENV !== "test") {
  watchParent();
  void start();
}
