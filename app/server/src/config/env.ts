import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

/** Thư mục dữ liệu của app (DB SQLite, PDF, bản dịch, gói dịch, cache). Mặc định: app/data. */
const DEFAULT_DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../data");

const schema = z.object({
  PORT: z.coerce.number().default(5000),
  CLIENT_URL: z.string().default("http://localhost:5173"),
  DATA_DIR: z.string().default(DEFAULT_DATA_DIR),
  JWT_SECRET: z.string().default("pdf2learn-desktop"),
  JWT_EXPIRES_IN: z.string().default("7d"),
  GEMINI_API_KEY: z.string().default(""),
  GEMINI_MODEL: z.string().default(""),
  // Model dự phòng khi model chính hết hạn mức ngày (mỗi model có hạn mức riêng ở gói miễn phí).
  GEMINI_FALLBACK_MODELS: z.string().default("gemini-3.7-flash,gemini-3.6-flash,gemini-3.5-flash,gemini-3.5-flash-lite,gemini-3.1-flash-lite"),
  GEMINI_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(3),
  GEMINI_THINKING: z.enum(["minimal", "low", "high", "default"]).default("low"),
  // Gộp nhiều chương vào 1 lượt gọi Gemini (chương đang mở + các chương kế tiếp).
  BATCH_MAX_CHAPTERS: z.coerce.number().int().min(1).max(10).default(5),
  BATCH_MAX_CHARS: z.coerce.number().int().min(20_000).default(350_000),
  UPLOAD_DIR: z.string().optional(),
  MAX_UPLOAD_MB: z.coerce.number().default(50),
  // VI-Translate (dịch PDF giữ bố cục), clone vào thư mục này + .venv. Không có thì tab Bản dịch dùng Gemini dịch chữ.
  VI_TRANSLATE_DIR: z.string().default("../vi-translate"),
  TRANSLATE_BROWSER: z.enum(["chrome", "edge", "brave", "coccoc", "firefox"]).default("chrome"),
});

const parsed = schema.parse(process.env);

// Giá trị mẫu từ .env.example coi như chưa cấu hình.
const placeholder = (v: string) => (/^your_/.test(v) ? "" : v);

const DATA_DIR = path.resolve(parsed.DATA_DIR);

export const env = {
  ...parsed,
  DATA_DIR,
  /** File SQLite chứa toàn bộ dữ liệu học. */
  DB_FILE: path.join(DATA_DIR, "pdf2learn.db"),
  UPLOAD_DIR: parsed.UPLOAD_DIR ?? path.join(DATA_DIR, "uploads"),
  GEMINI_API_KEY: placeholder(parsed.GEMINI_API_KEY),
  GEMINI_MODEL: placeholder(parsed.GEMINI_MODEL),
};
