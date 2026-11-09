import { Router } from "express";
import { z } from "zod";
import { TtsAudio } from "../models/index.js";
import { auth } from "../middlewares/auth.js";
import { HttpError } from "../utils/HttpError.js";
import { findOwnedChapter } from "../services/access.js";
import { isTtsOnline, listVoices } from "../services/tts/tts.client.js";
import { ttsQueue } from "../services/tts/ttsQueue.js";
import {
  cancelChapterPrefetch,
  chapterAudioFile,
  prepareChapterAudio,
  speak,
  waitForAudio,
} from "../services/tts/tts.service.js";
import { getSettings } from "./settings.routes.js";

export const ttsRoutes = Router();

/**
 * File audio không yêu cầu token: thẻ <audio> không gửi được header, và hash là
 * sha256(model+voice+text) nên không đoán được. Nếu câu chưa tạo xong, request sẽ chờ
 * (ưu tiên cao) rồi mới trả file, nên FE chỉ cần gán audio.src.
 */
ttsRoutes.get("/audio/:hash", async (req, res) => {
  if (!/^[a-f0-9]{64}$/.test(req.params.hash)) throw new HttpError(400, "hash không hợp lệ");
  if (!(await TtsAudio.count({ where: { hash: req.params.hash } }))) throw new HttpError(404, "Không tìm thấy audio");
  const file = await waitForAudio(req.params.hash);
  if (!file) throw new HttpError(503, "Không tạo được giọng đọc. Kiểm tra TTS server.");
  res.sendFile(file, { headers: { "Content-Type": "audio/wav", "Cache-Control": "public, max-age=31536000, immutable" } });
});

ttsRoutes.use(auth);

ttsRoutes.get("/status", async (_req, res) => {
  res.json({ online: await isTtsOnline(), queue: ttsQueue.size });
});

ttsRoutes.get("/voices", async (_req, res) => {
  if (!(await isTtsOnline())) throw new HttpError(503, "TTS server chưa bật");
  res.json(await listVoices());
});

async function voiceOf(userId: number, voice?: string) {
  return voice || (await getSettings(userId)).tts_voice;
}

ttsRoutes.post("/speak", async (req, res) => {
  const body = z.object({ text: z.string().trim().min(1).max(8000), voice: z.string().max(100).optional() }).parse(req.body);
  if (!(await isTtsOnline())) throw new HttpError(503, "TTS server chưa bật");
  res.json(await speak(body.text, await voiceOf(req.userId, body.voice)));
});

/* ---- audio tóm tắt chương (mount thêm ở /chapters) ---- */

export const chapterAudioRoutes = Router();
chapterAudioRoutes.use(auth);

chapterAudioRoutes.post("/:id/audio", async (req, res) => {
  const { voice } = z.object({ voice: z.string().max(100).optional() }).parse(req.body ?? {});
  const { chapter } = await findOwnedChapter(req.params.id, req.userId);
  if (!(await isTtsOnline())) throw new HttpError(503, "TTS server chưa bật");
  const segments = await prepareChapterAudio(chapter, await voiceOf(req.userId, voice));
  if (!segments.length) throw new HttpError(409, "Chương chưa có tóm tắt");
  res.json(segments);
});

chapterAudioRoutes.get("/:id/audio", async (req, res) => {
  const { chapter } = await findOwnedChapter(req.params.id, req.userId);
  res.json(await prepareChapterAudio(chapter, await voiceOf(req.userId, req.query.voice as string | undefined)));
});

chapterAudioRoutes.delete("/:id/audio/prefetch", async (req, res) => {
  const { chapter } = await findOwnedChapter(req.params.id, req.userId);
  await cancelChapterPrefetch(chapter.id, await voiceOf(req.userId, req.query.voice as string | undefined));
  res.status(204).end();
});

chapterAudioRoutes.get("/:id/audio/download", async (req, res) => {
  const { chapter } = await findOwnedChapter(req.params.id, req.userId);
  const wav = await chapterAudioFile(chapter, await voiceOf(req.userId, req.query.voice as string | undefined));
  if (!wav) throw new HttpError(409, "Audio chương chưa tạo xong, hãy nghe hết 1 lượt hoặc chờ thêm.");
  res.set({
    "Content-Type": "audio/wav",
    "Content-Disposition": `attachment; filename="chuong-${chapter.order_index + 1}.wav"`,
  });
  res.send(wav);
});
