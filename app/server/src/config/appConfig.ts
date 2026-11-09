import { existsSync, readFileSync } from "node:fs";
import { rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "./env.js";
import { translatorInfo } from "../services/translate/translatorPaths.js";

/**
 * Cấu hình của app desktop (thay cho file .env): data/config.json.
 *   - Gemini API key được MÃ HÓA bằng safeStorage của Electron (gắn với tài khoản Windows) — server nhờ tiến trình
 *     chính của Electron mã hóa/giải mã qua kênh IPC. Chạy không có Electron (phát triển) thì lưu dạng thường.
 *   - Model chính + model dự phòng.
 * Khi khởi động và mỗi lần lưu, giá trị được áp vào `env` để các dịch vụ AI dùng ngay, không cần khởi động lại.
 */
type Stored = {
  gemini_api_key_enc?: string;
  gemini_api_key?: string;
  gemini_model?: string;
  gemini_fallback_models?: string;
};

export const DEFAULT_MODEL = "gemini-3.8-flash";
export const DEFAULT_FALLBACK_MODELS = "gemini-3.7-flash,gemini-3.6-flash,gemini-3.5-flash,gemini-3.5-flash-lite,gemini-3.1-flash-lite";

const FILE = () => path.join(env.DATA_DIR, "config.json");

/* ---------- nhờ Electron mã hóa (safeStorage) ---------- */

let seq = 0;
const pending = new Map<number, { resolve: (v: string) => void; reject: (e: Error) => void }>();
if (process.send)
  process.on("message", (m: { type?: string; id?: number; value?: string; error?: string }) => {
    if (m?.type !== "secret-result" || m.id == null) return;
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    if (m.error) p.reject(new Error(m.error));
    else p.resolve(m.value ?? "");
  });

export const canEncrypt = () => !!process.send;

function secret(op: "encrypt" | "decrypt", value: string): Promise<string> {
  if (!process.send) return Promise.reject(new Error("Không có Electron để mã hóa"));
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    process.send!({ type: "secret", id, op, value });
    setTimeout(() => pending.delete(id) && reject(new Error("Electron không phản hồi")), 10_000).unref();
  });
}

/* ---------- đọc / ghi ---------- */

function read(): Stored {
  try {
    return existsSync(FILE()) ? (JSON.parse(readFileSync(FILE(), "utf8")) as Stored) : {};
  } catch {
    return {};
  }
}

/** Đọc config.json và áp vào env (gọi khi khởi động). Giá trị trong config.json ưu tiên hơn biến môi trường. */
export async function loadAppConfig() {
  const c = read();
  let key = c.gemini_api_key ?? "";
  if (c.gemini_api_key_enc) key = await secret("decrypt", c.gemini_api_key_enc).catch(() => "");
  if (key) env.GEMINI_API_KEY = key;
  env.GEMINI_MODEL = c.gemini_model || env.GEMINI_MODEL || DEFAULT_MODEL;
  env.GEMINI_FALLBACK_MODELS = c.gemini_fallback_models ?? (env.GEMINI_FALLBACK_MODELS || DEFAULT_FALLBACK_MODELS);
}

export async function saveAppConfig(patch: { gemini_api_key?: string; gemini_model?: string; gemini_fallback_models?: string }) {
  const c = read();
  if (patch.gemini_api_key !== undefined) {
    delete c.gemini_api_key;
    delete c.gemini_api_key_enc;
    if (patch.gemini_api_key) {
      if (canEncrypt()) c.gemini_api_key_enc = await secret("encrypt", patch.gemini_api_key);
      else c.gemini_api_key = patch.gemini_api_key;
    }
    env.GEMINI_API_KEY = patch.gemini_api_key;
  }
  if (patch.gemini_model !== undefined) env.GEMINI_MODEL = c.gemini_model = patch.gemini_model;
  if (patch.gemini_fallback_models !== undefined) env.GEMINI_FALLBACK_MODELS = c.gemini_fallback_models = patch.gemini_fallback_models;
  const tmp = `${FILE()}.tmp`;
  await writeFile(tmp, JSON.stringify(c, null, 2), "utf8");
  await rename(tmp, FILE());
}

/** Trạng thái để giao diện hiển thị (không bao giờ trả key ra ngoài, chỉ 4 ký tự cuối). */
export function appConfigStatus() {
  const c = read();
  const key = env.GEMINI_API_KEY;
  return {
    configured: !!key && !!env.GEMINI_MODEL,
    key_hint: key ? `…${key.slice(-4)}` : null,
    key_encrypted: !!c.gemini_api_key_enc,
    gemini_model: env.GEMINI_MODEL,
    gemini_fallback_models: env.GEMINI_FALLBACK_MODELS,
    data_dir: env.DATA_DIR,
    /** Gói dịch (dịch PDF giữ bố cục): đã cài chưa, phiên bản. */
    translator: translatorInfo(),
  };
}
