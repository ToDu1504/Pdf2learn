import { mkdirSync } from "node:fs";
import path from "node:path";
import { Sequelize } from "sequelize";
import { env } from "./env.js";

/**
 * App desktop: toàn bộ dữ liệu trong 1 file SQLite ở thư mục dữ liệu (không cần MySQL).
 * WAL + busy_timeout: soạn bài ở nền và thao tác của người học ghi xen kẽ mà không bị "database is locked".
 */
mkdirSync(path.dirname(env.DB_FILE), { recursive: true });

export const sequelize = new Sequelize({
  dialect: "sqlite",
  storage: process.env.NODE_ENV === "test" && !process.env.DB_FILE_TEST ? ":memory:" : (process.env.DB_FILE_TEST ?? env.DB_FILE),
  logging: false,
  define: { underscored: true, createdAt: "created_at", updatedAt: "updated_at" },
});

/** Bật khóa ngoại (xóa tài liệu → xóa bài, câu hỏi, flashcard...) và chế độ ghi an toàn đồng thời. */
export async function configureSqlite() {
  await sequelize.query("PRAGMA foreign_keys = ON");
  await sequelize.query("PRAGMA journal_mode = WAL");
  await sequelize.query("PRAGMA busy_timeout = 5000");
  await sequelize.query("PRAGMA synchronous = NORMAL");
}
