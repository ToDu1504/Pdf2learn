import { GoogleGenAI, FileState, ThinkingLevel, type GenerateContentResponseUsageMetadata, type Part } from "@google/genai";
import { env } from "../../config/env.js";
import { AiUsageLog, type Chapter } from "../../models/index.js";
import { isDailyQuotaError, withRetry } from "../../utils/withRetry.js";
import { HttpError } from "../../utils/HttpError.js";
import { cutChapterPdf } from "../pdf.service.js";

/**
 * App desktop: API key / model đổi được khi đang chạy (Cài đặt → AI) → tạo lại client khi key đổi, đọc model mỗi lần.
 */
let client: GoogleGenAI | null = null;
let clientKey = "";
export function ai() {
  if (!client || clientKey !== env.GEMINI_API_KEY) {
    client = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
    clientKey = env.GEMINI_API_KEY;
  }
  return client;
}

export function assertAiConfigured() {
  if (!env.GEMINI_API_KEY || !env.GEMINI_MODEL) throw new HttpError(503, "Chưa nhập Gemini API key: vào Cài đặt → AI (Gemini).");
}

export type AiFeature = "split" | "summarize" | "quiz" | "grade" | "tutor" | "mindmap" | "translate";

export async function logUsage(userId: number, feature: AiFeature, usage?: GenerateContentResponseUsageMetadata) {
  if (!usage) return;
  await AiUsageLog.create({
    user_id: userId,
    feature,
    input_tokens: usage.promptTokenCount ?? 0,
    output_tokens: (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0),
  });
}

/**
 * Giới hạn số lời gọi Gemini chạy cùng lúc trên toàn server (GEMINI_CONCURRENCY),
 * để chạy song song nhiều chương mà không bị 429 dồn dập.
 */
let active = 0;
const waiting: (() => void)[] = [];
export async function aiSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= env.GEMINI_CONCURRENCY) await new Promise<void>((r) => waiting.push(r));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

/** Tóm tắt / sinh câu hỏi không cần suy luận sâu: giảm mức "thinking" để nhanh và rẻ hơn (chỉ model Gemini 3+). */
export function thinkingConfig(model = env.GEMINI_MODEL) {
  if (env.GEMINI_THINKING === "default" || !/^gemini-[3-9]/.test(model)) return {};
  const level = { minimal: ThinkingLevel.MINIMAL, low: ThinkingLevel.LOW, high: ThinkingLevel.HIGH }[env.GEMINI_THINKING];
  return { thinkingConfig: { thinkingLevel: level } };
}

/* ---------- Xoay vòng model khi hết hạn mức ngày ---------- */

/** Hết lượt gọi trong ngày ở mọi model: pipeline dừng lại, giữ các chương chưa làm ở trạng thái chờ. */
export class QuotaExhaustedError extends Error {
  constructor() {
    super("Đã hết lượt gọi Gemini miễn phí hôm nay cho mọi model. Bấm \"Xử lý lại\" vào ngày mai để làm tiếp.");
  }
}

const models = () => [
  env.GEMINI_MODEL,
  ...env.GEMINI_FALLBACK_MODELS.split(",")
    .map((m) => m.trim())
    .filter((m) => m && m !== env.GEMINI_MODEL),
];
/** model → thời điểm có thể dùng lại (hạn mức ngày của Google reset lúc 0h giờ Thái Bình Dương). */
const exhaustedUntil = new Map<string, number>();

export function nextQuotaReset() {
  const now = new Date();
  // 0h Pacific ≈ 08:00 UTC (giờ chuẩn) / 07:00 UTC (giờ mùa hè); lấy 08:00 UTC cho chắc.
  const reset = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 8, 5));
  if (reset.getTime() <= now.getTime()) reset.setUTCDate(reset.getUTCDate() + 1);
  return reset.getTime();
}

export function availableModels() {
  return models().filter((m) => (exhaustedUntil.get(m) ?? 0) <= Date.now());
}

/**
 * Gọi fn(model) với model chính; nếu model hết hạn mức NGÀY thì đánh dấu và chuyển ngay sang
 * model dự phòng tiếp theo (mỗi model có hạn mức riêng). Hết sạch → QuotaExhaustedError.
 */
export async function withModelFallback<T>(fn: (model: string) => Promise<T>): Promise<T> {
  for (const model of availableModels()) {
    try {
      return await fn(model);
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (isDailyQuotaError(err) || status === 404) {
        // 404: model không còn mở cho tài khoản này → bỏ qua tới khi khởi động lại.
        exhaustedUntil.set(model, status === 404 ? Number.MAX_SAFE_INTEGER : nextQuotaReset());
        console.warn(`[ai] ${model} ${status === 404 ? "không dùng được" : "hết hạn mức ngày"}, chuyển model dự phòng`);
        continue;
      }
      throw err;
    }
  }
  throw new QuotaExhaustedError();
}

/**
 * Gọi Gemini với structured output, validate bằng Zod, retry khi 429/5xx,
 * và retry thêm 1 lần nếu JSON trả về không khớp schema.
 */
export async function generateJson<T>(opts: {
  parts: Part[];
  responseSchema: object;
  parse: (raw: unknown) => T;
  userId: number;
  feature: AiFeature;
  temperature?: number;
  systemInstruction?: string;
}): Promise<T> {
  assertAiConfigured();
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await aiSlot(() =>
      withModelFallback((model) =>
        withRetry(() =>
          ai().models.generateContent({
            model,
            contents: [{ role: "user", parts: opts.parts }],
            config: {
              responseMimeType: "application/json",
              responseSchema: opts.responseSchema,
              temperature: opts.temperature ?? 0.3,
              systemInstruction: opts.systemInstruction,
              ...thinkingConfig(model),
            },
          }),
        ),
      ),
    );
    await logUsage(opts.userId, opts.feature, res.usageMetadata);
    try {
      return opts.parse(JSON.parse(res.text ?? ""));
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

/** Upload file lên Gemini File API và chờ tới khi ACTIVE. */
export async function uploadPdfToGemini(data: Uint8Array, displayName: string) {
  assertAiConfigured();
  const blob = new Blob([data as BlobPart], { type: "application/pdf" });
  let file = await withRetry(() => ai().files.upload({ file: blob, config: { mimeType: "application/pdf", displayName } }));
  for (let i = 0; file.state === FileState.PROCESSING && i < 60; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    file = await ai().files.get({ name: file.name! });
  }
  if (file.state === FileState.FAILED || !file.uri) throw new Error(`Gemini không xử lý được file ${displayName}`);
  return { uri: file.uri, expiresAt: file.expirationTime ? new Date(file.expirationTime) : null };
}

/**
 * Trả về Part trỏ tới file PDF của chương. File trên Gemini có hạn dùng, nên nếu
 * sắp hết hạn (hoặc chưa có) thì cắt lại từ PDF gốc và upload lại.
 */
export async function chapterFilePart(chapter: Chapter, sourcePdf: string): Promise<Part> {
  const margin = 10 * 60 * 1000;
  const valid =
    chapter.gemini_file_uri &&
    (!chapter.gemini_file_expires_at || chapter.gemini_file_expires_at.getTime() - Date.now() > margin);
  if (!valid) {
    const bytes = await cutChapterPdf(sourcePdf, chapter.start_page, chapter.end_page);
    const { uri, expiresAt } = await uploadPdfToGemini(bytes, `chapter-${chapter.id}`);
    await chapter.update({ gemini_file_uri: uri, gemini_file_expires_at: expiresAt });
  }
  return { fileData: { fileUri: chapter.gemini_file_uri!, mimeType: "application/pdf" } };
}
