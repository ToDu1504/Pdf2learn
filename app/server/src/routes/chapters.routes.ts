import { Router } from "express";
import { z } from "zod";
import { Question, Summary } from "../models/index.js";
import { auth } from "../middlewares/auth.js";
import { HttpError } from "../utils/HttpError.js";
import { findOwnedChapter } from "../services/access.js";
import { chapterSource } from "../services/ai/source.js";
import { analyzeError, analyzeFrom, isAnalyzing, reanalyzeChapter, supplementChapter } from "../services/chapterAnalysis.service.js";
import { generateQuestions } from "../services/ai/content.service.js";
import { buildMindmap } from "../services/mindmap.js";
import { chapterFigures } from "../services/figures.service.js";

export const chapterRoutes = Router();
chapterRoutes.use(auth);

chapterRoutes.get("/:id", async (req, res) => {
  const { chapter, doc } = await findOwnedChapter(req.params.id, req.userId);
  const summary = await Summary.findOne({ where: { chapter_id: chapter.id } });
  const questions = await Question.findAll({ where: { chapter_id: chapter.id }, order: [["id", "ASC"]] });
  res.json({
    ...chapter.toJSON(),
    gemini_file_uri: undefined,
    document: { id: doc.id, title: doc.title, page_count: doc.page_count },
    // Sơ đồ dựng bằng code từ mục lục + nội dung đã kiểm chứng (không gọi AI, luôn khớp bài hiện tại).
    summary: summary && {
      ...summary.toJSON(),
      mindmap_mermaid: buildMindmap({
        title: chapter.title,
        subtopics: chapter.subtopics,
        key_points: summary.key_points,
        key_terms: summary.key_terms,
        unverifiable: summary.grounding?.mode === "file",
      }),
    },
    questions,
    analyzing: isAnalyzing(chapter.id),
    analyze_error: summary ? null : analyzeError(chapter.id),
  });
});

/** Hình minh họa trong các trang của bài (tìm bằng code lần đầu mở bài, lưu lại). */
chapterRoutes.get("/:id/figures", async (req, res) => {
  const { chapter, doc } = await findOwnedChapter(req.params.id, req.userId);
  res.json(await chapterFigures(doc, chapter));
});

/** Đổi tên bài học. */
chapterRoutes.patch("/:id", async (req, res) => {
  const { title } = z.object({ title: z.string().trim().min(1, "Tiêu đề không được để trống").max(250) }).parse(req.body);
  const { chapter } = await findOwnedChapter(req.params.id, req.userId);
  await chapter.update({ title });
  res.json({ id: chapter.id, title: chapter.title });
});

/** Đánh dấu hoàn thành bài học (sau khi làm đạt bài kiểm tra nhanh, hoặc người học tự đánh dấu). */
chapterRoutes.post("/:id/complete", async (req, res) => {
  const { completed } = z.object({ completed: z.boolean() }).parse(req.body);
  const { chapter } = await findOwnedChapter(req.params.id, req.userId);
  await chapter.update({ completed_at: completed ? (chapter.completed_at ?? new Date()) : null });
  res.json({ id: chapter.id, completed_at: chapter.completed_at });
});

/**
 * Tóm tắt chương theo yêu cầu (kèm vài chương kế tiếp trong cùng 1 lượt gọi).
 * Trả về ngay (202); client poll GET /chapters/:id tới khi có summary hoặc analyze_error.
 */
chapterRoutes.post("/:id/analyze", async (req, res) => {
  const { chapter, doc } = await findOwnedChapter(req.params.id, req.userId);
  if (chapter.status === "done") return res.json({ status: "done" });
  if (doc.status !== "done") throw new HttpError(409, "Tài liệu đang được đọc, chờ một chút");
  analyzeFrom(doc, chapter.id).catch(() => {}); // lỗi được lưu lại, trả về qua analyze_error
  res.status(202).json({ status: "analyzing" });
});

const generateBody = z.object({
  type: z.enum(["mcq", "true_false", "short_answer"]),
  difficulty: z.enum(["easy", "medium", "hard"]),
  count: z.number().int().min(1).max(15),
});

chapterRoutes.post("/:id/questions/generate", async (req, res) => {
  const body = generateBody.parse(req.body);
  const { chapter, doc } = await findOwnedChapter(req.params.id, req.userId);
  const src = await chapterSource(chapter, doc);
  const created = await generateQuestions(chapter, src, req.userId, {
    count: body.count,
    types: [body.type],
    difficulty: body.difficulty,
  });
  res.status(201).json(created);
});

/** Soạn lại bài theo quy tắc kiểm chứng với sách (xóa bài giảng + câu hỏi cũ). Client poll GET /chapters/:id. */
chapterRoutes.post("/:id/reanalyze", async (req, res) => {
  const { chapter, doc } = await findOwnedChapter(req.params.id, req.userId);
  if (isAnalyzing(chapter.id)) throw new HttpError(409, "Bài này đang được soạn");
  await reanalyzeChapter(doc, chapter);
  res.status(202).json({ status: "analyzing" });
});

/** Bổ sung bài giảng cho các mục con của sách mà bài chưa nói tới (1 lượt AI). */
chapterRoutes.post("/:id/supplement", async (req, res) => {
  const { chapter, doc } = await findOwnedChapter(req.params.id, req.userId);
  await supplementChapter(doc, chapter);
  const summary = await Summary.findOne({ where: { chapter_id: chapter.id } });
  res.json({ grounding: summary?.grounding ?? null });
});

chapterRoutes.delete("/:id/questions/:questionId", async (req, res) => {
  const { chapter } = await findOwnedChapter(req.params.id, req.userId);
  await Question.destroy({ where: { id: req.params.questionId, chapter_id: chapter.id } });
  res.status(204).end();
});
