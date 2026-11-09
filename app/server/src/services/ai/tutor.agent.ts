import { Type, type Content, type FunctionDeclaration, type Part } from "@google/genai";
import { QueryTypes } from "sequelize";
import { z } from "zod";
import { sequelize } from "../../config/db.js";
import { Chapter, Question, Summary, type Document } from "../../models/index.js";
import { withRetry } from "../../utils/withRetry.js";
import { ai, assertAiConfigured, logUsage, withModelFallback } from "./gemini.client.js";
import { chapterSource } from "./source.js";
import { generateQuestions, readChapterExcerpts } from "./content.service.js";
import { tutorSystemPrompt } from "./prompts.js";
import { analyzeFrom } from "../chapterAnalysis.service.js";

const MAX_STEPS = 5;

export type TutorQuizItem = {
  id: number;
  type: string;
  content: string;
  options: string[] | null;
  correct_answer: string;
  explanation: string;
  source_page: number;
};

export type TutorEvent =
  | { type: "text"; delta: string }
  | { type: "tool"; name: string; args: unknown }
  | { type: "quiz"; chapterTitle: string; questions: TutorQuizItem[] };

type Ctx = { userId: number; doc: Document; emit: (e: TutorEvent) => void };

const declarations: FunctionDeclaration[] = [
  { name: "list_chapters", description: "Danh sách chương của giáo trình kèm khoảng trang." },
  {
    name: "get_chapter_summary",
    description: "Lấy bản tóm tắt, ý chính và khái niệm của 1 chương (rẻ, nên gọi trước).",
    parameters: { type: Type.OBJECT, properties: { chapterId: { type: Type.INTEGER } }, required: ["chapterId"] },
  },
  {
    name: "read_chapter",
    description: "Đọc nội dung gốc của 1 chương để tìm đoạn liên quan tới câu hỏi, kèm số trang. Dùng khi tóm tắt không đủ chi tiết.",
    parameters: {
      type: Type.OBJECT,
      properties: { chapterId: { type: Type.INTEGER }, question: { type: Type.STRING } },
      required: ["chapterId", "question"],
    },
  },
  { name: "get_weak_topics", description: "Các chủ đề người học hay làm sai trong giáo trình này." },
  {
    name: "create_quiz",
    description: "Tạo bài ôn nhanh hiển thị ngay trong khung chat.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        chapterId: { type: Type.INTEGER },
        difficulty: { type: Type.STRING, enum: ["easy", "medium", "hard"] },
        count: { type: Type.INTEGER, description: "1–5" },
      },
      required: ["chapterId"],
    },
  },
];

const chapterArg = z.object({ chapterId: z.coerce.number().int() });

/** chapterId từ AI chỉ được dùng nếu thuộc đúng tài liệu này (userId/documentId do server gắn). */
async function ownChapter(ctx: Ctx, args: unknown) {
  const { chapterId } = chapterArg.parse(args);
  const chapter = await Chapter.findOne({ where: { id: chapterId, document_id: ctx.doc.id } });
  if (!chapter) throw new Error(`Chương ${chapterId} không thuộc giáo trình này`);
  return chapter;
}

const handlers: Record<string, (args: unknown, ctx: Ctx) => Promise<unknown>> = {
  async list_chapters(_args, ctx) {
    const chapters = await Chapter.findAll({ where: { document_id: ctx.doc.id }, order: [["order_index", "ASC"]] });
    return chapters.map((c) => ({ id: c.id, title: c.title, pages: `${c.start_page}-${c.end_page}` }));
  },
  async get_chapter_summary(args, ctx) {
    const chapter = await ownChapter(ctx, args);
    let s = await Summary.findOne({ where: { chapter_id: chapter.id } });
    if (!s) {
      // Tóm tắt theo yêu cầu (lazy): làm ngay rồi trả về.
      await analyzeFrom(ctx.doc, chapter.id);
      s = await Summary.findOne({ where: { chapter_id: chapter.id } });
    }
    if (!s) return { error: "Chương chưa được tóm tắt" };
    return { title: chapter.title, overview: s.overview, key_points: s.key_points, key_terms: s.key_terms };
  },
  async read_chapter(args, ctx) {
    const chapter = await ownChapter(ctx, args);
    const { question } = z.object({ question: z.string().min(1) }).parse(args);
    return readChapterExcerpts(await chapterSource(chapter, ctx.doc), question, ctx.userId);
  },
  async get_weak_topics(_args, ctx) {
    return sequelize.query(
      `SELECT q.topic, c.title AS chapter, COUNT(*) AS total, SUM(aa.is_correct = 0) AS wrong
         FROM attempt_answers aa
         JOIN quiz_attempts qa ON qa.id = aa.attempt_id
         JOIN questions q ON q.id = aa.question_id
         JOIN chapters c ON c.id = q.chapter_id
        WHERE qa.user_id = :userId AND qa.document_id = :documentId AND aa.is_correct IS NOT NULL
        GROUP BY q.topic, c.title HAVING wrong > 0 ORDER BY wrong DESC LIMIT 10`,
      { replacements: { userId: ctx.userId, documentId: ctx.doc.id }, type: QueryTypes.SELECT },
    );
  },
  async create_quiz(args, ctx) {
    const chapter = await ownChapter(ctx, args);
    const { difficulty, count } = z
      .object({ difficulty: z.enum(["easy", "medium", "hard"]).optional(), count: z.coerce.number().int().min(1).max(5).default(3) })
      .parse(args);
    const where: Record<string, unknown> = { chapter_id: chapter.id, type: ["mcq", "true_false"] };
    if (difficulty) where.difficulty = difficulty;
    let questions = await Question.findAll({ where, order: sequelize.random(), limit: count });
    if (questions.length < count) {
      const extra = await generateQuestions(chapter, await chapterSource(chapter, ctx.doc), ctx.userId, {
        count: count - questions.length,
        types: ["mcq"],
        difficulty: difficulty ?? "medium",
      });
      questions = [...questions, ...extra];
    }
    const items = questions.map((q) => ({
      id: q.id,
      type: q.type,
      content: q.content,
      options: q.options,
      correct_answer: q.correct_answer,
      explanation: q.explanation,
      source_page: q.source_page,
    }));
    ctx.emit({ type: "quiz", chapterTitle: chapter.title, questions: items });
    return { shown_to_user: items.length, topics: [...new Set(questions.map((q) => q.topic))] };
  },
};

export type ToolLog = { name: string; args: unknown; quiz?: Extract<TutorEvent, { type: "quiz" }> };

/**
 * Vòng lặp agent: gọi Gemini kèm tool → chạy tool → gửi kết quả lại, tối đa MAX_STEPS vòng.
 * Text được stream ra ngay khi nhận (emit), function call được gom lại sau mỗi lượt.
 */
export async function runTutor(ctx: Ctx, history: Content[]) {
  assertAiConfigured();
  const chapters = await Chapter.findAll({ where: { document_id: ctx.doc.id }, order: [["order_index", "ASC"]] });
  const systemInstruction = tutorSystemPrompt(ctx.doc.title, chapters.map((c) => `${c.id}: ${c.title}`).join("\n"));
  const contents = [...history];
  const toolLogs: ToolLog[] = [];
  let answer = "";

  const emit: Ctx["emit"] = (e) => {
    if (e.type === "quiz") toolLogs.push({ name: "create_quiz", args: {}, quiz: e });
    ctx.emit(e);
  };

  for (let step = 0; step < MAX_STEPS; step++) {
    const stream = await withModelFallback((model) =>
      withRetry(() =>
        ai().models.generateContentStream({
          model,
          contents,
          config: { systemInstruction, tools: [{ functionDeclarations: declarations }], temperature: 0.4 },
        }),
      ),
    );

    const parts: Part[] = [];
    let usage;
    for await (const chunk of stream) {
      usage = chunk.usageMetadata ?? usage;
      for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
        parts.push(part);
        if (part.text && !part.thought) {
          answer += part.text;
          ctx.emit({ type: "text", delta: part.text });
        }
      }
    }
    await logUsage(ctx.userId, "tutor", usage);

    const calls = parts.filter((p) => p.functionCall).map((p) => p.functionCall!);
    if (!calls.length) return { answer: answer.trim(), toolLogs };

    // Giữ nguyên các part (kể cả thought signature) để Gemini hiểu ngữ cảnh lượt sau.
    contents.push({ role: "model", parts });
    const responses: Part[] = [];
    for (const call of calls) {
      const name = call.name ?? "";
      ctx.emit({ type: "tool", name, args: call.args });
      toolLogs.push({ name, args: call.args });
      let output: unknown;
      try {
        const handler = handlers[name];
        output = handler ? await handler(call.args ?? {}, { ...ctx, emit }) : { error: `Tool ${name} không tồn tại` };
      } catch (err) {
        output = { error: (err as Error).message };
      }
      responses.push({ functionResponse: { id: call.id, name, response: { output } } });
    }
    contents.push({ role: "user", parts: responses });
  }

  const fallback = "Câu hỏi hơi phức tạp, bạn thử hỏi cụ thể hơn nhé.";
  if (!answer.trim()) ctx.emit({ type: "text", delta: fallback });
  return { answer: answer.trim() || fallback, toolLogs };
}
