import { Question, type Chapter, type Difficulty, type QuestionType } from "../../models/index.js";
import { cutChapterPdf } from "../pdf.service.js";
import { generateJson } from "./gemini.client.js";
import * as P from "./prompts.js";
import * as S from "./schemas.js";
import { clampToChapter, type ChapterSource } from "./source.js";

/** Đổi page / page_end sang trang PDF gốc; page_end chỉ giữ khi thật sự lớn hơn page (tối đa 6 trang). */
function withRange<T extends { page: number; page_end?: number }>(k: T, toPage: (p: number) => number) {
  const page = toPage(k.page);
  const end = k.page_end ? toPage(k.page_end) : page;
  const { page_end: _drop, ...rest } = k;
  return end > page ? { ...rest, page, page_end: Math.min(end, page + 5) } : { ...rest, page };
}

/**
 * Đọc mục lục từ các trang đầu. Ưu tiên text đã trích (nhanh, không cần cắt PDF);
 * PDF scan thì gửi 15 trang đầu dạng file. Trả về trang bắt đầu (số trang PDF) của từng chương.
 */
export async function detectChaptersWithAi(opts: { filePath: string; pageCount: number; userId: number; headText: string | null }) {
  const content = opts.headText
    ? { text: opts.headText }
    : {
        inlineData: {
          data: Buffer.from(await cutChapterPdf(opts.filePath, 1, Math.min(15, opts.pageCount))).toString("base64"),
          mimeType: "application/pdf",
        },
      };
  const toc = await generateJson({
    parts: [content, { text: P.tocPrompt(opts.pageCount) }],
    responseSchema: S.tocSchema,
    parse: (raw) => S.TocZod.parse(raw),
    userId: opts.userId,
    feature: "split",
    temperature: 0,
  });
  return toc.chapters.map((c) => ({ title: c.title, page: c.start_page + toc.page_offset }));
}

export async function summarizeChapter(chapter: Chapter, src: ChapterSource, userId: number) {
  const data = await generateJson({
    parts: [...src.parts, { text: P.summaryPrompt(chapter.title) }],
    responseSchema: S.summarySchema,
    parse: (raw) => S.SummaryZod.parse(raw),
    userId,
    feature: "summarize",
  });
  return {
    overview: data.overview,
    key_points: data.key_points.map((k) => withRange(k, src.toPage)),
    key_terms: data.key_terms.map((k) => withRange(k, src.toPage)),
  };
}

/** Pipeline: tóm tắt + câu hỏi trong 1 lượt gọi. */
export async function analyzeChapter(chapter: Chapter, src: ChapterSource, userId: number, questionCount: number) {
  const { summary, lesson, questions } = await generateJson({
    parts: [...src.parts, { text: P.analysisPrompt(chapter.title, questionCount) }],
    responseSchema: S.analysisSchema,
    parse: (raw) => S.AnalysisZod.parse(raw),
    userId,
    feature: "summarize",
    temperature: 0.4,
  });
  return {
    summary: {
      lesson_md: lesson,
      overview: summary.overview,
      key_points: summary.key_points.map((k) => withRange(k, src.toPage)),
      key_terms: summary.key_terms.map((k) => withRange(k, src.toPage)),
    },
    questions: questions.map((q) => ({
      chapter_id: chapter.id,
      type: q.type,
      difficulty: q.difficulty,
      content: q.content,
      options: q.options ?? null,
      correct_answer: q.correct_answer,
      explanation: q.explanation,
      source_page: src.toPage(q.source_page),
      topic: q.topic,
    })),
  };
}

/**
 * Nhiều chương (dạng text) trong 1 lượt gọi. Trả về kết quả theo chapter_id;
 * chương nào AI bỏ sót hoặc trả sai sẽ không có trong Map (người gọi xử lý lại riêng).
 */
export async function analyzeChapterBatch(items: { chapter: Chapter; text: string }[], userId: number, questionCount: number) {
  const body = items
    .map(({ chapter, text }) => `=== CHƯƠNG id=${chapter.id}: "${chapter.title}" (trang ${chapter.start_page}–${chapter.end_page}) ===\n${text}`)
    .join("\n\n");
  const results = await generateJson({
    parts: [{ text: body }, { text: P.batchAnalysisPrompt(items.map((i) => ({ id: i.chapter.id, title: i.chapter.title })), questionCount) }],
    responseSchema: S.batchAnalysisSchema,
    parse: (raw) => S.BatchAnalysisZod.parse(raw),
    userId,
    feature: "summarize",
    temperature: 0.4,
  });
  const out = new Map<number, Awaited<ReturnType<typeof analyzeChapter>>>();
  for (const r of results) {
    const chapter = items.find((i) => i.chapter.id === r.chapter_id)?.chapter;
    if (!chapter || out.has(chapter.id)) continue;
    const toPage = (p: number) => clampToChapter(p, chapter);
    out.set(chapter.id, {
      summary: {
        lesson_md: r.lesson,
        overview: r.summary.overview,
        key_points: r.summary.key_points.map((k) => withRange(k, toPage)),
        key_terms: r.summary.key_terms.map((k) => withRange(k, toPage)),
      },
      questions: r.questions.map((q) => ({
        chapter_id: chapter.id,
        type: q.type,
        difficulty: q.difficulty,
        content: q.content,
        options: q.options ?? null,
        correct_answer: q.correct_answer,
        explanation: q.explanation,
        source_page: toPage(q.source_page),
        topic: q.topic,
      })),
    });
  }
  return out;
}

export async function generateQuestions(
  chapter: Chapter,
  src: ChapterSource,
  userId: number,
  opts: { count: number; types: QuestionType[]; difficulty: Difficulty | "mixed" },
) {
  const existing = await Question.findAll({ where: { chapter_id: chapter.id }, attributes: ["content"], limit: 60 });
  const questions = await generateJson({
    parts: [...src.parts, { text: P.quizPrompt({ ...opts, existing: existing.map((q) => q.content) }) }],
    responseSchema: S.quizSchema,
    parse: (raw) => S.QuizZod.parse(raw),
    userId,
    feature: "quiz",
    temperature: 0.6,
  });
  return Question.bulkCreate(
    questions
      .filter((q) => opts.types.includes(q.type))
      .map((q) => ({
        chapter_id: chapter.id,
        type: q.type,
        difficulty: opts.difficulty === "mixed" ? q.difficulty : opts.difficulty,
        content: q.content,
        options: q.options ?? null,
        correct_answer: q.correct_answer,
        explanation: q.explanation,
        source_page: src.toPage(q.source_page),
        topic: q.topic,
      })),
  );
}

export async function gradeShortAnswer(question: Question, answer: string, userId: number) {
  return generateJson({
    parts: [{ text: P.gradePrompt(question.content, question.correct_answer, answer) }],
    responseSchema: S.gradeSchema,
    parse: (raw) => S.GradeZod.parse(raw),
    userId,
    feature: "grade",
    temperature: 0.2,
  });
}

export async function generateMindmap(title: string, summary: S.SummaryData, userId: number) {
  const { mermaid } = await generateJson({
    parts: [{ text: P.mindmapPrompt(title, JSON.stringify(summary)) }],
    responseSchema: S.mindmapSchema,
    parse: (raw) => S.MindmapZod.parse(raw),
    userId,
    feature: "mindmap",
  });
  return mermaid;
}

export async function readChapterExcerpts(src: ChapterSource, question: string, userId: number) {
  const res = await generateJson({
    parts: [...src.parts, { text: P.readChapterPrompt(question) }],
    responseSchema: S.excerptSchema,
    parse: (raw) => S.ExcerptZod.parse(raw),
    userId,
    feature: "tutor",
    temperature: 0.1,
  });
  return { ...res, excerpts: res.excerpts.map((e) => ({ ...e, page: src.toPage(e.page) })) };
}
