import { Router } from "express";
import { z } from "zod";
import { env } from "../config/env.js";
import { UserSettings } from "../models/index.js";
import { auth } from "../middlewares/auth.js";

export const settingsRoutes = Router();
settingsRoutes.use(auth);

export async function getSettings(userId: number) {
  const [settings] = await UserSettings.findOrCreate({
    where: { user_id: userId },
    defaults: { user_id: userId, tts_voice: env.TTS_DEFAULT_VOICE },
  });
  return settings;
}

const patchBody = z
  .object({
    tts_voice: z.string().min(1).max(100),
    tts_rate: z.number().min(0.75).max(2),
    auto_read_tutor: z.boolean(),
    theme: z.enum(["light", "dark", "system"]),
  })
  .partial();

settingsRoutes.get("/me/settings", async (req, res) => {
  res.json(await getSettings(req.userId));
});

settingsRoutes.patch("/me/settings", async (req, res) => {
  const patch = patchBody.parse(req.body);
  const settings = await getSettings(req.userId);
  await settings.update(patch);
  res.json(settings);
});
