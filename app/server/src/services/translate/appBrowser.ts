import { randomBytes } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { env } from "../../config/env.js";

/**
 * Dịch Google BÊN TRONG APP thay vì mở Chrome: engine VI-Translate (Python, đã vá trong pyhooks/sitecustomize.py)
 * gửi từng lượt dịch tới endpoint nội bộ này → chuyển qua IPC cho Electron → Electron tải trang Google Dịch trong một
 * cửa sổ ẩn; Google đòi CAPTCHA thì cửa sổ đó hiện lên trong app cho người dùng giải.
 * Chỉ có khi server chạy dưới Electron (process.send). Bản web vẫn dùng Chrome/Edge như cũ.
 */
export const appBrowserAvailable = () => !!process.send;

const TOKEN = randomBytes(16).toString("hex");
const JOB_TIMEOUT_MS = 12 * 60_000; // Electron tự chờ CAPTCHA tối đa 10 phút
let seq = 0;
const pending = new Map<number, { resolve: (text: string) => void; reject: (err: Error) => void }>();

if (process.send)
  process.on("message", (m: { type?: string; id?: number; text?: string; error?: string }) => {
    if (m?.type !== "gt-result" || m.id == null) return;
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    if (m.error != null) p.reject(new Error(m.error));
    else p.resolve(m.text ?? "");
  });

function appTranslate(params: Record<string, string>): Promise<string> {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    process.send!({ type: "gt", id, params });
    setTimeout(() => pending.delete(id) && reject(new Error("App không trả lời lượt dịch")), JOB_TIMEOUT_MS).unref();
  });
}

/** Biến môi trường cho tiến trình Python: có thì engine dịch qua app, không mở Chrome. */
export function appBrowserEnv(): Record<string, string> {
  if (!appBrowserAvailable()) return {};
  return { PDF2LEARN_GT_URL: `http://127.0.0.1:${env.PORT}/api/v1/internal/google-translate`, PDF2LEARN_GT_TOKEN: TOKEN };
}

export const internalRoutes = Router();

internalRoutes.post("/google-translate", async (req, res) => {
  if (!appBrowserAvailable() || req.get("x-pdf2learn-token") !== TOKEN) return void res.status(403).json({ error: "forbidden" });
  const { params } = z.object({ params: z.record(z.string(), z.string()) }).parse(req.body);
  try {
    res.json({ text: await appTranslate(params) });
  } catch (err) {
    res.json({ error: (err as Error).message });
  }
});
