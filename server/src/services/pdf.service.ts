import { execFile } from "node:child_process";
import { readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { PDFDocument } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export type ChapterRange = { title: string; start_page: number; end_page: number };

const REPAIR_SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../scripts/repair_pdf.py");

async function loadForEdit(filePath: string) {
  const doc = await PDFDocument.load(await readFile(filePath), { ignoreEncryption: true, updateMetadata: false });
  // load() không báo lỗi với file hỏng; lỗi chỉ lộ ra khi truy cập cây trang.
  doc.getPageCount();
  return doc;
}

/**
 * pdf-lib (dùng để cắt chương) không đọc được một số PDF có bảng xref hỏng, dù pdfjs vẫn đọc được.
 * Gặp trường hợp đó thì sửa file 1 lần bằng qpdf (pikepdf qua uv) và ghi đè file gốc.
 */
export async function ensureEditablePdf(filePath: string) {
  try {
    await loadForEdit(filePath);
    return false;
  } catch {
    const tmp = `${filePath}.repair.pdf`;
    try {
      await promisify(execFile)("uv", ["run", "--quiet", "--with", "pikepdf", "python", REPAIR_SCRIPT, filePath, tmp], {
        timeout: 10 * 60 * 1000,
        windowsHide: true,
        // Trên Windows, uv là uv.exe trong PATH người dùng: chạy qua shell để tìm được.
        shell: process.platform === "win32",
      });
      await loadForEdit(tmp); // kiểm tra bản đã sửa đọc được thật
      await rename(tmp, filePath);
      console.log(`[pdf] đã sửa cấu trúc ${path.basename(filePath)}`);
      return true;
    } catch (err) {
      await unlink(tmp).catch(() => {});
      const missingUv = (err as NodeJS.ErrnoException).code === "ENOENT";
      throw new Error(
        missingUv
          ? "PDF bị lỗi cấu trúc, cần cài uv (https://docs.astral.sh/uv/) để tự sửa file."
          : "PDF bị lỗi cấu trúc và không sửa được. Hãy thử in lại ra PDF mới (Print to PDF) rồi upload.",
      );
    }
  }
}

/**
 * Trích text từng trang bằng pdfjs (đọc được cả PDF hỏng xref mà pdf-lib chịu thua).
 * Trả về mảng, phần tử i là text của trang i+1. Trang scan (ảnh) sẽ gần như rỗng.
 */
export async function extractPageTexts(filePath: string, onProgress?: (done: number, total: number) => void) {
  const task = getDocument({ data: new Uint8Array(await readFile(filePath)), useSystemFonts: true, verbosity: 0 });
  const pdf = await task.promise;
  try {
    const out: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const text = content.items
        .map((it) => ("str" in it ? it.str + (it.hasEOL ? "\n" : "") : ""))
        .join("")
        .replace(/[ \t]+/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
      out.push(text);
      page.cleanup();
      if (i % 50 === 0) onProgress?.(i, pdf.numPages);
    }
    return out;
  } finally {
    await task.destroy();
  }
}

/** Đọc số trang + bookmark cấp 1 (outline) của PDF. Trang đánh số từ 1. */
export async function readPdfMeta(filePath: string) {
  const data = new Uint8Array(await readFile(filePath));
  const task = getDocument({ data, useSystemFonts: true, verbosity: 0 });
  const pdf = await task.promise;
  try {
    type Item = { title: string; dest: unknown; items?: Item[] };
    const pageOf = async (item: Item) => {
      try {
        const dest = typeof item.dest === "string" ? await pdf.getDestination(item.dest) : (item.dest as unknown[] | null);
        const ref = dest?.[0];
        if (ref == null) return null;
        const index = typeof ref === "number" ? ref : await pdf.getPageIndex(ref as Parameters<typeof pdf.getPageIndex>[0]);
        return index + 1;
      } catch {
        return null; // bookmark hỏng: bỏ qua
      }
    };
    const resolve = async (items: Item[]) => {
      const out: OutlineNode[] = [];
      for (const it of items) {
        const page = await pageOf(it);
        if (page) out.push({ title: it.title.trim(), page, children: await resolve(it.items ?? []) });
      }
      return out;
    };
    const tree = await resolve(((await pdf.getOutline()) ?? []) as Item[]);
    return { pageCount: pdf.numPages, outline: flattenOutline(tree, pdf.numPages), tree };
  } finally {
    await task.destroy();
  }
}

/**
 * Từ danh sách trang bắt đầu, dựng các khoảng [start, end] liên tiếp.
 * Phần trước chương đầu (bìa, lời nói đầu) bị bỏ. Dùng chung cho bookmark và mục lục do AI đọc.
 */
export function buildRanges(starts: { title: string; page: number }[], pageCount: number): ChapterRange[] {
  const sorted = starts
    .filter((s) => s.page >= 1 && s.page <= pageCount && s.title)
    .sort((a, b) => a.page - b.page)
    .filter((s, i, arr) => i === 0 || s.page !== arr[i - 1].page);
  return sorted.map((s, i) => ({
    title: s.title.slice(0, 250),
    start_page: s.page,
    end_page: i + 1 < sorted.length ? Math.max(s.page, sorted[i + 1].page - 1) : pageCount,
  }));
}

export type OutlineNode = { title: string; page: number; children: OutlineNode[] };

/** Mục dài hơn ngưỡng này mà có bookmark con thì tách thành các chương con (vd. "Part I" → các "Chapter"). */
export const MAX_CHAPTER_PAGES = 60;

/**
 * Chọn cấp bookmark phù hợp: giữ cấp 1, nhưng mục nào dài > MAX_CHAPTER_PAGES và có con
 * thì thay bằng các con của nó (đệ quy, để Part → Chapter). Trả về danh sách trang bắt đầu.
 */
export function flattenOutline(nodes: OutlineNode[], pageCount: number, endPage = pageCount): { title: string; page: number }[] {
  const sorted = [...nodes].sort((a, b) => a.page - b.page);
  return sorted.flatMap((n, i) => {
    const end = i + 1 < sorted.length ? sorted[i + 1].page - 1 : endPage;
    const kids = n.children.filter((c) => c.page >= n.page && c.page <= end);
    if (end - n.page + 1 > MAX_CHAPTER_PAGES && kids.length >= 2) {
      const sub = flattenOutline(kids, pageCount, end);
      // Phần mở đầu của Part (trước chương con đầu tiên) nếu đủ dài thì giữ thành 1 mục riêng.
      return sub[0].page - n.page >= 3 ? [{ title: n.title, page: n.page }, ...sub] : sub;
    }
    return [{ title: n.title, page: n.page }];
  });
}

// Mục không phải nội dung học: không tốn lượt gọi AI cho chúng.
const NON_CONTENT =
  /^(front ?cover|back ?cover|cover|title page|half title|copyright|credits|dedication|about the (author|authors|contributing authors?|technical (reviewers?|editors?))|acknowledg|contents( at a glance)?|table of contents|brief contents|index|glossary|bibliography|references|where are the companion|online appendix|appendix|appendixes|appendices|answers to|review|(mục lục|bìa|lời (nói đầu|cảm ơn|giới thiệu)|tài liệu tham khảo|phụ lục|chỉ mục))\b/i;

/** Bỏ mục không phải nội dung (bìa, bản quyền, mục lục, index, phụ lục...) và mục quá ngắn. */
export function pickStudyChapters(ranges: ChapterRange[], minPages = 3): ChapterRange[] {
  const picked = ranges.filter((r) => {
    const title = r.title.replace(/^(part|phần)\s+[\divxlc]+\s*[:.\-–]\s*/i, "");
    return !NON_CONTENT.test(title) && !NON_CONTENT.test(r.title) && r.end_page - r.start_page + 1 >= minPages;
  });
  return picked.length >= 2 ? picked : ranges;
}

/** Không đọc được mục lục: chia đều theo khối ~chunk trang. */
export function fixedRanges(pageCount: number, chunk = 20): ChapterRange[] {
  const out: ChapterRange[] = [];
  for (let start = 1, i = 1; start <= pageCount; start += chunk, i++) {
    out.push({ title: `Phần ${i}`, start_page: start, end_page: Math.min(pageCount, start + chunk - 1) });
  }
  return out;
}

/** Cắt các trang [start, end] (đánh số từ 1) thành 1 PDF mới. */
export async function cutChapterPdf(filePath: string, start: number, end: number) {
  const src = await loadForEdit(filePath);
  const out = await PDFDocument.create();
  const indices = Array.from({ length: end - start + 1 }, (_, i) => start - 1 + i).filter((i) => i < src.getPageCount());
  const pages = await out.copyPages(src, indices);
  pages.forEach((p) => out.addPage(p));
  return out.save();
}

/**
 * Gemini chỉ thấy file chương đã cắt, nên số trang nó trả về tính từ trang 1 của chương.
 * Đổi về số trang trong PDF gốc và kẹp vào khoảng của chương.
 */
export function toDocumentPage(pageInChapter: number, chapter: { start_page: number; end_page: number }) {
  const page = chapter.start_page + Math.max(1, Math.round(pageInChapter)) - 1;
  return Math.min(Math.max(page, chapter.start_page), chapter.end_page);
}
