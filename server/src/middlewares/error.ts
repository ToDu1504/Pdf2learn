import type { ErrorRequestHandler } from "express";
import { ApiError } from "@google/genai";
import { MulterError } from "multer";
import { ZodError } from "zod";
import { HttpError } from "../utils/HttpError.js";
import { QuotaExhaustedError } from "../services/ai/gemini.client.js";

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) return res.status(400).json({ error: "Dữ liệu không hợp lệ", issues: err.issues });
  if (err instanceof MulterError)
    return res.status(err.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({
      error: err.code === "LIMIT_FILE_SIZE" ? "File vượt quá dung lượng cho phép" : err.message,
    });
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err instanceof QuotaExhaustedError) return res.status(429).json({ error: err.message });
  console.error(err);
  // Lỗi từ Gemini SDK (ApiError có status): báo rõ để người dùng biết là do AI, không phải do app.
  if (err instanceof ApiError) {
    const msg =
      err.status === 429
        ? "Gemini đang giới hạn tần suất, thử lại sau ít phút."
        : /API key/i.test(err.message)
          ? "GEMINI_API_KEY không hợp lệ."
          : "Gọi Gemini thất bại.";
    return res.status(err.status === 429 ? 429 : 502).json({ error: msg });
  }
  res.status(500).json({ error: "Lỗi máy chủ" });
};
