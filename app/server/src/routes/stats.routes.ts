import { Router } from "express";
import { Op, QueryTypes } from "sequelize";
import { sequelize } from "../config/db.js";
import { Chapter, Document, Flashcard, QuizAttempt } from "../models/index.js";
import { auth } from "../middlewares/auth.js";
import { findOwnedDocument } from "../services/access.js";

export const statsRoutes = Router();
statsRoutes.use(auth);

statsRoutes.get("/overview", async (req, res) => {
  const userId = req.userId;
  const [documents, attempts, dueCards, avg] = await Promise.all([
    Document.count({ where: { user_id: userId } }),
    QuizAttempt.count({ where: { user_id: userId, finished_at: { [Op.ne]: null } } }),
    // Chỉ thẻ của bài đã học xong (xem flashcards.routes /due).
    Flashcard.count({
      where: { user_id: userId, next_review_at: { [Op.lte]: new Date() } },
      include: [{ model: Chapter, as: "chapter", attributes: [], where: { completed_at: { [Op.ne]: null } }, required: true }],
    }),
    sequelize.query<{ avg: number | null }>(
      "SELECT AVG(score) AS avg FROM quiz_attempts WHERE user_id = :userId AND finished_at IS NOT NULL",
      { replacements: { userId }, type: QueryTypes.SELECT },
    ),
  ]);
  res.json({ documents, attempts, dueCards, avgScore: avg[0]?.avg == null ? null : Number(avg[0].avg), nextLesson: await nextLessonOf(userId) });
});

/**
 * "Học tiếp": bài chưa học đầu tiên (ưu tiên bài cốt lõi) của tài liệu học gần nhất
 * (bài hoàn thành gần nhất; chưa học bài nào thì tài liệu mới nhất).
 */
async function nextLessonOf(userId: number) {
  const docs = await Document.findAll({ where: { user_id: userId, status: "done" }, attributes: ["id", "title", "created_at"] });
  if (!docs.length) return null;
  const chapters = await Chapter.findAll({
    where: { document_id: docs.map((d) => d.id) },
    attributes: ["id", "document_id", "title", "order_index", "importance", "est_minutes", "completed_at"],
    order: [["order_index", "ASC"]],
  });
  const lastActive = (docId: number, created: Date) =>
    Math.max(created.getTime(), ...chapters.filter((c) => c.document_id === docId && c.completed_at).map((c) => c.completed_at!.getTime()));
  const ordered = [...docs].sort((a, b) => lastActive(b.id, b.created_at) - lastActive(a.id, a.created_at));
  for (const doc of ordered) {
    const own = chapters.filter((c) => c.document_id === doc.id);
    const next = own.find((c) => !c.completed_at && c.importance !== "optional") ?? own.find((c) => !c.completed_at);
    if (!next) continue;
    return {
      documentId: doc.id,
      documentTitle: doc.title,
      chapterId: next.id,
      title: next.title,
      estMinutes: next.est_minutes,
      done: own.filter((c) => c.completed_at).length,
      total: own.length,
    };
  }
  return null;
}

statsRoutes.get("/weak-topics", async (req, res) => {
  const doc = await findOwnedDocument(String(req.query.documentId), req.userId);
  const rows = await sequelize.query<{ topic: string; chapter_id: number; chapter_title: string; total: number; wrong: number }>(
    `SELECT q.topic, c.id AS chapter_id, c.title AS chapter_title,
            COUNT(*) AS total, SUM(aa.is_correct = 0) AS wrong
       FROM attempt_answers aa
       JOIN quiz_attempts qa ON qa.id = aa.attempt_id
       JOIN questions q ON q.id = aa.question_id
       JOIN chapters c ON c.id = q.chapter_id
      WHERE qa.user_id = :userId AND qa.document_id = :documentId AND aa.is_correct IS NOT NULL
      GROUP BY q.topic, c.id, c.title
     HAVING wrong > 0
      ORDER BY SUM(aa.is_correct = 0) / COUNT(*) DESC, SUM(aa.is_correct = 0) DESC
      LIMIT 15`,
    { replacements: { userId: req.userId, documentId: doc.id }, type: QueryTypes.SELECT },
  );
  res.json(rows.map((r) => ({ ...r, total: Number(r.total), wrong: Number(r.wrong), errorRate: Number(r.wrong) / Number(r.total) })));
});

statsRoutes.get("/chapter-scores", async (req, res) => {
  const doc = await findOwnedDocument(String(req.query.documentId), req.userId);
  const rows = await sequelize.query<{ chapter_id: number; title: string; total: number; correct: number }>(
    `SELECT c.id AS chapter_id, c.title, COUNT(aa.id) AS total, COALESCE(SUM(aa.is_correct = 1), 0) AS correct
       FROM chapters c
       LEFT JOIN questions q ON q.chapter_id = c.id
       LEFT JOIN attempt_answers aa ON aa.question_id = q.id AND aa.is_correct IS NOT NULL
            AND aa.attempt_id IN (SELECT id FROM quiz_attempts WHERE user_id = :userId)
      WHERE c.document_id = :documentId
      GROUP BY c.id, c.title, c.order_index
      ORDER BY c.order_index`,
    { replacements: { userId: req.userId, documentId: doc.id }, type: QueryTypes.SELECT },
  );
  res.json(
    rows.map((r) => ({
      ...r,
      total: Number(r.total),
      correct: Number(r.correct),
      rate: Number(r.total) ? Number(r.correct) / Number(r.total) : null,
    })),
  );
});

statsRoutes.get("/score-history", async (req, res) => {
  const where: Record<string, unknown> = { user_id: req.userId, finished_at: { [Op.ne]: null } };
  if (req.query.documentId) where.document_id = Number(req.query.documentId);
  const attempts = await QuizAttempt.findAll({ where, order: [["finished_at", "ASC"]], limit: 100 });
  res.json(attempts.map((a) => ({ id: a.id, finished_at: a.finished_at, score: a.score, mode: a.mode })));
});

statsRoutes.get("/ai-usage", async (req, res) => {
  const rows = await sequelize.query<{ day: string; feature: string; input_tokens: number; output_tokens: number; calls: number }>(
    // SQLite lưu DATE dạng "YYYY-MM-DD HH:MM:SS.SSS +00:00": 10 ký tự đầu là ngày (UTC), so sánh chuỗi được.
    `SELECT substr(created_at, 1, 10) AS day, feature,
            SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens, COUNT(*) AS calls
       FROM ai_usage_logs
      WHERE user_id = :userId AND created_at >= :since
      GROUP BY day, feature
      ORDER BY day`,
    { replacements: { userId: req.userId, since: new Date(Date.now() - 30 * 86_400_000) }, type: QueryTypes.SELECT },
  );
  res.json(
    rows.map((r) => ({
      ...r,
      input_tokens: Number(r.input_tokens),
      output_tokens: Number(r.output_tokens),
      calls: Number(r.calls),
    })),
  );
});
