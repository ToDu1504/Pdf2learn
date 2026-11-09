import { Op } from "sequelize";
import { Chapter, Document, DocumentPage, Question, RoadmapSection } from "../models/index.js";
import type { OutlineNode } from "./pdf.service.js";

/**
 * PHẦN ÔN TẬP CỦA SÁCH — đọc bằng code, KHÔNG dùng AI (nguyên văn, đáp án theo sách, 0 lượt Gemini):
 *  - câu hỏi in trong sách ("Do I Know This Already?" quiz, Review Questions): đánh số "1. …" + lựa chọn "a. …"/"A. …";
 *  - đáp án: bảng đáp án ngắn trong chương ("Answers to the … quiz: 1 B 2 D and F …") và/hoặc phụ lục đáp án
 *    ("Appendix …: Answers to …", dạng "3. C. Giải thích …") → lấy cả giải thích;
 *  - "Cần nắm trước khi thi": Exam Essentials / Key Terms You Should Know; bài lab (tên + trang).
 * Câu nhiều đáp án ("Choose two"): correct_answer = các lựa chọn đúng theo thứ tự trong đề, nối bằng "\n"
 * (giao diện làm bài hiện ô chọn nhiều; chấm bằng so khớp chuỗi như câu thường).
 */
export const MULTI_SEP = "\n";

export type BookReview = {
  questions: number;
  multi_skipped: number;
  question_pages: { from: number; to: number } | null;
  essentials: { text: string; page: number }[];
  key_terms: string[];
  labs: { title: string; from: number; to: number }[];
};

type Page = { page: number; text: string };
type Parsed = { n: number; stem: string; options: { letter: string; text: string }[]; page: number };

const clean = (s: string) => s.replace(/\s+/g, " ").trim();
const QUESTION_NODE = /(do i know this already|review questions|assessment test|chapter quiz|self[- ]test)/i;
const ANSWER_APPENDIX = /answers? to/i;
const ESSENTIALS_NODE = /^exam essentials/i;
const LAB_NODE = /\blabs?\b/i;
// Header/footer lặp lại của sách (số trang + tên sách), dòng rác của PDF.
const NOISE = /^(\d{1,4}\s+.*\b(guide|volume|edition)\b.*|.*\bchapter\s+\d+:.*\s\d+[a-z]?|.*appendix\s+[a-z]:.*\s\d+|[|]{3,}|technet24)$/i;

/** Câu hỏi đánh số + lựa chọn chữ cái (a–h hoặc A–H), có thể vắt nhiều dòng / nhiều trang. */
export function parseQuestions(pages: Page[], stopAt?: string): Parsed[] {
  const all = pages.flatMap((p) => p.text.split("\n").map((l) => ({ page: p.page, l: l.trim() })));
  // Mục kế tiếp thường bắt đầu giữa trang cuối: đọc tới dòng tiêu đề của nó thì dừng.
  const stopKey = stopAt ? clean(stopAt).toLowerCase() : null;
  const stop = stopKey ? all.findIndex((x, i) => i > 0 && clean(x.l).toLowerCase() === stopKey) : -1;
  const lines = stop > 0 ? all.slice(0, stop) : all;
  // Nối dòng: "fol-" + "lowed" → "followed" (gạch nối ngắt dòng).
  const join = (a: string, b: string) => (/[a-z]-$/.test(a) && /^[a-z]/.test(b) ? a.slice(0, -1) + b : `${a} ${b}`);
  const out: Parsed[] = [];
  let cur: Parsed | null = null;
  let opt: { letter: string; text: string } | null = null;
  const flush = () => {
    if (cur && cur.options.length >= 2) out.push(cur);
    cur = null;
    opt = null;
  };
  for (const { page, l } of lines) {
    if (!l) continue;
    const q = /^(\d{1,3})\.\s+(.+)$/.exec(l);
    const o = /^([a-hA-H])\.\s+(.+)$/.exec(l);
    if (q && (!cur || Number(q[1]) === cur.n + 1 || cur.options.length >= 2)) {
      flush();
      cur = { n: Number(q[1]), stem: q[2], options: [], page };
    } else if (o && cur && o[1].toUpperCase() === String.fromCharCode(65 + cur.options.length)) {
      opt = { letter: o[1].toUpperCase(), text: o[2] };
      cur.options.push(opt);
    } else if (cur && !NOISE.test(l) && !/^table\s+\d/i.test(l)) {
      if (opt) opt.text = join(opt.text, l);
      else cur.stem = join(cur.stem, l);
    }
  }
  flush();
  // Bỏ trùng số (câu cuối cùng thắng) và câu có lựa chọn dính rác quá dài.
  const byN = new Map(out.map((q) => [q.n, { ...q, stem: clean(q.stem), options: q.options.map((x) => ({ ...x, text: clean(x.text) })) }]));
  return [...byN.values()].filter((q) => q.options.every((x) => x.text.length <= 300)).sort((a, b) => a.n - b.n);
}

const letters = (s: string) => [...new Set((s.toUpperCase().match(/\b[A-H]\b/g) ?? []))];

/** Bảng đáp án ngắn: "Answers to the … quiz: 1 D and F 2 A 3 B, C" → {1: [D,F], 2: [A], 3: [B,C]}. */
export function parseAnswerKey(text: string): Map<number, string[]> {
  const out = new Map<number, string[]>();
  const i = text.search(/answers? to (the )?.{0,60}quiz\s*:/i);
  if (i < 0) return out;
  const body = text.slice(text.indexOf(":", i) + 1, i + 600);
  for (const m of body.matchAll(/(\d{1,3})\s+([A-H](?:\s*(?:,|and|,\s*and)\s*[A-H])*)(?![a-z])/g)) {
    if (!out.has(Number(m[1]))) out.set(Number(m[1]), letters(m[2]));
  }
  return out;
}

/** Phụ lục đáp án có giải thích: "3. C. The mask converts…" / "1. D and F. Of the remaining…". */
export function parseExplainedAnswers(text: string): Map<number, { letters: string[]; explanation: string }> {
  const out = new Map<number, { letters: string[]; explanation: string }>();
  const re = /^(\d{1,3})\.\s+([A-H](?:\s*(?:,|and|,\s*and)\s*[A-H])*)\.\s+/gm;
  const hits = [...text.matchAll(re)];
  hits.forEach((m, k) => {
    const end = k + 1 < hits.length ? hits[k + 1].index! : text.length;
    const explanation = clean(
      text
        .slice(m.index! + m[0].length, end)
        .replace(/([a-z])-\s*\n\s*([a-z])/g, "$1$2") // gạch nối ngắt dòng
        .split("\n")
        .filter((l) => !NOISE.test(l.trim()))
        .join(" "),
    );
    out.set(Number(m[1]), { letters: letters(m[2]), explanation: explanation.slice(0, 2000) });
  });
  return out;
}

/** "Key Terms You Should Know" → danh sách thuật ngữ (cách nhau bởi dấu phẩy). */
export function parseKeyTerms(text: string): string[] {
  const i = text.search(/key terms you should know/i);
  if (i < 0) return [];
  const after = text.slice(i).split("\n").slice(1);
  const body: string[] = [];
  for (const l of after) {
    const t = l.trim();
    if (!t || /^(command references|table \d|chapter \d|part [ivx]+|\|{3,})/i.test(t) || NOISE.test(t)) break;
    body.push(t);
  }
  return [...new Set(clean(body.join(" ").replace(/-\s+(?=[a-z])/g, "")).split(/,\s*/).map((s) => s.trim()).filter((s) => s.length >= 2 && s.length <= 80))];
}

/** Exam Essentials: mỗi ý mở đầu bằng "Know/Understand/Explain/Identify/Describe/Be able…". */
export function parseEssentials(pages: Page[]): { text: string; page: number }[] {
  const out: { text: string; page: number }[] = [];
  for (const p of pages) {
    for (const para of p.text.split(/\n(?=(?:Know|Understand|Explain|Identify|Describe|Be able|Compare|Recognize|Remember)\b)/)) {
      const t = clean(para.split("\n").filter((l) => !NOISE.test(l.trim()) && !/^exam essentials$/i.test(l.trim())).join(" "));
      if (/^(Know|Understand|Explain|Identify|Describe|Be able|Compare|Recognize|Remember)\b/.test(t) && t.length > 20) out.push({ text: t.slice(0, 600), page: p.page });
    }
  }
  return out;
}

/* ---------------- dựng phần ôn tập cho từng chặng ---------------- */

type Flat = { title: string; page: number; depth: number };
const flatten = (tree: OutlineNode[]) => {
  const all: Flat[] = [];
  const walk = (ns: OutlineNode[], depth: number) => ns.forEach((n) => (all.push({ title: clean(n.title), page: n.page, depth }), walk(n.children, depth + 1)));
  walk(tree, 0);
  return all.sort((a, b) => a.page - b.page);
};
/** Khoảng trang của mục: tới trước mục kế tiếp cùng cấp hoặc nông hơn. */
const spanOf = (all: Flat[], n: Flat, limit: number) => {
  const next = all.find((m) => m.page > n.page && m.depth <= n.depth);
  return { from: n.page, to: Math.min(limit, next ? Math.max(n.page, next.page - 1) : limit) };
};

async function pagesBetween(documentId: number, from: number, to: number): Promise<Page[]> {
  if (to < from) return [];
  return (await DocumentPage.findAll({ where: { document_id: documentId, page: { [Op.between]: [from, to] } }, attributes: ["page", "text"], order: [["page", "ASC"]] })).map(
    (p) => ({ page: p.page, text: p.text }),
  );
}

/**
 * Dựng phần ôn tập của cả tài liệu (idempotent: xóa câu hỏi "book" cũ rồi tạo lại). Câu hỏi gắn vào bài cuối của chặng
 * (ôn sau khi học xong chặng); lưu tóm tắt vào roadmap_sections.review.
 */
export async function buildBookReviews(doc: Document, tree: OutlineNode[]) {
  const all = flatten(tree);
  const pageCount = doc.page_count ?? 0;
  const sections = await RoadmapSection.findAll({ where: { document_id: doc.id }, order: [["order_index", "ASC"]] });
  const lessons = await Chapter.findAll({ where: { document_id: doc.id }, order: [["order_index", "ASC"]] });
  await Question.destroy({ where: { chapter_id: lessons.map((l) => l.id), origin: "book" } });

  // Phụ lục đáp án (nếu có): text toàn bộ, tách theo "Chapter N" để lấy đúng phần của chương.
  const appendix = all.find((n) => ANSWER_APPENDIX.test(n.title) && n.depth <= 1);
  const appendixText = appendix ? (await pagesBetween(doc.id, appendix.page, spanOf(all, appendix, pageCount).to)).map((p) => p.text).join("\n") : "";

  let total = 0;
  for (const section of sections) {
    const own = lessons.filter((l) => l.section_id === section.id);
    if (!own.length) continue;
    // Khoảng trang cả chương trong sách: từ mục chương tới trước chương kế tiếp (gồm phần ôn tập đã bị loại khỏi bài học).
    const head = all.find((n) => n.title === clean(section.source_title ?? "") && n.page <= own[0].start_page);
    const chapterSpan = head ? spanOf(all, head, pageCount) : { from: own[0].start_page, to: own.at(-1)!.end_page };
    const inside = all.filter((n) => n.page >= chapterSpan.from && n.page <= chapterSpan.to);
    const chapterNo = /\b(?:chapter|chương)\s+(\d+)/i.exec(section.source_title ?? "")?.[1];

    // Câu hỏi
    const qNode = inside.find((n) => QUESTION_NODE.test(n.title));
    const qSpan = qNode ? spanOf(all, qNode, chapterSpan.to) : null;
    const qNext = qNode ? all.find((m) => m.page > qNode.page && m.depth <= qNode.depth) : undefined;
    // Gồm cả trang mục kế tiếp bắt đầu (câu hỏi cuối thường nằm chung trang), dừng ở dòng tiêu đề của mục đó.
    const qPages = qSpan ? await pagesBetween(doc.id, qSpan.from, Math.min(chapterSpan.to, qNext?.page ?? qSpan.to)) : [];
    const parsed = parseQuestions(qPages, qNext?.title);

    // Đáp án: bảng ngắn trong chương + phụ lục có giải thích (phần "Chapter N" của phụ lục).
    const chapterPages = await pagesBetween(doc.id, chapterSpan.from, chapterSpan.to);
    const keyPage = chapterPages.find((p) => parseAnswerKey(p.text).size);
    const key = keyPage ? parseAnswerKey(keyPage.text) : new Map<number, string[]>();
    let explained = new Map<number, { letters: string[]; explanation: string }>();
    if (appendixText && chapterNo) {
      const start = appendixText.search(new RegExp(`^\\s*Chapter\\s+${chapterNo}\\b`, "im"));
      if (start >= 0) {
        const rest = appendixText.slice(start + 10);
        const end = rest.search(new RegExp(`^\\s*Chapter\\s+${Number(chapterNo) + 1}\\b`, "im"));
        explained = parseExplainedAnswers(end >= 0 ? rest.slice(0, end) : rest.slice(0, 40_000));
      }
    }

    let multi = 0;
    const rows = parsed.flatMap((q) => {
      const ans = explained.get(q.n)?.letters ?? key.get(q.n);
      if (!ans?.length) return [];
      const picked = q.options.filter((o) => ans.includes(o.letter));
      if (picked.length !== ans.length) return []; // đáp án trỏ tới lựa chọn không đọc được
      if (ans.length > 1) multi++;
      const correct = { letter: picked.map((o) => o.letter).join(", "), text: picked.map((o) => o.text).join(MULTI_SEP) };
      const why = explained.get(q.n)?.explanation;
      return [
        {
          chapter_id: own.at(-1)!.id,
          type: q.options.length === 2 && /true|false|đúng|sai/i.test(q.options.map((o) => o.text).join(" ")) ? ("true_false" as const) : ("mcq" as const),
          difficulty: "medium" as const,
          content: q.stem,
          options: q.options.map((o) => o.text),
          correct_answer: correct.text,
          explanation: why ? `Theo sách: ${why}` : `Đáp án theo sách: ${correct.letter}${keyPage ? ` (bảng đáp án tr. ${keyPage.page})` : ""}.`,
          source_page: q.page,
          source_quote: q.stem.slice(0, 500),
          verified: true,
          topic: clean(section.title).slice(0, 250),
          origin: "book" as const,
        },
      ];
    });
    if (rows.length) await Question.bulkCreate(rows);
    total += rows.length;

    // Cần nắm: Exam Essentials (Sybex) / Key Terms (Cisco Press); bài lab.
    const essNode = inside.find((n) => ESSENTIALS_NODE.test(n.title));
    const essentials = essNode ? parseEssentials(await pagesBetween(doc.id, essNode.page, spanOf(all, essNode, chapterSpan.to).to)) : [];
    const key_terms = parseKeyTerms(chapterPages.map((p) => p.text).join("\n"));
    const labs = inside.filter((n) => LAB_NODE.test(n.title) && !/answers?/i.test(n.title)).map((n) => ({ title: n.title, ...spanOf(all, n, chapterSpan.to) }));

    await section.update({
      review: { questions: rows.length, multi_skipped: multi, question_pages: qSpan, essentials, key_terms, labs } satisfies BookReview,
    });
  }
  return total;
}
