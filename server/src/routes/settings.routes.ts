import { Router } from "express";
import { z } from "zod";
import { UserSettings } from "../models/index.js";
import { auth } from "../middlewares/auth.js";
import { kickAutoPrepare, kickAutoTranslate } from "../services/autoPrepare.service.js";

export const settingsRoutes = Router();
settingsRoutes.use(auth);

export async function getSettings(userId: number) {
  const [settings] = await UserSettings.findOrCreate({
    where: { user_id: userId },
    defaults: { user_id: userId },
  });
  return settings;
}

const patchBody = z
  .object({
    theme: z.enum(["light", "dark", "system"]),
    auto_prepare: z.boolean(),
    auto_translate: z.boolean(),
  })
  .partial();

settingsRoutes.get("/me/settings", async (req, res) => {
  res.json(await getSettings(req.userId));
});

settingsRoutes.patch("/me/settings", async (req, res) => {
  const patch = patchBody.parse(req.body);
  const settings = await getSettings(req.userId);
  await settings.update(patch);
  // Vừa bật lại: chạy ngay, không đợi lượt định kỳ.
  if (patch.auto_prepare) void kickAutoPrepare();
  if (patch.auto_translate) void kickAutoTranslate().catch(() => {});
  res.json(settings);
});
