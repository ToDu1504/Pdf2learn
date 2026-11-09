import { Op } from "sequelize";
import { env } from "../config/env.js";
import { Chapter, Document, Flashcard, Question, Summary } from "../models/index.js";
import { analyzeChapter, analyzeChapterBatch, generateQuestions, summarizeChapter } from "./ai/content.service.js";
import { QuotaExhaustedError } from "./ai/gemini.client.js";
import { chapterSource, chapterText } from "./ai/source.js";

export const QUESTIONS_PER_CHAPTER = 5; // bài học nhỏ (3–15 trang) → 5 câu kiểm tra

/**
 * Tóm tắt THEO YÊU CẦU (lazy) thay vì làm hết lúc upload:
 *   1. Cache theo file: cùng file PDF (cùng sha256) đã có chương cùng khoảng trang được tóm tắt → sao chép, 0 lượt AI.
 *   2. Gộp nhiều chương / 1 lượt gọi: chương được mở + vài chương kế tiếp (đoán người học đọc tiếp),
 *      giới hạn bởi BATCH_MAX_CHAPTERS và BATCH_MAX_CHARS.
 *   3. Chống gọi trùng: chương đang được xử lý thì các yêu cầu sau dùng chung promise.
 */
const inFlight = new Map<number, Promise<void>>();
const lastError = new Map<number, string>();

export const isAnalyzing = (chapterId: number) => inFlight.has(chapterId);
export const analyzeError = (chapterId: number) => lastError.get(chapterId) ?? null;

/** Lưu kết quả 1 chương (idempotent) + tạo flashcard từ khái niệm. */
async function saveResult(doc: Document, chapter: Chapter, result: Awaited<ReturnType<typeof analyzeChapter>>) {
  if (!(await Summary.count({ where: { chapter_id: chapter.id } }))) await Summary.create({ chapter_id: chapter.id, ...result.summary });
  if (!(await Question.count({ where: { chapter_id: chapter.id } }))) await Question.bulkCreate(result.questions);
  await ensureFlashcards(doc, chapter);
  await chapter.update({ status: "done" });
}

async function ensureFlashcards(doc: Document, chapter: Chapter) {
  if (await Flashcard.count({ where: { chapter_id: chapter.id, user_id: doc.user_id } })) return;
  const summary = await Summary.findOne({ where: { chapter_id: chapter.id } });
  if (!summary) return;
  await Flashcard.bulkCreate(
    summary.key_terms.map((t) => ({ chapter_id: chapter.id, user_id: doc.user_id, front: t.term, back: `${t.definition} (tr. ${t.page})` })),
  );
}

/** Cache theo nội dung file: chép kết quả từ tài liệu trùng file đã tóm tắt chương cùng khoảng trang. */
async function copyFromTwin(doc: Document, chapter: Chapter) {
  if (!doc.file_hash) return false;
  const twins = await Document.findAll({ where: { file_hash: doc.file_hash, id: { [Op.ne]: doc.id } }, attributes: ["id"] });
  if (!twins.length) return false;
  const source = await Chapter.findOne({
    where: {
      document_id: twins.map((t) => t.id),
      start_page: chapter.start_page,
      end_page: chapter.end_page,
      status: "done",
    },
  });
  const summary = source && (await Summary.findOne({ where: { chapter_id: source.id } }));
  if (!source || !summary) return false;

  if (!(await Summary.count({ where: { chapter_id: chapter.id } }))) {
    await Summary.create({
      chapter_id: chapter.id,
      overview: summary.overview,
      key_points: summary.key_points,
      key_terms: summary.key_terms,
      mindmap_mermaid: summary.mindmap_mermaid,
      lesson_md: summary.lesson_md,
    });
  }
  if (!(await Question.count({ where: { chapter_id: chapter.id } }))) {
    const qs = await Question.findAll({ where: { chapter_id: source.id } });
    await Question.bulkCreate(
      qs.map(({ type, difficulty, content, options, correct_answer, explanation, source_page, topic }) => ({
        chapter_id: chapter.id, type, difficulty, content, options, correct_answer, explanation, source_page, topic,
      })),
    );
  }
  await ensureFlashcards(doc, chapter);
  await chapter.update({ status: "done" });
  return true;
}

/** Chương đã có 1 phần kết quả (vd. lỗi giữa chừng): chỉ làm phần còn thiếu. */
async function analyzeSingle(doc: Document, chapter: Chapter) {
  const src = await chapterSource(chapter, doc);
  const [hasSummary, hasQuestions] = await Promise.all([
    Summary.count({ where: { chapter_id: chapter.id } }),
    Question.count({ where: { chapter_id: chapter.id } }),
  ]);
  if (!hasSummary && !hasQuestions) return saveResult(doc, chapter, await analyzeChapter(chapter, src, doc.user_id, QUESTIONS_PER_CHAPTER));
  if (!hasSummary) await Summary.create({ chapter_id: chapter.id, ...(await summarizeChapter(chapter, src, doc.user_id)) });
  if (!hasQuestions) {
    await generateQuestions(chapter, src, doc.user_id, { count: QUESTIONS_PER_CHAPTER, types: ["mcq", "true_false"], difficulty: "mixed" });
  }
  await ensureFlashcards(doc, chapter);
  await chapter.update({ status: "done" });
}

async function runBatch(doc: Document, batch: Chapter[]) {
  // 1. Cache
  const todo: Chapter[] = [];
  for (const c of batch) if (!(await copyFromTwin(doc, c))) todo.push(c);
  if (!todo.length) return;

  // 2. Chương có text và chưa có kết quả nào → gộp 1 lượt; còn lại (scan / dở dang) → làm riêng.
  const textItems: { chapter: Chapter; text: string }[] = [];
  const singles: Chapter[] = [];
  for (const c of todo) {
    const partial = (await Summary.count({ where: { chapter_id: c.id } })) + (await Question.count({ where: { chapter_id: c.id } }));
    const text = partial ? null : await chapterText(c, doc.id);
    if (text) textItems.push({ chapter: c, text });
    else singles.push(c);
  }

  if (textItems.length === 1) singles.unshift(textItems.pop()!.chapter);
  if (textItems.length) {
    const results = await analyzeChapterBatch(textItems, doc.user_id, QUESTIONS_PER_CHAPTER);
    for (const { chapter } of textItems) {
      const r = results.get(chapter.id);
      if (r) await saveResult(doc, chapter, r);
      else singles.push(chapter); // AI bỏ sót chương này → làm riêng
    }
    console.log(`[ai] gộp ${textItems.length} chương / 1 lượt gọi (doc ${doc.id})`);
  }
  for (const c of singles) await analyzeSingle(doc, c);
}

/**
 * Đảm bảo chương `chapterId` có tóm tắt + câu hỏi. Kèm theo vài chương kế tiếp chưa làm (prefetch)
 * trong cùng 1 lượt gọi. Trả về promise hoàn thành khi chương được yêu cầu xong.
 */
export function analyzeFrom(doc: Document, chapterId: number): Promise<void> {
  const existing = inFlight.get(chapterId);
  if (existing) return existing;

  const job = (async () => {
    const chapters = await Chapter.findAll({ where: { document_id: doc.id }, order: [["order_index", "ASC"]] });
    const idx = chapters.findIndex((c) => c.id === chapterId);
    if (idx < 0 || chapters[idx].status === "done") return;

    // Chọn lô: chương được mở + các chương kế tiếp chưa làm, tới khi chạm giới hạn số chương / số ký tự.
    const batch: Chapter[] = [];
    let chars = 0;
    for (const c of chapters.slice(idx)) {
      if (batch.length >= env.BATCH_MAX_CHAPTERS) break;
      if (c.status === "done" || (c.id !== chapterId && inFlight.has(c.id))) continue;
      if (c.id !== chapterId && c.status === "failed") continue; // không tự thử lại chương lỗi khác
      const size = (c.end_page - c.start_page + 1) * 2500; // ước lượng ~2.5k ký tự/trang
      if (batch.length && chars + size > env.BATCH_MAX_CHARS) break;
      batch.push(c);
      chars += size;
    }

    const p = runBatch(doc, batch);
    for (const c of batch) if (c.id !== chapterId) inFlight.set(c.id, p);
    try {
      await p;
      batch.forEach((c) => lastError.delete(c.id));
    } catch (err) {
      const message = err instanceof QuotaExhaustedError ? err.message : `AI xử lý chương lỗi: ${(err as Error).message.slice(0, 200)}`;
      for (const c of batch) {
        lastError.set(c.id, message);
        // Hết lượt: giữ "pending" để hôm sau mở lại là làm tiếp; lỗi khác: đánh dấu "failed".
        if (err instanceof QuotaExhaustedError) continue;
        await c.reload();
        if (c.status !== "done") await c.update({ status: "failed" });
      }
      console.error(`[chapter ${chapterId}]`, message);
      throw err;
    } finally {
      for (const c of batch) if (inFlight.get(c.id) === p) inFlight.delete(c.id);
    }
  })();

  inFlight.set(chapterId, job);
  job.finally(() => inFlight.get(chapterId) === job && inFlight.delete(chapterId)).catch(() => {});
  return job;
}
