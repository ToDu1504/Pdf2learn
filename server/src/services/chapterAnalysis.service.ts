import { Op } from "sequelize";
import { env } from "../config/env.js";
import { Chapter, Document, Flashcard, Question, Summary } from "../models/index.js";
import { pdfPath } from "../middlewares/upload.js";
import { analyzeChapter, analyzeChapterBatch, generateQuestions, summarizeChapter, supplementLesson } from "./ai/content.service.js";
import { QuotaExhaustedError } from "./ai/gemini.client.js";
import { applyGrounding, missingSubtopics, type LessonQuote, type Subtopic } from "./ai/grounding.js";
import { chapterPages, chapterSource, withPageLabels } from "./ai/source.js";
import { readPdfMeta, type OutlineNode } from "./pdf.service.js";
import { subtopicsOf } from "./roadmap.service.js";

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

/* ---------------- mục con trong sách (kiểm tra độ phủ của bài giảng) ---------------- */

const treeCache = new Map<number, Promise<OutlineNode[]>>();
export function outlineTree(doc: Document) {
  let p = treeCache.get(doc.id);
  if (!p) {
    p = readPdfMeta(pdfPath(doc.file_path)).then((m) => m.tree);
    p.catch(() => treeCache.delete(doc.id));
    treeCache.set(doc.id, p);
    if (treeCache.size > 3) treeCache.delete(treeCache.keys().next().value as number);
  }
  return p;
}

/** Bài tạo trước khi có cột subtopics: tính từ bookmark của PDF (1 lần, lưu lại). */
export async function ensureSubtopics(doc: Document, chapter: Chapter): Promise<Subtopic[]> {
  if (chapter.subtopics) return chapter.subtopics;
  const tree = await outlineTree(doc).catch(() => [] as OutlineNode[]);
  const subtopics = subtopicsOf(tree, { from: chapter.start_page, to: chapter.end_page, source_title: chapter.source_title ?? chapter.title });
  await chapter.update({ subtopics });
  return subtopics;
}

type AnalysisResult = Awaited<ReturnType<typeof analyzeChapter>>;

/**
 * Lưu kết quả 1 chương (idempotent) SAU KHI ĐỐI CHIẾU VỚI SÁCH: ý/thuật ngữ/câu hỏi không có câu trích nguyên văn
 * tìm thấy trong text trang bị loại; dẫn nguồn trong bài giảng được gắn trang thật hoặc "chưa kiểm chứng".
 */
async function saveResult(doc: Document, chapter: Chapter, result: AnalysisResult) {
  const [pages, subtopics] = await Promise.all([chapterPages(chapter, doc.id), ensureSubtopics(doc, chapter)]);
  const g = applyGrounding({
    pages,
    subtopics,
    lesson_md: result.summary.lesson_md,
    lesson_quotes: result.lesson_quotes,
    key_points: result.summary.key_points,
    key_terms: result.summary.key_terms,
    questions: result.questions,
  });
  if (!(await Summary.count({ where: { chapter_id: chapter.id } }))) {
    await Summary.create({
      chapter_id: chapter.id,
      overview: result.summary.overview,
      lesson_md: g.lesson_md,
      key_points: g.key_points,
      key_terms: g.key_terms,
      evidence: g.evidence,
      grounding: g.grounding,
    });
  }
  if (!(await Question.count({ where: { chapter_id: chapter.id } }))) await Question.bulkCreate(g.questions);
  await syncFlashcards(doc, chapter);
  await chapter.update({ status: "done" });
  const st = g.grounding;
  console.log(
    `[grounding] chương ${chapter.id}: dẫn chứng ${st.lesson.verified}/${st.lesson.total}, loại ${st.points.dropped} ý, ${st.terms.dropped} thuật ngữ, ` +
      `${st.questions.dropped} câu hỏi; thiếu ${st.missing.length}/${st.subtopics} mục con`,
  );
}

/**
 * Flashcard = thuật ngữ đã kiểm chứng của bài. Giữ thẻ cũ cùng mặt trước (giữ lịch ôn), thêm thẻ mới,
 * xóa thẻ của thuật ngữ đã bị loại.
 */
async function syncFlashcards(doc: Document, chapter: Chapter) {
  const summary = await Summary.findOne({ where: { chapter_id: chapter.id } });
  if (!summary) return;
  const terms = summary.key_terms.filter((t) => t.verified !== false || summary.grounding?.mode === "file");
  const cards = await Flashcard.findAll({ where: { chapter_id: chapter.id, user_id: doc.user_id } });
  const fronts = new Set(terms.map((t) => t.term));
  await Flashcard.destroy({ where: { id: cards.filter((c) => !fronts.has(c.front)).map((c) => c.id) } });
  const have = new Set(cards.map((c) => c.front));
  await Flashcard.bulkCreate(
    terms.filter((t) => !have.has(t.term)).map((t) => ({ chapter_id: chapter.id, user_id: doc.user_id, front: t.term, back: `${t.definition} (tr. ${t.page})` })),
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
      evidence: summary.evidence,
      grounding: summary.grounding,
    });
  }
  if (!(await Question.count({ where: { chapter_id: chapter.id } }))) {
    const qs = await Question.findAll({ where: { chapter_id: source.id } });
    await Question.bulkCreate(
      qs.map(({ type, difficulty, content, options, correct_answer, explanation, source_page, topic, source_quote, verified }) => ({
        chapter_id: chapter.id, type, difficulty, content, options, correct_answer, explanation, source_page, topic, source_quote, verified,
      })),
    );
  }
  await syncFlashcards(doc, chapter);
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
  const subtopics = await ensureSubtopics(doc, chapter);
  if (!hasSummary && !hasQuestions) return saveResult(doc, chapter, await analyzeChapter(chapter, src, doc.user_id, QUESTIONS_PER_CHAPTER, subtopics));
  if (!hasSummary) {
    const summary = await summarizeChapter(chapter, src, doc.user_id);
    const g = applyGrounding({ pages: src.pages, subtopics, key_points: summary.key_points, key_terms: summary.key_terms });
    await Summary.create({ chapter_id: chapter.id, overview: summary.overview, key_points: g.key_points, key_terms: g.key_terms, grounding: g.grounding });
  }
  if (!hasQuestions) {
    await generateQuestions(chapter, src, doc.user_id, { count: QUESTIONS_PER_CHAPTER, types: ["mcq", "true_false"], difficulty: "mixed" });
  }
  await syncFlashcards(doc, chapter);
  await chapter.update({ status: "done" });
}

async function runBatch(doc: Document, batch: Chapter[]) {
  // 1. Cache
  const todo: Chapter[] = [];
  for (const c of batch) if (!(await copyFromTwin(doc, c))) todo.push(c);
  if (!todo.length) return;

  // 2. Chương có text và chưa có kết quả nào → gộp 1 lượt; còn lại (scan / dở dang) → làm riêng.
  const textItems: { chapter: Chapter; text: string; subtopics: Subtopic[] }[] = [];
  const singles: Chapter[] = [];
  for (const c of todo) {
    const partial = (await Summary.count({ where: { chapter_id: c.id } })) + (await Question.count({ where: { chapter_id: c.id } }));
    const pages = partial ? null : await chapterPages(c, doc.id);
    if (pages) textItems.push({ chapter: c, text: withPageLabels(pages), subtopics: await ensureSubtopics(doc, c) });
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

/**
 * Soạn lại bài theo quy tắc kiểm chứng (bài soạn trước khi có quy tắc, hoặc người học thấy sai):
 * xóa bài giảng + câu hỏi cũ rồi soạn lại; flashcard giữ thẻ trùng thuật ngữ (giữ lịch ôn).
 */
export async function reanalyzeChapter(doc: Document, chapter: Chapter) {
  if (inFlight.has(chapter.id)) return;
  await Summary.destroy({ where: { chapter_id: chapter.id } });
  await Question.destroy({ where: { chapter_id: chapter.id } });
  await chapter.update({ status: "pending" });
  lastError.delete(chapter.id);
  const job = (async () => {
    const src = await chapterSource(chapter, doc);
    const subtopics = await ensureSubtopics(doc, chapter);
    await saveResult(doc, chapter, await analyzeChapter(chapter, src, doc.user_id, QUESTIONS_PER_CHAPTER, subtopics));
  })();
  inFlight.set(chapter.id, job);
  job
    .catch(async (err) => {
      lastError.set(chapter.id, err instanceof QuotaExhaustedError ? err.message : `AI xử lý chương lỗi: ${(err as Error).message.slice(0, 200)}`);
      if (!(err instanceof QuotaExhaustedError)) await chapter.update({ status: "failed" }).catch(() => {});
    })
    .finally(() => inFlight.get(chapter.id) === job && inFlight.delete(chapter.id));
}

/**
 * Bổ sung bài giảng cho các mục con của sách mà bài chưa nói tới: 1 lượt AI chỉ với các trang của mục thiếu,
 * kiểm chứng như bài chính, chèn vào trước mục "Ghi nhớ" (nếu có).
 */
export async function supplementChapter(doc: Document, chapter: Chapter) {
  const summary = await Summary.findOne({ where: { chapter_id: chapter.id } });
  const missing = summary?.grounding?.missing ?? [];
  if (!summary || !summary.lesson_md || !summary.grounding || !missing.length) return;
  const pages = await chapterPages(chapter, doc.id);
  if (!pages) return;

  const raw = await supplementLesson(chapter, pages, missing, doc.user_id);
  // Đánh lại số k để không trùng dẫn chứng cũ.
  const offset = Math.max(0, ...(summary.evidence ?? []).map((e) => e.k));
  const quotes: LessonQuote[] = raw.lesson_quotes.map((q) => ({ ...q, k: q.k + offset }));
  const md = raw.lesson.replace(/\[\^(\d+)\]/g, (_m, k: string) => `[^${Number(k) + offset}]`);
  const g = applyGrounding({ pages, subtopics: [], lesson_md: md, lesson_quotes: quotes });
  const evidence = [...(summary.evidence ?? []), ...g.evidence];

  const recall = summary.lesson_md.search(/^###\s*Ghi nhớ/im);
  const added = g.lesson_md ?? "";
  const lesson_md =
    recall >= 0 ? `${summary.lesson_md.slice(0, recall)}${added}\n\n${summary.lesson_md.slice(recall)}` : `${summary.lesson_md}\n\n${added}`;
  const verifiedPages = evidence.filter((e) => e.verified).map((e) => e.page);
  const prev = summary.grounding;
  await summary.update({
    lesson_md,
    evidence,
    grounding: {
      ...prev,
      lesson: { verified: prev.lesson.verified + g.grounding.lesson.verified, total: prev.lesson.total + g.grounding.lesson.total },
      missing: missingSubtopics(missing, verifiedPages),
    },
  });
}
