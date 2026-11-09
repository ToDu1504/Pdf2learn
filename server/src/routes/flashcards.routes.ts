import { Router } from "express";
import { Op } from "sequelize";
import { z } from "zod";
import { Chapter, Flashcard } from "../models/index.js";
import { auth } from "../middlewares/auth.js";
import { HttpError } from "../utils/HttpError.js";
import { findOwnedDocument } from "../services/access.js";
import { sm2 } from "../services/srs.service.js";

export const flashcardRoutes = Router();
flashcardRoutes.use(auth);

async function chapterIdsOf(documentId: unknown, userId: number) {
  if (!documentId) return undefined;
  const doc = await findOwnedDocument(String(documentId), userId);
  return (await Chapter.findAll({ where: { document_id: doc.id }, attributes: ["id"] })).map((c) => c.id);
}

flashcardRoutes.get("/due", async (req, res) => {
  const where: Record<string, unknown> = { user_id: req.userId, next_review_at: { [Op.lte]: new Date() } };
  const chapterIds = await chapterIdsOf(req.query.documentId, req.userId);
  if (chapterIds) where.chapter_id = chapterIds;
  if (req.query.chapterId) where.chapter_id = Number(req.query.chapterId);
  const cards = await Flashcard.findAll({
    where,
    include: [{ model: Chapter, as: "chapter", attributes: ["id", "title", "document_id"] }],
    order: [["next_review_at", "ASC"]],
    limit: Math.min(200, Number(req.query.limit) || 50),
  });
  res.json(cards);
});

flashcardRoutes.get("/", async (req, res) => {
  const chapterIds = await chapterIdsOf(req.query.documentId, req.userId);
  const where: Record<string, unknown> = { user_id: req.userId };
  if (chapterIds) where.chapter_id = chapterIds;
  res.json(await Flashcard.findAll({ where, order: [["chapter_id", "ASC"], ["id", "ASC"]] }));
});

const reviewBody = z.object({ quality: z.number().int().min(0).max(5) });

flashcardRoutes.post("/:id/review", async (req, res) => {
  const { quality } = reviewBody.parse(req.body);
  const card = await Flashcard.findOne({ where: { id: req.params.id, user_id: req.userId } });
  if (!card) throw new HttpError(404, "Không tìm thấy thẻ");
  await card.update(sm2(card, quality));
  res.json(card);
});

const csvCell = (s: string) => `"${s.replace(/"/g, '""').replace(/\r?\n/g, "<br>")}"`;

flashcardRoutes.get("/export", async (req, res) => {
  const doc = await findOwnedDocument(String(req.query.documentId), req.userId);
  const chapters = await Chapter.findAll({ where: { document_id: doc.id } });
  const titleById = new Map(chapters.map((c) => [c.id, c.title]));
  const cards = await Flashcard.findAll({ where: { user_id: req.userId, chapter_id: [...titleById.keys()] } });
  // Anki import: Front, Back, Tags (tag không có dấu cách).
  const tag = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d").replace(/\W+/g, "_");
  const lines = cards.map((c) => [csvCell(c.front), csvCell(c.back), csvCell(`Pdf2Learn ${tag(titleById.get(c.chapter_id) ?? "")}`)].join(","));
  res.set({
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="flashcards-${doc.id}.csv"`,
  });
  res.send("\uFEFF" + lines.join("\n"));
});
