import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().default(5000),
  CLIENT_URL: z.string().default("http://localhost:5173"),
  DB_HOST: z.string().default("localhost"),
  DB_PORT: z.coerce.number().default(3306),
  DB_NAME: z.string().default("studyai"),
  DB_USER: z.string().default("root"),
  DB_PASSWORD: z.string().default(""),
  JWT_SECRET: z.string().min(1),
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
  UPLOAD_DIR: z.string().default("./uploads"),
  MAX_UPLOAD_MB: z.coerce.number().default(50),
  // VI-Translate (dịch PDF giữ bố cục), clone vào thư mục này + .venv. Không có thì tab Bản dịch dùng Gemini dịch chữ.
  VI_TRANSLATE_DIR: z.string().default("../vi-translate"),
  TRANSLATE_BROWSER: z.enum(["chrome", "edge", "brave", "coccoc", "firefox"]).default("chrome"),
});

const parsed = schema.parse(process.env);

// Giá trị mẫu từ .env.example coi như chưa cấu hình.
const placeholder = (v: string) => (/^your_/.test(v) ? "" : v);

export const env = {
  ...parsed,
  GEMINI_API_KEY: placeholder(parsed.GEMINI_API_KEY),
  GEMINI_MODEL: placeholder(parsed.GEMINI_MODEL),
};
