import { Router } from "express";
import { authRoutes } from "./auth.routes.js";
import { appConfigRoutes } from "./appConfig.routes.js";
import { documentRoutes } from "./documents.routes.js";
import { chapterRoutes } from "./chapters.routes.js";
import { quizRoutes } from "./quizzes.routes.js";
import { statsRoutes } from "./stats.routes.js";
import { flashcardRoutes } from "./flashcards.routes.js";
import { tutorRoutes } from "./tutor.routes.js";
import { settingsRoutes } from "./settings.routes.js";

export const api = Router();

api.get("/health", (_req, res) => res.json({ ok: true }));
api.use("/auth", authRoutes);
api.use("/app-config", appConfigRoutes);
api.use("/documents", documentRoutes);
api.use("/chapters", chapterRoutes);
api.use("/quizzes", quizRoutes);
api.use("/stats", statsRoutes);
api.use("/flashcards", flashcardRoutes);
api.use("/tutor", tutorRoutes);
api.use("/users", settingsRoutes);
