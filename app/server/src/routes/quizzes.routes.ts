import { Router } from "express";
import { Op, QueryTypes } from "sequelize";
import { z } from "zod";
import { sequelize } from "../config/db.js";
import { AttemptAnswer, Chapter, Question, QuizAttempt } from "../models/index.js";
import { auth } from "../middlewares/auth.js";
import { HttpError } from "../utils/HttpError.js";
import { findOwnedDocument } from "../services/access.js";
import { gradeShortAnswer } from "../services/ai/content.service.js";

export const quizRoutes = Router();
quizRoutes.use(auth);

const createBody = z.object({
  documentId: z.number().int(),
  mode: z.enum(["chapter", "mixed", "weak", "exam"]),
  chapterIds: z.array(z.number().int()).optional(),
  count: z.number().int().min(1).max(50).default(10),
  difficulty: z.enum(["easy", "medium", "hard"]).optional(),
  types: z.array(z.enum(["mcq", "true_false", "short_answer"])).min(1).optional(),
  /** "book": chỉ câu hỏi in trong sách (đáp án theo sách); "ai": chỉ câu AI soạn. */
  origin: z.enum(["ai", "book"]).optional(),
});

/** Ẩn đáp án khi gửi đề cho người làm bài. */
const publicQuestion = (q: Question) => ({
  id: q.id,
  chapter_id: q.chapter_id,
  type: q.type,
  difficulty: q.difficulty,
  content: q.content,
  options: q.options,
  source_page: q.source_page,
  topic: q.topic,
  // Câu nhiều đáp án (câu hỏi của sách "Choose two"): đáp án là nhiều lựa chọn nối bằng xuống dòng.
  multi: q.type === "mcq" && q.correct_answer.includes("\n"),
});

/** Câu hỏi người dùng từng làm sai, hoặc cùng chủ đề với câu từng sai. */
async function weakQuestionIds(userId: number, documentId: number) {
  const rows = await sequelize.query<{ id: number }>(
    `SELECT DISTINCT q2.id FROM attempt_answers aa
       JOIN quiz_attempts qa ON qa.id = aa.attempt_id
       JOIN questions q ON q.id = aa.question_id
       JOIN questions q2 ON q2.chapter_id = q.chapter_id AND q2.topic = q.topic
      WHERE qa.user_id = :userId AND qa.document_id = :documentId AND aa.is_correct = 0`,
    { replacements: { userId, documentId }, type: QueryTypes.SELECT },
  );
  return rows.map((r) => r.id);
}

quizRoutes.post("/", async (req, res) => {
  const body = createBody.parse(req.body);
  const doc = await findOwnedDocument(body.documentId, req.userId);

  const chapters = await Chapter.findAll({ where: { document_id: doc.id }, attributes: ["id"] });
  let chapterIds = chapters.map((c) => c.id);
  if (body.chapterIds?.length) chapterIds = chapterIds.filter((id) => body.chapterIds!.includes(id));
  else if (body.mode === "chapter") throw new HttpError(400, "Chọn ít nhất 1 chương");

  const where: Record<string, unknown> = { chapter_id: chapterIds };
  if (body.difficulty) where.difficulty = body.difficulty;
  if (body.types) where.type = body.types;
  if (body.origin) where.origin = body.origin;
  if (body.mode === "weak") {
    const ids = await weakQuestionIds(req.userId, doc.id);
    if (!ids.length) throw new HttpError(400, "Chưa có dữ liệu điểm yếu, hãy làm vài bài trước");
    where.id = { [Op.in]: ids };
  }

  const questions = await Question.findAll({ where, order: sequelize.random(), limit: body.count });
  if (!questions.length) throw new HttpError(400, "Không có câu hỏi phù hợp. Hãy sinh thêm câu hỏi ở trang chương.");

  const attempt = await QuizAttempt.create({
    user_id: req.userId,
    document_id: doc.id,
    mode: body.mode,
    total_questions: questions.length,
  });
  await AttemptAnswer.bulkCreate(questions.map((q) => ({ attempt_id: attempt.id, question_id: q.id })));

  res.status(201).json({
    attempt,
    time_limit_sec: body.mode === "exam" ? questions.length * 60 : null,
    questions: questions.map(publicQuestion),
  });
});

const submitBody = z.object({
  answers: z.array(z.object({ questionId: z.number().int(), answer: z.string().max(5000) })),
});

const normalize = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

quizRoutes.post("/:id/submit", async (req, res) => {
  const { answers } = submitBody.parse(req.body);
  const attempt = await QuizAttempt.findOne({ where: { id: req.params.id, user_id: req.userId } });
  if (!attempt) throw new HttpError(404, "Không tìm thấy bài làm");
  if (attempt.finished_at) throw new HttpError(409, "Bài đã nộp");

  const rows = await AttemptAnswer.findAll({
    where: { attempt_id: attempt.id },
    include: [{ model: Question, as: "question" }],
  });
  const given = new Map(answers.map((a) => [a.questionId, a.answer]));

  let correct = 0;
  for (const row of rows) {
    const q = row.question!;
    const answer = given.get(q.id)?.trim() ?? "";
    if (!answer) {
      await row.update({ user_answer: null, is_correct: false });
      continue;
    }
    if (q.type === "short_answer") {
      try {
        const g = await gradeShortAnswer(q, answer, req.userId);
        const feedback = g.missing_points.length ? `${g.feedback}\nCòn thiếu: ${g.missing_points.join("; ")}` : g.feedback;
        await row.update({ user_answer: answer, ai_score: g.score, ai_feedback: feedback, is_correct: g.score >= 5 });
      } catch {
        await row.update({ user_answer: answer, is_correct: null, ai_feedback: "AI chưa chấm được câu này." });
      }
    } else {
      await row.update({ user_answer: answer, is_correct: normalize(answer) === normalize(q.correct_answer) });
    }
    if (row.is_correct) correct++;
  }

  await attempt.update({
    correct_count: correct,
    score: Math.round((correct / Math.max(1, rows.length)) * 1000) / 100,
    finished_at: new Date(),
  });
  res.json(await loadResult(attempt.id, req.userId));
});

async function loadResult(attemptId: number | string, userId: number) {
  const attempt = await QuizAttempt.findOne({
    where: { id: attemptId, user_id: userId },
    include: [
      {
        model: AttemptAnswer,
        as: "answers",
        include: [{ model: Question, as: "question", include: [{ model: Chapter, as: "chapter", attributes: ["id", "title"] }] }],
      },
    ],
    order: [[{ model: AttemptAnswer, as: "answers" }, "id", "ASC"]],
  });
  if (!attempt) throw new HttpError(404, "Không tìm thấy bài làm");
  return attempt;
}

quizRoutes.get("/history", async (req, res) => {
  const documentId = req.query.documentId ? Number(req.query.documentId) : undefined;
  const where: Record<string, unknown> = { user_id: req.userId, finished_at: { [Op.ne]: null } };
  if (documentId) where.document_id = documentId;
  res.json(await QuizAttempt.findAll({ where, order: [["finished_at", "DESC"]], limit: 50 }));
});

quizRoutes.get("/:id", async (req, res) => {
  const attempt = await loadResult(req.params.id, req.userId);
  // Bài chưa nộp: không lộ đáp án.
  if (!attempt.finished_at) throw new HttpError(409, "Bài chưa nộp");
  res.json(attempt);
});
