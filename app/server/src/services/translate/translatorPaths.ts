import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { env } from "../../config/env.js";

/**
 * Engine dịch (VI-Translate + Python) của app desktop:
 *   1. Gói dịch đã cài: <thư mục dữ liệu>/translator/pdf2learn-translator (Python độc lập + VI-Translate + mô hình).
 *   2. (Phát triển) bản clone có venv ở VI_TRANSLATE_DIR.
 * Tính lại mỗi lần gọi: cài/gỡ gói dịch có hiệu lực ngay, không cần khởi động lại.
 */
export const TRANSLATOR_DIR = () => path.join(env.DATA_DIR, "translator");
const PACK = () => path.join(TRANSLATOR_DIR(), "pdf2learn-translator");

export type TranslatorPaths = { root: string; python: string; cli: string; home: string; source: "pack" | "dev" };

export function translatorPaths(): TranslatorPaths | null {
  const pack = PACK();
  const packPython = path.join(pack, "python", "python.exe");
  if (existsSync(packPython))
    return { root: path.join(pack, "vi-translate"), python: packPython, cli: path.join(pack, "vi-translate", "scripts", "translate_pdf.py"), home: path.join(pack, "home"), source: "pack" };
  const dev = path.resolve(env.VI_TRANSLATE_DIR);
  const devPython = path.join(dev, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  if (existsSync(devPython)) return { root: dev, python: devPython, cli: path.join(dev, "scripts", "translate_pdf.py"), home: path.join(dev, ".home"), source: "dev" };
  return null;
}

/** Thông tin gói dịch đã cài (pack.json), để hiện trong Cài đặt. */
export function translatorInfo() {
  const p = translatorPaths();
  if (!p) return { installed: false as const };
  let pack: Record<string, unknown> | null = null;
  try {
    pack = JSON.parse(readFileSync(path.join(PACK(), "pack.json"), "utf8"));
  } catch {
    /* bản phát triển: không có pack.json */
  }
  return { installed: true as const, source: p.source, version: (pack?.version as string) ?? null, vi_translate_commit: (pack?.vi_translate_commit as string) ?? null };
}
