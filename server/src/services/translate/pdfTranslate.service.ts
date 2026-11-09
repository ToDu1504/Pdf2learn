import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { env } from "../../config/env.js";
import { pdfPath } from "../../middlewares/upload.js";
import type { Document } from "../../models/index.js";
import { translateSegments } from "./segmentTranslator.js";

/**
 * Dịch PDF sang tiếng Việt GIỮ NGUYÊN BỐ CỤC bằng VI-Translate (https://github.com/breslee1707/VI-Translate,
 * clone vào vi-translate/, gitignored). Dịch theo cụm CHUNK trang, chỉ khi người dùng mở tab Bản dịch:
 *   1. Cắt cụm trang ra PDF nhỏ (PyMuPDF) → engine chạy nhanh, file ra nhỏ.
 *   2. Engine chế độ handoff xuất các đoạn cần dịch (JSONL).
 *   3. Server dịch các đoạn (Google, dự phòng Gemini) — segmentTranslator.
 *   4. Engine dựng lại PDF với bản dịch, giữ hình, bảng, công thức.
 * Kết quả lưu ở uploads/translated/<file_hash>/c<k>.pdf, dùng chung cho mọi tài liệu cùng file.
 */

export const CHUNK = 10;
const ROOT = path.resolve(env.VI_TRANSLATE_DIR);
const PYTHON = path.join(ROOT, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
const CLI = path.join(ROOT, "scripts", "translate_pdf.py");
const CHUNK_SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../scripts/pdf_chunk.py");
const OUT_DIR = path.resolve(env.UPLOAD_DIR, "translated");
const run = promisify(execFile);

export const isPdfTranslatorInstalled = () => existsSync(PYTHON) && existsSync(CLI);

export type ChunkPhase = "queued" | "extracting" | "translating" | "building" | "ready" | "error";
export type ChunkStatus = { chunk: number; from: number; to: number; phase: ChunkPhase; done: number; total: number; error?: string };

const state = new Map<string, ChunkStatus>(); // key = `${fileKey}:${chunk}`
const queue: { key: string; job: () => Promise<void> }[] = [];
let busy = false;

const fileKey = (doc: Document) => doc.file_hash ?? `doc${doc.id}`;
export const chunkOf = (page: number) => Math.floor((page - 1) / CHUNK);
export const chunkFile = (doc: Document, chunk: number) => path.join(OUT_DIR, fileKey(doc), `c${chunk}.pdf`);

function bounds(doc: Document, chunk: number) {
  const from = chunk * CHUNK + 1;
  return { from, to: Math.min(from + CHUNK - 1, doc.page_count ?? from + CHUNK - 1) };
}

/** Engine ghi cache/model vào thư mục home: trỏ sang vi-translate/.home để không chiếm ổ C. */
function pyEnv() {
  const home = path.join(ROOT, ".home");
  return { ...process.env, USERPROFILE: home, HOME: home, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" };
}

async function py(args: string[]) {
  try {
    return await run(PYTHON, args, { env: pyEnv(), maxBuffer: 32 * 1024 * 1024, timeout: 15 * 60_000, windowsHide: true });
  } catch (err) {
    const e = err as { stderr?: string; stdout?: string; message: string };
    const line = `${e.stderr ?? ""}\n${e.stdout ?? ""}`.split("\n").find((l) => l.startsWith("error:"));
    throw new Error(line ?? e.message);
  }
}

async function translateChunk(doc: Document, chunk: number, userId: number, st: ChunkStatus) {
  const work = path.join(OUT_DIR, fileKey(doc), `work-c${chunk}`);
  await rm(work, { recursive: true, force: true });
  await mkdir(work, { recursive: true });
  const part = path.join(work, "part.pdf");
  const segs = path.join(work, "segments.jsonl");
  const trans = path.join(work, "translations.jsonl");
  const target = chunkFile(doc, chunk);
  try {
    st.phase = "extracting";
    await py([CHUNK_SCRIPT, pdfPath(doc.file_path), String(st.from), String(st.to), part]);
    try {
      await py([CLI, part, "--engine", "handoff", "--emit-segments", segs]);
    } catch (err) {
      // Cụm toàn trang ảnh / mục lục / chỉ mục: không có gì để dịch → giữ bản gốc.
      if (/No text could be extracted|nothing to translate/i.test((err as Error).message)) {
        await copyFile(part, target);
        return;
      }
      throw err;
    }
    const srcs = existsSync(segs)
      ? (await readFile(segs, "utf8"))
          .split("\n")
          .filter((l) => l.trim())
          .map((l) => (JSON.parse(l) as { src: string }).src)
      : [];
    if (!srcs.length) {
      await copyFile(part, target);
      return;
    }

    st.phase = "translating";
    const map = await translateSegments(srcs, userId, (done, total) => Object.assign(st, { done, total }));
    await writeFile(trans, [...map].map(([src, dst]) => JSON.stringify({ src, dst })).join("\n") + "\n", "utf8");

    st.phase = "building";
    await py([CLI, part, "--engine", "handoff", "--segments", trans, "--emit-segments", path.join(work, "missing.jsonl"), "--output-dir", work, "--overwrite"]);
    await rename(path.join(work, "part-vi.pdf"), target);
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

async function pump() {
  if (busy) return;
  const next = queue.shift();
  if (!next) return;
  busy = true;
  try {
    await next.job();
  } finally {
    busy = false;
    void pump();
  }
}

/** Trạng thái cụm chứa `page`; chưa dịch thì đưa vào hàng đợi (lần lượt từng cụm, tránh bị Google chặn). */
export function requestChunk(doc: Document, page: number, userId: number, retry = false): ChunkStatus {
  const chunk = chunkOf(page);
  const { from, to } = bounds(doc, chunk);
  if (existsSync(chunkFile(doc, chunk))) return { chunk, from, to, phase: "ready", done: 0, total: 0 };

  const key = `${fileKey(doc)}:${chunk}`;
  const cur = state.get(key);
  // Lỗi giữ nguyên cho tới khi người dùng bấm thử lại (client hỏi trạng thái liên tục).
  if (cur && (cur.phase !== "error" || !retry)) return cur;

  const st: ChunkStatus = { chunk, from, to, phase: "queued", done: 0, total: 0 };
  state.set(key, st);
  queue.push({
    key,
    job: async () => {
      try {
        await mkdir(path.dirname(chunkFile(doc, chunk)), { recursive: true });
        await translateChunk(doc, chunk, userId, st);
        state.delete(key);
      } catch (err) {
        console.error(`[translate ${key}]`, err);
        Object.assign(st, { phase: "error", error: (err as Error).message });
      }
    },
  });
  void pump();
  return st;
}
