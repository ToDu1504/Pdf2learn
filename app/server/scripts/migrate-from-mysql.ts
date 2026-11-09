/**
 * Chuyển dữ liệu của 1 tài khoản từ bản web (MySQL/MariaDB) sang app desktop (SQLite), chạy 1 lần.
 *
 *   cd app/server
 *   npx tsx scripts/migrate-from-mysql.ts --email ban@example.com [--env ../../server/.env] [--replace]
 *
 * - Đọc cấu hình MySQL (DB_*) từ file .env của bản web.
 * - Chép mọi thứ của tài khoản đó: tài liệu, text trang, lộ trình, bài học, tóm tắt/bài giảng, câu hỏi, flashcard,
 *   bài kiểm tra, gia sư, bản dịch, lượt dùng AI, cài đặt. Giữ nguyên id; user_id đổi thành người dùng cục bộ.
 * - Chép file PDF gốc và bản dịch (uploads/pdf, uploads/translated/<file_hash>) sang thư mục dữ liệu của app.
 * - App chưa có dữ liệu thì chép thẳng; đã có tài liệu thì dừng, trừ khi có --replace (xóa DB app rồi chép lại).
 */
import { cp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { QueryTypes, Sequelize } from "sequelize";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const email = arg("email");
if (!email) throw new Error("Thiếu --email <email tài khoản ở bản web>");
const webEnvFile = path.resolve(arg("env") ?? "../../server/.env");
const replace = process.argv.includes("--replace");

const web = dotenv.parse(await import("node:fs/promises").then((fs) => fs.readFile(webEnvFile, "utf8")));
const webUploads = path.resolve(path.dirname(webEnvFile), web.UPLOAD_DIR ?? "./uploads");
const mysql = new Sequelize(web.DB_NAME ?? "studyai", web.DB_USER ?? "root", web.DB_PASSWORD ?? "", {
  host: web.DB_HOST ?? "localhost",
  port: Number(web.DB_PORT ?? 3306),
  dialect: "mysql",
  logging: false,
});

// App: xóa DB cũ (nếu --replace) TRƯỚC khi nạp module kết nối SQLite.
const { env } = await import("../src/config/env.js");
if (replace) for (const f of ["", "-wal", "-shm"]) await rm(env.DB_FILE + f, { force: true });
const { sequelize: sqlite } = await import("../src/config/db.js");
const { migrate } = await import("../src/db/migrate.js");
const { ensureLocalUser, LOCAL_USER_ID } = await import("../src/middlewares/auth.js");
await migrate();
await ensureLocalUser();

const existing = (await sqlite.query("SELECT COUNT(*) AS n FROM documents", { type: QueryTypes.SELECT })) as { n: number }[];
if (existing[0].n > 0 && !replace) throw new Error("App đã có tài liệu. Chạy lại với --replace để xóa dữ liệu app và chép lại từ đầu.");

const sel = <T = Record<string, unknown>>(sql: string, replacements: Record<string, unknown> = {}) =>
  mysql.query(sql, { replacements, type: QueryTypes.SELECT }) as Promise<T[]>;

const [user] = await sel<{ id: number }>("SELECT id FROM users WHERE email = :email", { email });
if (!user) throw new Error(`Không có tài khoản ${email} trong MySQL`);
const uid = user.id;

const docs = await sel<{ id: number; file_path: string; file_hash: string | null }>("SELECT * FROM documents WHERE user_id = :uid", { uid });
const docIds = docs.map((d) => d.id);
const inDocs = docIds.length ? docIds : [-1];
const chapterIds = (await sel<{ id: number }>("SELECT id FROM chapters WHERE document_id IN (:ids)", { ids: inDocs })).map((c) => c.id);
const inChapters = chapterIds.length ? chapterIds : [-1];
const attemptIds = (await sel<{ id: number }>("SELECT id FROM quiz_attempts WHERE user_id = :uid", { uid })).map((a) => a.id);
const sessionIds = (await sel<{ id: number }>("SELECT id FROM tutor_sessions WHERE user_id = :uid", { uid })).map((s) => s.id);

// Thứ tự theo khóa ngoại. Bảng có user_id → đổi sang người dùng cục bộ.
const plan: { table: string; sql: string; params?: Record<string, unknown> }[] = [
  { table: "user_settings", sql: "SELECT * FROM user_settings WHERE user_id = :uid", params: { uid } },
  { table: "documents", sql: "SELECT * FROM documents WHERE user_id = :uid", params: { uid } },
  { table: "document_pages", sql: "SELECT * FROM document_pages WHERE document_id IN (:ids)", params: { ids: inDocs } },
  { table: "page_translations", sql: "SELECT * FROM page_translations WHERE document_id IN (:ids)", params: { ids: inDocs } },
  { table: "roadmap_sections", sql: "SELECT * FROM roadmap_sections WHERE document_id IN (:ids)", params: { ids: inDocs } },
  { table: "chapters", sql: "SELECT * FROM chapters WHERE document_id IN (:ids)", params: { ids: inDocs } },
  { table: "summaries", sql: "SELECT * FROM summaries WHERE chapter_id IN (:ids)", params: { ids: inChapters } },
  { table: "questions", sql: "SELECT * FROM questions WHERE chapter_id IN (:ids)", params: { ids: inChapters } },
  { table: "flashcards", sql: "SELECT * FROM flashcards WHERE user_id = :uid AND chapter_id IN (:ids)", params: { uid, ids: inChapters } },
  { table: "quiz_attempts", sql: "SELECT * FROM quiz_attempts WHERE user_id = :uid", params: { uid } },
  { table: "attempt_answers", sql: "SELECT * FROM attempt_answers WHERE attempt_id IN (:ids)", params: { ids: attemptIds.length ? attemptIds : [-1] } },
  { table: "tutor_sessions", sql: "SELECT * FROM tutor_sessions WHERE user_id = :uid", params: { uid } },
  { table: "tutor_messages", sql: "SELECT * FROM tutor_messages WHERE session_id IN (:ids)", params: { ids: sessionIds.length ? sessionIds : [-1] } },
  { table: "ai_usage_logs", sql: "SELECT * FROM ai_usage_logs WHERE user_id = :uid", params: { uid } },
];

const qi = sqlite.getQueryInterface();
const report: string[] = [];
await sqlite.query("PRAGMA foreign_keys = OFF"); // chép theo lô; thứ tự đã đúng, tắt để chép nhanh và tránh lỗi tạm thời
for (const { table, sql, params } of plan) {
  const columns = Object.keys(await qi.describeTable(table));
  const rows = await sel(sql, params);
  const mapped = rows.map((r) => {
    const out: Record<string, unknown> = {};
    for (const c of columns) {
      if (!(c in r)) continue;
      let v = r[c];
      if (c === "user_id") v = LOCAL_USER_ID;
      // JSON: MySQL trả object, MariaDB trả chuỗi → SQLite lưu chuỗi JSON.
      if (v !== null && typeof v === "object" && !(v instanceof Date) && !Buffer.isBuffer(v)) v = JSON.stringify(v);
      out[c] = v;
    }
    return out;
  });
  if (table === "user_settings") await qi.bulkDelete("user_settings", {});
  for (let i = 0; i < mapped.length; i += 100) await qi.bulkInsert(table, mapped.slice(i, i + 100));
  const [{ n }] = (await sqlite.query(`SELECT COUNT(*) AS n FROM ${table}`, { type: QueryTypes.SELECT })) as { n: number }[];
  report.push(`${table.padEnd(18)} MySQL ${String(rows.length).padStart(5)} → SQLite ${String(n).padStart(5)}${rows.length === n ? "" : "  ⚠ LỆCH"}`);
}
await sqlite.query("PRAGMA foreign_keys = ON");
const fkErrors = (await sqlite.query("PRAGMA foreign_key_check", { type: QueryTypes.SELECT })) as unknown[];

// File: PDF gốc + bản dịch theo file_hash.
let files = 0;
for (const d of docs) {
  const pdf = path.join(webUploads, "pdf", d.file_path);
  if (existsSync(pdf)) {
    await cp(pdf, path.join(env.UPLOAD_DIR, "pdf", d.file_path));
    files++;
  } else report.push(`⚠ thiếu file PDF của tài liệu ${d.id}: ${pdf}`);
  const tr = d.file_hash && path.join(webUploads, "translated", d.file_hash);
  if (tr && existsSync(tr)) {
    await cp(tr, path.join(env.UPLOAD_DIR, "translated", d.file_hash!), { recursive: true });
    files++;
  }
}

console.log(`Chuyển dữ liệu của ${email} → ${env.DB_FILE}\n${report.join("\n")}`);
console.log(`Khóa ngoại: ${fkErrors.length ? `${fkErrors.length} lỗi` : "hợp lệ"} · đã chép ${files} mục file sang ${env.UPLOAD_DIR}`);
await mysql.close();
await sqlite.close();
