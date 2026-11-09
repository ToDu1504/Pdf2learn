import { GoogleGenAI } from "@google/genai";
import { Router } from "express";
import { z } from "zod";
import { env } from "../config/env.js";
import { appConfigStatus, saveAppConfig } from "../config/appConfig.js";
import { auth } from "../middlewares/auth.js";
import { HttpError } from "../utils/HttpError.js";

/** Cấu hình app desktop: Gemini API key (mã hóa), model. Màn hình "lần đầu chạy" và Cài đặt → AI dùng các API này. */
export const appConfigRoutes = Router();
appConfigRoutes.use(auth);

appConfigRoutes.get("/", (_req, res) => {
  res.json(appConfigStatus());
});

/** Kiểm tra key + model bằng lời gọi xem thông tin model (không tốn lượt sinh nội dung). */
async function testKey(apiKey: string, model: string) {
  try {
    await new GoogleGenAI({ apiKey }).models.get({ model });
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 400 || status === 401 || status === 403) throw new HttpError(400, "API key không hợp lệ hoặc chưa được bật Gemini API.");
    if (status === 404) throw new HttpError(400, `Không tìm thấy model "${model}" với key này.`);
    throw new HttpError(502, `Không kiểm tra được với Google: ${(err as Error).message.slice(0, 150)}`);
  }
}

const body = z.object({
  gemini_api_key: z.string().trim().min(10).max(200).optional(),
  gemini_model: z.string().trim().min(3).max(100).optional(),
  gemini_fallback_models: z.string().trim().max(500).optional(),
});

appConfigRoutes.put("/", async (req, res) => {
  const patch = body.parse(req.body);
  const key = patch.gemini_api_key ?? env.GEMINI_API_KEY;
  const model = patch.gemini_model ?? env.GEMINI_MODEL;
  if (!key) throw new HttpError(400, "Hãy nhập Gemini API key");
  if (patch.gemini_api_key || patch.gemini_model) await testKey(key, model);
  await saveAppConfig(patch);
  res.json(appConfigStatus());
});
