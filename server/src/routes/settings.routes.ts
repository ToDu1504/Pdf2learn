import { Router } from "express";
import { z } from "zod";
import { UserSettings } from "../models/index.js";
import { auth } from "../middlewares/auth.js";

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
