import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { Op } from "sequelize";
import { Chapter, Document, DocumentPage, RoadmapSection } from "../models/index.js";
import { pdfPath } from "../middlewares/upload.js";
import { buildRanges, extractPageTexts, fixedRanges, pickStudyChapters, readPdfMeta, type ChapterRange } from "../services/pdf.service.js";
import { annotateRoadmap, findNode, headingCandidates, REVIEW_TOPIC, roadmapReport, saveRoadmap, structureBook, subtopicsOf, type RoadmapReport } from "../services/roadmap.service.js";
import { detectChaptersWithAi } from "../services/ai/content.service.js";
import { headText } from "../services/ai/source.js";
import { analyzeFrom } from "../services/chapterAnalysis.service.js";
import { jobRunner } from "./jobRunner.js";
import { setProgress } from "./progressBus.js";

export function enqueueDocument(docId: number) {
  jobRunner.add(`doc:${docId}`, () => processDocument(docId));
}

export function hashFile(filePath: string) {
  return new Promise<string>((resolve, reject) => {
    const h = createHash("sha256");
    createReadStream(filePath).on("data", (d) => h.update(d)).on("end", () => resolve(h.digest("hex"))).on("error", reject);
  });
}

/** Tài liệu khác có cùng nội dung file (cache theo sha256). */
async function findTwin(doc: Document) {
  if (!doc.file_hash) return null;
  return Document.findOne({ where: { file_hash: doc.file_hash, id: { [Op.ne]: doc.id }, status: "done" }, order: [["id", "ASC"]] });
}

/**
 * Pipeline lúc upload: KHÔNG tóm tắt (tóm tắt làm theo yêu cầu khi mở chương, xem chapterAnalysis.service).
 *   1. sha256 file + metadata/bookmark                                      5%
 *   2. text từng trang → document_pages (chép từ file trùng nếu có)   → 80%
 *   3. tách chương: chép từ file trùng → bookmark → mục lục (AI) → chia đều  85%
 *   4. lập roadmap: chặng = chương, bài học = mục con (1 lượt AI, lỗi thì dựng từ bookmark)  100%
 * Xong thì tự tóm tắt sẵn lô chương đầu tiên (1 lượt gọi) để người học mở ra là có ngay.
 */
export async function processDocument(docId: number) {
  const doc = await Document.findByPk(docId);
  if (!doc || doc.status === "done") return;
  const file = pdfPath(doc.file_path);
  const started = Date.now();

  try {
    await setProgress(doc, { status: "processing", current_step: "metadata", error_message: null });
    if (!doc.file_hash) await doc.update({ file_hash: await hashFile(file) });
    const meta = await readPdfMeta(file);
    await setProgress(doc, { page_count: meta.pageCount, progress: 5 });
    const twin = await findTwin(doc);

    if ((await DocumentPage.count({ where: { document_id: doc.id } })) !== meta.pageCount) {
      await setProgress(doc, { current_step: "extract" });
      await DocumentPage.destroy({ where: { document_id: doc.id } });
      const twinPages = twin ? await DocumentPage.findAll({ where: { document_id: twin.id }, order: [["page", "ASC"]] }) : [];
      const texts =
        twinPages.length === meta.pageCount
          ? twinPages.map((p) => p.text)
          : await extractPageTexts(file, (done, total) => void setProgress(doc, { progress: 5 + Math.round((done / total) * 75) }));
      for (let i = 0; i < texts.length; i += 200) {
        await DocumentPage.bulkCreate(texts.slice(i, i + 200).map((text, k) => ({ document_id: doc.id, page: i + k + 1, text })));
      }
    }
    await setProgress(doc, { progress: 80 });

    let chapters = await Chapter.findAll({ where: { document_id: doc.id }, order: [["order_index", "ASC"]] });
    if (!chapters.length && twin && (await copyRoadmap(twin.id, doc.id))) {
      chapters = await Chapter.findAll({ where: { document_id: doc.id }, order: [["order_index", "ASC"]] });
    }
    if (!chapters.length) {
      await buildRoadmap(doc, meta);
      chapters = await Chapter.findAll({ where: { document_id: doc.id }, order: [["order_index", "ASC"]] });
    }

    await setProgress(doc, { status: "done", current_step: "done", progress: 100 });
    console.log(`[doc ${doc.id}] sẵn sàng: ${chapters.length} chương, ${meta.pageCount} trang, ${Math.round((Date.now() - started) / 1000)}s${twin ? ` (dùng lại dữ liệu doc ${twin.id})` : ""}`);

    // Tóm tắt sẵn lô đầu tiên (không chặn; lỗi/hết lượt thì người học mở chương sẽ thấy và thử lại).
    const first = chapters.find((c) => c.status !== "done");
    if (first) analyzeFrom(doc, first.id).catch(() => {});
  } catch (err) {
    console.error(`[doc ${doc.id}]`, err);
    await setProgress(doc, { status: "failed", error_message: (err as Error).message.slice(0, 1000) });
  }
}

type PdfMeta = Awaited<ReturnType<typeof readPdfMeta>>;

/**
 * Lập roadmap bám sát sách: chương (bookmark → mục lục AI đọc → chia đều) → cấu trúc bài học từ mục con
 * (tất định) → 1 lượt AI đặt tên tiếng Việt/mô tả → lưu kèm báo cáo đối chiếu. Bài cũ cùng khoảng trang được giữ.
 */
async function buildRoadmap(doc: Document, meta: PdfMeta) {
  await setProgress(doc, { current_step: "split" });
  const file = pdfPath(doc.file_path);
  let source: RoadmapReport["source"] = "bookmark";
  let ranges = pickStudyChapters(buildRanges(meta.outline, meta.pageCount));
  if (ranges.length < 2) {
    source = "toc";
    const starts = await detectChaptersWithAi({
      filePath: file,
      pageCount: meta.pageCount,
      userId: doc.user_id,
      headText: await headText(doc.id, meta.pageCount),
    }).catch((err) => {
      console.warn("[split] AI không đọc được mục lục:", (err as Error).message);
      return [];
    });
    ranges = pickStudyChapters(buildRanges(starts, meta.pageCount));
  }
  if (ranges.length < 2) {
    source = "fixed";
    ranges = fixedRanges(meta.pageCount);
  }

  await setProgress(doc, { current_step: "roadmap", progress: 85 });
  const pages = await DocumentPage.findAll({ where: { document_id: doc.id }, attributes: ["page", "text"], order: [["page", "ASC"]] });
  // Mục con của chương: bookmark; chương không có bookmark con → tiêu đề dò từ text trang.
  const itemsOf = (r: ChapterRange) => {
    const kids = findNode(meta.tree, r)?.children ?? [];
    if (kids.some((k) => !REVIEW_TOPIC.test(k.title.trim()))) return kids;
    const heads = headingCandidates(pages.filter((p) => p.page >= r.start_page && p.page <= r.end_page));
    return [...kids, ...heads.map((h) => ({ ...h, children: [] }))];
  };
  const { plan, ai } = await annotateRoadmap(doc, structureBook(ranges, itemsOf));
  for (const s of plan) for (const l of s.lessons) l.subtopics = subtopicsOf(meta.tree, l);
  const report = roadmapReport(plan, meta.pageCount, meta.tree, source, ai);
  const { lessons, kept } = await saveRoadmap(doc, plan, report);
  console.log(
    `[roadmap] doc ${doc.id}: ${plan.length} chặng, ${lessons} bài (${source}${ai ? " + AI đặt tên" : ""}), ` +
      `phủ ${report.covered}/${meta.pageCount} trang${kept ? `, giữ ${kept} bài cũ` : ""}`,
  );
}

/** Cache theo file: chép roadmap (chặng + bài học) từ tài liệu trùng file. */
async function copyRoadmap(fromDocId: number, toDocId: number) {
  const sections = await RoadmapSection.findAll({ where: { document_id: fromDocId }, order: [["order_index", "ASC"]] });
  if (!sections.length) return false;
  const chapters = await Chapter.findAll({ where: { document_id: fromDocId }, order: [["order_index", "ASC"]] });
  for (const s of sections) {
    const copy = await RoadmapSection.create({ document_id: toDocId, order_index: s.order_index, title: s.title, source_title: s.source_title, description: s.description });
    await Chapter.bulkCreate(
      chapters
        .filter((c) => c.section_id === s.id)
        .map(({ order_index, title, source_title, description, start_page, end_page, importance, est_minutes }) => ({
          document_id: toDocId, section_id: copy.id, order_index, title, source_title, description, start_page, end_page, importance, est_minutes,
        })),
    );
  }
  const from = await Document.findByPk(fromDocId, { attributes: ["roadmap_report"] });
  if (from?.roadmap_report) await Document.update({ roadmap_report: from.roadmap_report }, { where: { id: toDocId } });
  return true;
}

/**
 * Lập lại roadmap từ mục lục của sách. Bài nào giữ nguyên khoảng trang thì giữ bài giảng, câu hỏi,
 * flashcard và tiến độ; chỉ bài đổi ranh giới mới bị thay.
 */
export async function rebuildRoadmap(doc: Document) {
  await setProgress(doc, { status: "queued", current_step: "roadmap", progress: 80, error_message: null });
  jobRunner.add(`doc:${doc.id}`, async () => {
    try {
      await setProgress(doc, { status: "processing", current_step: "metadata", progress: 80, error_message: null });
      await buildRoadmap(doc, await readPdfMeta(pdfPath(doc.file_path)));
      await setProgress(doc, { status: "done", current_step: "done", progress: 100 });
    } catch (err) {
      console.error(`[roadmap ${doc.id}]`, err);
      // Roadmap cũ vẫn còn nguyên (saveRoadmap chạy trong transaction) → tài liệu vẫn dùng được.
      await setProgress(doc, { status: "done", current_step: "done", progress: 100, error_message: `Không lập lại được lộ trình: ${(err as Error).message}`.slice(0, 1000) });
    }
  });
}

/** Gọi khi server khởi động: xử lý tiếp các tài liệu dang dở. */
export async function resumePendingDocuments() {
  const pending = await Document.findAll({ where: { status: ["queued", "processing"] }, order: [["id", "ASC"]] });
  pending.forEach((d) => enqueueDocument(d.id));
  if (pending.length) console.log(`[job] resume ${pending.length} tài liệu`);
}
