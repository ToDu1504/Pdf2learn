import { readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { Document } from "../models/index.js";
import { PDF_DIR } from "../middlewares/upload.js";

const GRACE_MS = 60 * 60 * 1000; // bỏ qua file mới tạo < 1 giờ (có thể đang upload/ghi dở)

async function removeUntracked(dir: string, tracked: Set<string>) {
  let removed = 0;
  let bytes = 0;
  for (const name of await readdir(dir).catch(() => [] as string[])) {
    if (tracked.has(name)) continue;
    const file = path.join(dir, name);
    const s = await stat(file).catch(() => null);
    if (!s?.isFile() || Date.now() - s.mtimeMs < GRACE_MS) continue;
    await unlink(file).catch(() => {});
    removed++;
    bytes += s.size;
  }
  return { removed, bytes };
}

/** Dọn ổ đĩa khi server khởi động: xóa file PDF không còn bản ghi nào trong DB trỏ tới (mồ côi). */
export async function cleanupUploads() {
  const pdfs = new Set((await Document.findAll({ attributes: ["file_path"], raw: true })).map((d) => d.file_path));
  const pdf = await removeUntracked(PDF_DIR, pdfs);
  if (pdf.removed) console.log(`[cleanup] xóa ${pdf.removed} PDF mồ côi (${(pdf.bytes / 1024 / 1024).toFixed(1)} MB)`);
}
