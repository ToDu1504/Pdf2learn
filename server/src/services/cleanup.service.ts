import { readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { Op } from "sequelize";
import { env } from "../config/env.js";
import { ChapterAudioSegment, Document, TtsAudio } from "../models/index.js";
import { PDF_DIR } from "../middlewares/upload.js";
import { AUDIO_DIR } from "./tts/tts.service.js";

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

/**
 * Dọn ổ đĩa khi server khởi động:
 * 1. File PDF/WAV không còn bản ghi nào trong DB trỏ tới (mồ côi).
 * 2. Audio đọc nhanh (nút 🔊, gia sư) không thuộc tóm tắt chương nào và lâu không nghe lại.
 *    Audio tóm tắt chương thì giữ lại, chỉ bị xóa theo giới hạn TTS_CACHE_MAX_GB.
 */
export async function cleanupUploads() {
  const cutoff = new Date(Date.now() - env.TTS_UNUSED_DAYS * 24 * 60 * 60 * 1000);
  const usedByChapters = (await ChapterAudioSegment.findAll({ attributes: ["tts_audio_id"], raw: true })).map((s) => s.tts_audio_id);
  const stale = await TtsAudio.findAll({
    where: { last_used_at: { [Op.lt]: cutoff }, ...(usedByChapters.length && { id: { [Op.notIn]: usedByChapters } }) },
    attributes: ["id"],
  });
  if (stale.length) await TtsAudio.destroy({ where: { id: stale.map((a) => a.id) } });

  const pdfs = new Set((await Document.findAll({ attributes: ["file_path"], raw: true })).map((d) => d.file_path));
  const audios = new Set(
    (await TtsAudio.findAll({ where: { file_path: { [Op.ne]: null } }, attributes: ["file_path"], raw: true })).map((a) => a.file_path!),
  );
  const pdf = await removeUntracked(PDF_DIR, pdfs);
  const audio = await removeUntracked(AUDIO_DIR, audios);

  const mb = ((pdf.bytes + audio.bytes) / 1024 / 1024).toFixed(1);
  if (pdf.removed || audio.removed || stale.length)
    console.log(`[cleanup] xóa ${pdf.removed} PDF + ${audio.removed} audio mồ côi (${mb} MB), ${stale.length} audio lâu không dùng`);
}
