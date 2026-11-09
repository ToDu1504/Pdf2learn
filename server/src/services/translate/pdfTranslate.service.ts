import { execFile, spawn } from "node:child_process";
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
 * clone vào vi-translate/, gitignored). Dịch theo cụm CHUNK trang, chỉ khi người dùng mở tab Bản dịch,
 * và dịch sẵn cụm kế tiếp ở nền.
 *
 * Cách 1 (chính): engine dịch bằng Google qua trình duyệt có sẵn (Edge/Chrome, --google-browser) như app
 *   desktop của VI-Translate: không tốn lượt Gemini; Google đòi CAPTCHA thì cửa sổ trình duyệt bật lên để giải.
 * Cách 2 (dự phòng, không dùng khi dịch sẵn ở nền): handoff — engine xuất đoạn, server tự dịch
 *   (segmentTranslator: Google gtx → Gemini), engine dựng lại PDF.
 * Kết quả lưu ở uploads/translated/<file_hash>/c<k>.pdf, dùng chung cho mọi tài liệu cùng file.
 */

export const CHUNK = 10;
const ROOT = path.resolve(env.VI_TRANSLATE_DIR);
const PYTHON = path.join(ROOT, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
const CLI = path.join(ROOT, "scripts", "translate_pdf.py");
const CHUNK_SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../scripts/pdf_chunk.py");
const OUT_DIR = path.resolve(env.UPLOAD_DIR, "translated");
const TIMEOUT_MS = 20 * 60_000; // gồm cả thời gian chờ người dùng giải CAPTCHA (engine chờ tối đa 10 phút)
const run = promisify(execFile);

export const isPdfTranslatorInstalled = () => existsSync(PYTHON) && existsSync(CLI);

export type ChunkPhase = "queued" | "extracting" | "translating" | "building" | "ready" | "error";
export type ChunkStatus = {
  chunk: number;
  from: number;
  to: number;
  phase: ChunkPhase;
  done: number;
  total: number;
  unit?: "page" | "segment";
  error?: string;
};

type Job = { key: string; prefetch: boolean; run: () => Promise<void> };
const state = new Map<string, ChunkStatus>(); // key = `${fileKey}:${chunk}`
const queue: Job[] = [];
let busy = false;

const fileKey = (doc: Document) => doc.file_hash ?? `doc${doc.id}`;
export const chunkOf = (page: number) => Math.floor((page - 1) / CHUNK);
export const chunkFile = (doc: Document, chunk: number) => path.join(OUT_DIR, fileKey(doc), `c${chunk}.pdf`);

function bounds(doc: Document, chunk: number) {
  const from = chunk * CHUNK + 1;
  return { from, to: Math.min(from + CHUNK - 1, doc.page_count ?? from + CHUNK - 1) };
}

/** Engine ghi cache, model, hồ sơ trình duyệt vào thư mục home: trỏ sang vi-translate/.home để không chiếm ổ C. */
function pyEnv() {
  const home = path.join(ROOT, ".home");
  return { ...process.env, USERPROFILE: home, HOME: home, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" };
}

const errorLine = (out: string) => out.split(/\r?\n/).find((l) => l.startsWith("error:"));

async function py(args: string[]) {
  try {
    return await run(PYTHON, args, { env: pyEnv(), maxBuffer: 32 * 1024 * 1024, timeout: TIMEOUT_MS, windowsHide: true });
  } catch (err) {
    const e = err as { stderr?: string; stdout?: string; message: string };
    throw new Error(errorLine(`${e.stderr ?? ""}\n${e.stdout ?? ""}`) ?? e.message);
  }
}

/** Chạy engine và đọc thanh tiến độ (tqdm "7/10 [") trên stderr để báo tiến độ theo trang. */
function pyWithProgress(args: string[], onProgress: (done: number, total: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(PYTHON, args, { env: pyEnv(), windowsHide: true });
    let out = "";
    const timer = setTimeout(() => child.kill(), TIMEOUT_MS);
    const read = (buf: Buffer) => {
      const text = buf.toString();
      out = (out + text).slice(-20_000);
      const all = [...text.matchAll(/(\d+)\/(\d+) \[/g)];
      const m = all.at(-1);
      if (m) onProgress(Number(m[1]), Number(m[2]));
    };
    child.stdout.on("data", read);
    child.stderr.on("data", read);
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(errorLine(out) ?? `VI-Translate dừng với mã ${code}`));
    });
  });
}

const NOTHING_TO_TRANSLATE = /No text could be extracted|nothing to translate/i;

/** Cách 1: Google qua trình duyệt, 1 lần chạy engine. */
async function viaBrowser(part: string, work: string, st: ChunkStatus) {
  st.phase = "translating";
  st.unit = "page";
  await pyWithProgress([CLI, part, "--google-browser", "--output-dir", work, "--overwrite"], (done, total) =>
    Object.assign(st, { done, total }),
  );
  return path.join(work, "part-vi.pdf");
}

/** Cách 2: handoff — engine xuất đoạn, server dịch (Google gtx → Gemini), engine dựng lại PDF. */
async function viaHandoff(part: string, work: string, st: ChunkStatus, userId: number) {
  const segs = path.join(work, "segments.jsonl");
  const trans = path.join(work, "translations.jsonl");
  st.phase = "extracting";
  Object.assign(st, { done: 0, total: 0, unit: "segment" });
  await py([CLI, part, "--engine", "handoff", "--emit-segments", segs]);
  const srcs = existsSync(segs)
    ? (await readFile(segs, "utf8"))
        .split("\n")
        .filter((l) => l.trim())
        .map((l) => (JSON.parse(l) as { src: string }).src)
    : [];
  if (!srcs.length) return null;

  st.phase = "translating";
  const map = await translateSegments(srcs, userId, (done, total) => Object.assign(st, { done, total }));
  await writeFile(trans, [...map].map(([src, dst]) => JSON.stringify({ src, dst })).join("\n") + "\n", "utf8");

  st.phase = "building";
  await py([CLI, part, "--engine", "handoff", "--segments", trans, "--emit-segments", path.join(work, "missing.jsonl"), "--output-dir", work, "--overwrite"]);
  return path.join(work, "part-vi.pdf");
}

async function translateChunk(doc: Document, chunk: number, userId: number, st: ChunkStatus, prefetch: boolean) {
  const work = path.join(OUT_DIR, fileKey(doc), `work-c${chunk}`);
  await rm(work, { recursive: true, force: true });
  await mkdir(work, { recursive: true });
  const part = path.join(work, "part.pdf");
  const target = chunkFile(doc, chunk);
  try {
    st.phase = "extracting";
    await py([CHUNK_SCRIPT, pdfPath(doc.file_path), String(st.from), String(st.to), part]);
    let result: string | null;
    try {
      result = await viaBrowser(part, work, st);
    } catch (err) {
      // Cụm toàn trang ảnh / mục lục / chỉ mục: không có gì để dịch → giữ bản gốc.
      if (NOTHING_TO_TRANSLATE.test((err as Error).message)) result = null;
      // Dịch sẵn ở nền thì không dùng tới Gemini (để dành lượt cho việc người dùng đang làm).
      else if (prefetch) throw err;
      else {
        console.warn(`[translate] Google qua trình duyệt lỗi, chuyển sang dự phòng: ${(err as Error).message}`);
        try {
          result = await viaHandoff(part, work, st, userId);
        } catch (e) {
          if (!NOTHING_TO_TRANSLATE.test((e as Error).message)) throw e;
          result = null;
        }
      }
    }
    if (result) await rename(result, target);
    else await copyFile(part, target);
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
    await next.run();
  } finally {
    busy = false;
    void pump();
  }
}

function enqueue(doc: Document, chunk: number, userId: number, prefetch: boolean): ChunkStatus {
  const { from, to } = bounds(doc, chunk);
  const key = `${fileKey(doc)}:${chunk}`;
  const st: ChunkStatus = { chunk, from, to, phase: "queued", done: 0, total: 0 };
  state.set(key, st);
  const job: Job = {
    key,
    prefetch,
    run: async () => {
      try {
        await mkdir(path.dirname(chunkFile(doc, chunk)), { recursive: true });
        await translateChunk(doc, chunk, userId, st, job.prefetch);
        state.delete(key);
      } catch (err) {
        console.error(`[translate ${key}]`, (err as Error).message);
        if (job.prefetch) state.delete(key); // dịch sẵn lỗi: bỏ qua, khi người dùng mở cụm này sẽ dịch lại
        else Object.assign(st, { phase: "error", error: (err as Error).message });
      }
    },
  };
  // Cụm người dùng đang xem chen lên trước các cụm dịch sẵn.
  if (prefetch) queue.push(job);
  else {
    const i = queue.findIndex((j) => j.prefetch);
    queue.splice(i < 0 ? queue.length : i, 0, job);
  }
  void pump();
  return st;
}

/** Dịch sẵn cụm kế tiếp ở nền (chỉ 1 cụm, chỉ bằng Google qua trình duyệt). */
function prefetchNext(doc: Document, chunk: number, userId: number) {
  const next = chunk + 1;
  if (next > chunkOf(doc.page_count ?? 0) || existsSync(chunkFile(doc, next))) return;
  if (state.has(`${fileKey(doc)}:${next}`)) return;
  enqueue(doc, next, userId, true);
}

/** Trạng thái cụm chứa `page`; chưa dịch thì đưa vào hàng đợi (lần lượt từng cụm, tránh bị Google chặn). */
export function requestChunk(doc: Document, page: number, userId: number, retry = false): ChunkStatus {
  const chunk = chunkOf(page);
  const { from, to } = bounds(doc, chunk);
  if (existsSync(chunkFile(doc, chunk))) {
    prefetchNext(doc, chunk, userId);
    return { chunk, from, to, phase: "ready", done: 0, total: 0 };
  }

  const key = `${fileKey(doc)}:${chunk}`;
  const cur = state.get(key);
  if (cur) {
    // Đang được dịch sẵn ở nền mà người dùng mở tới: đưa lên đầu hàng đợi.
    const i = queue.findIndex((j) => j.key === key && j.prefetch);
    if (i >= 0) {
      const [job] = queue.splice(i, 1);
      job.prefetch = false; // job đọc cờ này lúc chạy → được dùng dự phòng Gemini
      queue.unshift(job);
    }
    // Lỗi giữ nguyên cho tới khi người dùng bấm thử lại (client hỏi trạng thái liên tục).
    if (cur.phase !== "error" || !retry) return cur;
  }
  const st = enqueue(doc, chunk, userId, false);
  prefetchNext(doc, chunk, userId);
  return st;
}
