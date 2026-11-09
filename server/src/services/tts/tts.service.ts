import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { Op } from "sequelize";
import { env } from "../../config/env.js";
import { ChapterAudioSegment, Summary, TtsAudio, type Chapter } from "../../models/index.js";
import { withRetry } from "../../utils/withRetry.js";
import { normalizeForSpeech } from "./textNormalizer.js";
import { splitSentences } from "./sentenceSplitter.js";
import { synthesize } from "./tts.client.js";
import { PRIORITY, ttsQueue } from "./ttsQueue.js";
import { concatWav, parseWav } from "./wav.js";

export const AUDIO_DIR = path.resolve(env.UPLOAD_DIR, "audio");
mkdirSync(AUDIO_DIR, { recursive: true });

export const audioUrl = (hash: string) => `/api/v1/tts/audio/${hash}`;

const hashOf = (voice: string, text: string) =>
  createHash("sha256").update(`${env.TTS_MODEL}\u0000${voice}\u0000${text}`).digest("hex");

export type Segment = { text: string; hash: string; audioUrl: string; status: TtsAudio["status"]; durationMs: number | null };

const toSegment = (displayText: string, a: TtsAudio): Segment => ({
  text: displayText,
  hash: a.hash,
  audioUrl: audioUrl(a.hash),
  status: a.status,
  durationMs: a.duration_ms,
});

async function generate(hash: string) {
  const row = await TtsAudio.findOne({ where: { hash } });
  if (!row) throw new Error("audio không tồn tại");
  if (row.status === "done" && row.file_path) return;
  try {
    const wav = await withRetry(() => synthesize(row.text, row.voice), 3, 1500);
    const info = parseWav(wav);
    const file = `${hash}.wav`;
    await writeFile(path.join(AUDIO_DIR, file), wav);
    await row.update({ status: "done", file_path: file, duration_ms: info.durationMs, size_bytes: wav.length });
    void evictCache();
  } catch (err) {
    await row.update({ status: "failed" });
    throw err;
  }
}

/** Đảm bảo có hàng tts_audios cho câu (chưa có thì tạo pending) và đưa vào hàng đợi prefetch. */
async function ensureRow(text: string, voice: string) {
  const hash = hashOf(voice, text);
  const [row] = await TtsAudio.findOrCreate({ where: { hash }, defaults: { hash, voice, text } });
  if (row.status !== "done") {
    if (row.status === "failed") await row.update({ status: "pending" });
    ttsQueue.enqueue(hash, () => generate(hash), PRIORITY.prefetch).catch(() => {});
  }
  return row;
}

/** Tách đoạn văn thành câu → tạo/cache audio từng câu. Dùng cho nút 🔊 và gia sư tự đọc. */
export async function speak(text: string, voice: string): Promise<Segment[]> {
  const out: Segment[] = [];
  for (const sentence of splitSentences(normalizeForSpeech(text))) {
    out.push(toSegment(sentence, await ensureRow(sentence, voice)));
  }
  return out;
}

/**
 * Chờ audio sẵn sàng, ưu tiên cao (người dùng đang chờ nghe).
 * Trả về đường dẫn file hoặc null nếu không tạo được.
 */
export async function waitForAudio(hash: string): Promise<string | null> {
  let row = await TtsAudio.findOne({ where: { hash } });
  if (!row) return null;
  if (row.status !== "done" || !row.file_path || !(await stat(path.join(AUDIO_DIR, row.file_path)).catch(() => null))) {
    if (row.status === "done") await row.update({ status: "pending", file_path: null });
    await ttsQueue.enqueue(hash, () => generate(hash), PRIORITY.listening).catch(() => {});
    row = await TtsAudio.findOne({ where: { hash } });
    if (row?.status !== "done" || !row.file_path) return null;
  }
  await row.update({ last_used_at: new Date() });
  return path.join(AUDIO_DIR, row.file_path);
}

/** Văn bản đọc cho tóm tắt chương: mỗi phần tử là 1 câu hiển thị (để highlight). */
export function chapterScript(title: string, s: Summary) {
  const blocks = [
    title + ".",
    s.overview,
    "Các ý chính.",
    ...s.key_points.map((k) => k.point),
    s.key_terms.length ? "Các khái niệm quan trọng." : "",
    ...s.key_terms.map((k) => `${k.term}: ${k.definition}`),
  ].filter(Boolean);
  return blocks.flatMap((b) => splitSentences(b, 200, 1));
}

export async function prepareChapterAudio(chapter: Chapter, voice: string): Promise<Segment[]> {
  const summary = await Summary.findOne({ where: { chapter_id: chapter.id } });
  if (!summary) return [];
  let segments = await ChapterAudioSegment.findAll({
    where: { chapter_id: chapter.id, voice },
    include: [{ model: TtsAudio, as: "audio" }],
    order: [["order_index", "ASC"]],
  });
  if (!segments.length) {
    let i = 0;
    for (const display of chapterScript(chapter.title, summary)) {
      const spoken = normalizeForSpeech(display);
      if (!spoken) continue;
      const row = await ensureRow(spoken, voice);
      await ChapterAudioSegment.create({ chapter_id: chapter.id, voice, order_index: i++, display_text: display, tts_audio_id: row.id });
    }
    segments = await ChapterAudioSegment.findAll({
      where: { chapter_id: chapter.id, voice },
      include: [{ model: TtsAudio, as: "audio" }],
      order: [["order_index", "ASC"]],
    });
  } else {
    // Prefetch lại các câu chưa có (vd. server khởi động lại giữa chừng, hoặc cache đã bị dọn).
    for (const seg of segments) if (seg.audio && seg.audio.status !== "done") await ensureRow(seg.audio.text, voice);
  }
  return segments.map((seg) => toSegment(seg.display_text, seg.audio!));
}

export async function chapterAudioFile(chapter: Chapter, voice: string) {
  const segments = await prepareChapterAudio(chapter, voice);
  if (!segments.length || segments.some((s) => s.status !== "done")) return null;
  const buffers: Buffer[] = [];
  for (const s of segments) {
    const file = await waitForAudio(s.hash);
    if (!file) return null;
    buffers.push(await readFile(file));
  }
  return concatWav(buffers);
}

/** Giới hạn dung lượng cache: xóa file ít dùng nhất. Hàng DB giữ lại để tạo lại khi cần. */
let evicting = false;
async function evictCache() {
  if (evicting) return;
  evicting = true;
  try {
    const max = env.TTS_CACHE_MAX_GB * 1024 ** 3;
    let total = Number((await TtsAudio.sum("size_bytes", { where: { status: "done" } })) ?? 0);
    if (total <= max) return;
    const old = await TtsAudio.findAll({
      where: { status: "done", file_path: { [Op.ne]: null } },
      order: [["last_used_at", "ASC"]],
      limit: 500,
    });
    for (const a of old) {
      if (total <= max * 0.9) break;
      await unlink(path.join(AUDIO_DIR, a.file_path!)).catch(() => {});
      total -= a.size_bytes ?? 0;
      await a.update({ status: "pending", file_path: null, size_bytes: null });
    }
  } finally {
    evicting = false;
  }
}

/** Hủy prefetch các câu của chương (người dùng chuyển chương / đổi giọng). */
export async function cancelChapterPrefetch(chapterId: number, voice: string) {
  const segments = await ChapterAudioSegment.findAll({
    where: { chapter_id: chapterId, voice },
    include: [{ model: TtsAudio, as: "audio", attributes: ["hash"] }],
  });
  ttsQueue.cancel(segments.map((s) => s.audio!.hash));
}
