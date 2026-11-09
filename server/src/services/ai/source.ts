import type { Part } from "@google/genai";
import { Op } from "sequelize";
import { DocumentPage, type Chapter, type Document } from "../../models/index.js";
import { pdfPath } from "../../middlewares/upload.js";
import { ensureEditablePdf, toDocumentPage } from "../pdf.service.js";
import { chapterFilePart } from "./gemini.client.js";

/**
 * Nội dung 1 chương gửi cho Gemini + cách đổi số trang AI trả về thành trang PDF gốc.
 * - "text": text trích sẵn (mỗi trang có nhãn [Trang N] theo PDF gốc) → nhanh, không upload, không hết hạn.
 * - "file": PDF cắt theo chương (chỉ dùng cho PDF scan/ảnh không có chữ).
 */
export type ChapterSource = { mode: "text" | "file"; parts: Part[]; toPage: (page: number) => number };

const MIN_CHARS_PER_PAGE = 200; // dưới mức này coi như trang scan
const MAX_EMPTY_RATIO = 0.3;

const clamp = (page: number, c: Pick<Chapter, "start_page" | "end_page">) =>
  Math.min(Math.max(Math.round(page), c.start_page), c.end_page);

export const clampToChapter = clamp;

/** Text của chương với nhãn [Trang N], hoặc null nếu là trang scan (không đủ chữ). */
export async function chapterText(chapter: Chapter, documentId: number): Promise<string | null> {
  const pages = await DocumentPage.findAll({
    where: { document_id: documentId, page: { [Op.between]: [chapter.start_page, chapter.end_page] } },
    order: [["page", "ASC"]],
  });
  const expected = chapter.end_page - chapter.start_page + 1;
  const chars = pages.reduce((n, p) => n + p.text.length, 0);
  const empty = pages.filter((p) => p.text.length < 50).length;
  const usable = pages.length === expected && chars / expected >= MIN_CHARS_PER_PAGE && empty / expected <= MAX_EMPTY_RATIO;
  return usable ? pages.map((p) => `[Trang ${p.page}]\n${p.text}`).join("\n\n") : null;
}

export async function chapterSource(chapter: Chapter, doc: Pick<Document, "id" | "file_path">): Promise<ChapterSource> {
  const body = await chapterText(chapter, doc.id);
  if (body) {
    return {
      mode: "text",
      parts: [
        { text: `NỘI DUNG CHƯƠNG "${chapter.title}" (trang ${chapter.start_page}–${chapter.end_page}):\n\n${body}` },
        {
          text: `Quy tắc số trang: page / source_page là số N trong nhãn [Trang N] đứng trước đoạn chứa kiến thức đó (trong khoảng ${chapter.start_page}–${chapter.end_page}).`,
        },
      ],
      toPage: (p) => clamp(p, chapter),
    };
  }

  const file = pdfPath(doc.file_path);
  await ensureEditablePdf(file);
  return {
    mode: "file",
    parts: [
      await chapterFilePart(chapter, file),
      { text: "Quy tắc số trang: page / source_page là số thứ tự trang trong file PDF đính kèm, bắt đầu từ 1 (KHÔNG phải số in trên giấy)." },
    ],
    toPage: (p) => toDocumentPage(p, chapter),
  };
}

/** Text các trang đầu (đọc mục lục). null nếu là PDF scan. */
export async function headText(documentId: number, pageCount: number) {
  const pages = await DocumentPage.findAll({
    where: { document_id: documentId, page: { [Op.lte]: Math.min(20, pageCount) } },
    order: [["page", "ASC"]],
  });
  if (pages.reduce((n, p) => n + p.text.length, 0) < 1000) return null;
  return pages.map((p) => `[Trang ${p.page}]\n${p.text}`).join("\n\n");
}
