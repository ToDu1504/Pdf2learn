import { Type } from "@google/genai";
import { z } from "zod";
import { sequelize } from "../config/db.js";
import { Chapter, RoadmapSection, type Document } from "../models/index.js";
import { generateJson } from "./ai/gemini.client.js";
import type { ChapterRange, OutlineNode } from "./pdf.service.js";

/**
 * Lập roadmap học. NGUYÊN TẮC: mục lục của sách là chuẩn.
 *   chặng (section) = 1 chương sách; bài học (lesson) = 1 mục có thật trong mục lục.
 *   Ranh giới bài do code dựng từ bookmark (tất định, có test). AI CHỈ dịch tên, viết mô tả,
 *   đánh dấu core/optional, ước lượng phút — không gộp, tách hay dời trang.
 * Phần ôn tập cuối chương (Summary, Exam Essentials, Lab, Review Questions...) không thành bài học;
 * mọi trang không thuộc bài nào được liệt kê trong báo cáo đối chiếu (RoadmapReport).
 */

export const MIN_TOPIC_PAGES = 3;
export const MAX_TOPIC_PAGES = 20;

/** Mục ôn tập / tự kiểm tra: không phải nội dung bài học. */
export const REVIEW_TOPIC =
  /^["'“”‘’]?\s*(do i know this already|chapter review|review all|review questions|key terms?|exam essentials|exam preparation|summary|(chapter\s*\d+\s*)?(written\s+)?labs?\b|quiz|exercises?|answers? to|assessment test|bài tập|câu hỏi ôn tập|tóm tắt chương|ôn tập)/i;
/** Nhóm bọc các mục thật (CCNA "Foundation Topics"): bỏ lớp bọc, lấy các mục con. */
const WRAPPER = /^foundation topics$/i;

type Node = { title: string; page: number; children: Node[] };
type Span = { from: number; to: number };
export type LessonPlan = Span & {
  title: string;
  source_title: string;
  description: string | null;
  importance: "core" | "optional";
  est_minutes: number | null;
  /** Mục con trong mục lục sách nằm trong bài: bài giảng phải nói tới từng mục (kiểm tra ở ai/grounding.ts). */
  subtopics?: { title: string; from: number; to: number }[];
};
export type SectionPlan = Span & { title: string; source_title: string; description: string | null; lessons: LessonPlan[] };
export type RoadmapReport = {
  page_count: number;
  covered: number;
  /** Đoạn trang không thuộc bài học nào, kèm tên mục trong sách để người học đối chiếu. */
  skipped: (Span & { titles: string[] })[];
  /** Nguồn ranh giới: bookmark của PDF / mục lục AI đọc / chia đều. */
  source: "bookmark" | "toc" | "fixed";
  ai: boolean;
};

const clean = (s: string) => s.replace(/\s+/g, " ").trim();
const isReview = (title: string) => REVIEW_TOPIC.test(clean(title));
const len = (s: Span) => s.to - s.from + 1;

/** Bỏ lớp bọc (Foundation Topics) và sắp theo trang. */
function unwrap(nodes: Node[]): Node[] {
  return nodes
    .flatMap((n) => (WRAPPER.test(clean(n.title)) ? unwrap(n.children) : [n]))
    .map((n) => ({ ...n, title: clean(n.title) }))
    .filter((n) => n.title)
    .sort((a, b) => a.page - b.page);
}

/** Tìm node bookmark của 1 chương (cùng tiêu đề + trang bắt đầu). */
export function findNode(tree: Node[], range: { title: string; start_page: number }): Node | null {
  for (const n of tree) {
    if (n.page === range.start_page && clean(n.title) === clean(range.title)) return n;
    const hit = findNode(n.children, range);
    if (hit) return hit;
  }
  return null;
}

type Raw = Span & { title: string; source_title: string };

/**
 * Chia đoạn [from, to] thành bài học theo các mục `nodes`:
 *  - mục ôn tập → bỏ (ghi vào excluded);
 *  - mục dài hơn MAX_TOPIC_PAGES có mục con → chia tiếp theo mục con (đệ quy);
 *  - phần mở đầu trước mục đầu tiên → gộp vào bài đầu.
 */
function segment(from: number, to: number, nodes: Node[], title: string): { lessons: Raw[]; excluded: (Span & { titles: string[] })[] } {
  // Nhiều mục cùng 1 trang: giữ mục nội dung cuối cùng (vd. tiêu đề nhóm + mục con đầu cùng trang) và mục ôn tập
  // cuối cùng (đặt sau, để bài kết thúc ở trang đó). Tránh 2 bài chồng trang.
  const inRange = unwrap(nodes).filter((n) => n.page >= from && n.page <= to);
  const items = [...new Set(inRange.map((n) => n.page))].flatMap((page) => {
    const same = inRange.filter((m) => m.page === page);
    return [same.filter((m) => !isReview(m.title)).at(-1), same.filter((m) => isReview(m.title)).at(-1)].filter((m): m is Node => !!m);
  });
  if (!items.length) return { lessons: [{ from, to, title, source_title: title }], excluded: [] };

  const lessons: Raw[] = [];
  const excluded: (Span & { titles: string[] })[] = [];
  // Phần mở đầu (trang tên chương, lời dẫn) trước mục đầu tiên: gộp vào mục đầu nếu đó là nội dung học.
  const introInFirst = items[0].page > from && !isReview(items[0].title);
  items.forEach((n, i) => {
    const next = items[i + 1];
    // Mục ôn tập thường bắt đầu giữa trang, ngay sau đoạn cuối của bài → trang chung thuộc về bài.
    const end = !next ? to : isReview(next.title) && !isReview(n.title) ? next.page : next.page - 1;
    const span = { from: i === 0 && introInFirst ? from : n.page, to: end };
    if (isReview(n.title)) return excluded.push({ ...span, titles: [n.title] });
    const kids = unwrap(n.children).filter((c) => c.page >= span.from && c.page <= span.to && !isReview(c.title));
    // Chỉ chia theo mục con khi có ≥ 2 mục con (1 mục con thường không phủ hết mục cha).
    if (len(span) > MAX_TOPIC_PAGES && kids.length >= 2) {
      const sub = segment(span.from, span.to, n.children, n.title); // phần dẫn của mục cha → gộp vào mục con đầu
      lessons.push(...sub.lessons);
      excluded.push(...sub.excluded);
    } else lessons.push({ ...span, title: n.title, source_title: n.title });
  });

  // Mục đầu là ôn tập (vd. "Do I Know This Already?" Quiz): phần dẫn trước nó đứng riêng nếu đủ dài.
  if (items[0].page > from && !introInFirst) {
    const intro = { from, to: items[0].page - 1 };
    if (len(intro) >= MIN_TOPIC_PAGES) lessons.unshift({ ...intro, title, source_title: title });
    else excluded.unshift({ ...intro, titles: [title] });
  }
  return { lessons: lessons.sort((a, b) => a.from - b.from), excluded };
}

/** Gộp bài quá ngắn vào bài liền kề (ưu tiên bài trước), chia bài quá dài thành (phần 1), (phần 2)... */
function normalize(lessons: Raw[]): Raw[] {
  const merged: Raw[] = [];
  for (const l of lessons) {
    const prev = merged.at(-1);
    if (prev && prev.to + 1 === l.from && (len(l) < MIN_TOPIC_PAGES || len(prev) < MIN_TOPIC_PAGES) && len(prev) + len(l) <= MAX_TOPIC_PAGES + MIN_TOPIC_PAGES) {
      prev.to = l.to;
      prev.source_title = `${prev.source_title} · ${l.source_title}`;
      if (len(prev) - len(l) < MIN_TOPIC_PAGES) prev.title = l.title; // bài trước chỉ là phần dẫn → lấy tên bài sau
    } else merged.push({ ...l });
  }
  return merged.flatMap((l) => {
    const parts = Math.ceil(len(l) / MAX_TOPIC_PAGES);
    if (parts <= 1) return [l];
    const size = Math.ceil(len(l) / parts);
    return Array.from({ length: parts }, (_, k) => ({
      ...l,
      title: `${l.title} (phần ${k + 1})`,
      from: l.from + k * size,
      to: Math.min(l.to, l.from + (k + 1) * size - 1),
    }));
  });
}

/**
 * Dựng cấu trúc roadmap từ các chương. `itemsOf(range)` trả về mục con của chương
 * (bookmark; không có thì tiêu đề dò từ text). Kết quả: tên gốc tiếng Anh, chưa có mô tả.
 */
export function structureBook(ranges: ChapterRange[], itemsOf: (r: ChapterRange) => Node[]): SectionPlan[] {
  return ranges.flatMap((range) => {
    const { lessons } = segment(range.start_page, range.end_page, itemsOf(range), clean(range.title));
    const list = normalize(lessons);
    if (!list.length) return [];
    return [
      {
        title: clean(range.title),
        source_title: clean(range.title),
        description: null,
        from: list[0].from,
        to: list.at(-1)!.to,
        lessons: list.map((l) => ({ ...l, description: null, importance: "core" as const, est_minutes: null })),
      },
    ];
  });
}

/**
 * Mục con trong mục lục sách thuộc bài [from, to] (không tính tiêu đề của chính bài ở trang đầu, không tính mục
 * ôn tập). Quá nhiều thì chỉ lấy các cấp nông nhất (≤ 15 mục). Khoảng trang mỗi mục: tới trước mục kế tiếp.
 */
export function subtopicsOf(tree: Node[], lesson: Span & { source_title?: string }): { title: string; from: number; to: number }[] {
  const own = clean(lesson.source_title?.split(" · ")[0] ?? "");
  const all: (Node & { depth: number })[] = [];
  const walk = (ns: Node[], depth: number) =>
    ns.forEach((n) => {
      all.push({ ...n, title: clean(n.title), depth });
      walk(n.children, depth + 1);
    });
  walk(tree, 0);
  const inside = all
    .filter((n) => n.page > lesson.from && n.page <= lesson.to && n.title && !isReview(n.title) && !WRAPPER.test(n.title))
    .sort((a, b) => a.page - b.page || a.depth - b.depth)
    // Mục cha cùng trang với mục con (vd. nhóm "Understanding…" + mục con đầu) → giữ mục con.
    .filter((n, i, arr) => !(arr[i + 1] && arr[i + 1].page === n.page && arr[i + 1].depth > n.depth))
    .filter((n) => n.title !== own);
  // Lấy cấp sâu nhất mà tổng số mục vẫn ≤ 15.
  const depths = [...new Set(inside.map((n) => n.depth))].sort((a, b) => a - b);
  let chosen = inside.filter((n) => n.depth <= (depths[0] ?? 0)).slice(0, 15);
  for (const d of depths) {
    const upTo = inside.filter((n) => n.depth <= d);
    if (upTo.length > 15) break;
    chosen = upTo;
  }
  chosen = chosen.filter((n, i, arr) => i === 0 || n.page !== arr[i - 1].page || n.title !== arr[i - 1].title);
  return chosen.map((n, i) => {
    const next = chosen.slice(i + 1).find((m) => m.page > n.page);
    return { title: n.title, from: n.page, to: next ? next.page - 1 : lesson.to };
  });
}

/** Đối chiếu roadmap với sách: số trang được học, các đoạn bị bỏ qua (kèm tên mục trong sách). */
export function roadmapReport(plan: SectionPlan[], pageCount: number, tree: Node[], source: RoadmapReport["source"], ai: boolean): RoadmapReport {
  const covered = new Uint8Array(pageCount + 2);
  for (const s of plan) for (const l of s.lessons) for (let p = l.from; p <= l.to; p++) covered[p] = 1;
  const all: Node[] = [];
  const walk = (ns: Node[]) => ns.forEach((n) => (all.push({ ...n, title: clean(n.title) }), walk(n.children)));
  walk(tree);
  all.sort((a, b) => a.page - b.page);

  const skipped: RoadmapReport["skipped"] = [];
  for (let p = 1; p <= pageCount; p++) {
    if (covered[p]) continue;
    const from = p;
    while (p + 1 <= pageCount && !covered[p + 1]) p++;
    // Mục đang chiếm trang đầu đoạn (bắt đầu từ trang trước, vd. "Chapter Review") + các mục bắt đầu trong đoạn.
    const before = all.filter((n) => n.page < from).at(-1)?.title;
    const inside = all.filter((n) => n.page >= from && n.page <= p).map((n) => n.title);
    const titles = [...new Set([...(before && !all.some((n) => n.page === from) ? [before] : []), ...inside])];
    skipped.push({ from, to: p, titles: titles.length > 6 ? [...titles.slice(0, 6), `… (+${titles.length - 6})`] : titles });
  }
  return { page_count: pageCount, covered: covered.reduce((n, v) => n + v, 0), skipped, source, ai };
}

/**
 * Dò tiêu đề mục từ text trang (khi PDF không có bookmark con): dòng ngắn, không kết thúc bằng dấu chấm,
 * dạng "1.2 Tiêu đề" hoặc viết hoa đầu câu; bỏ dòng lặp lại ở nhiều trang (header/footer).
 */
export function headingCandidates(pages: { page: number; text: string }[], max = 25): { title: string; page: number }[] {
  const freq = new Map<string, number>();
  for (const p of pages) for (const line of new Set(p.text.split("\n").map((l) => l.trim()))) freq.set(line, (freq.get(line) ?? 0) + 1);
  const out: { title: string; page: number }[] = [];
  for (const p of pages) {
    for (const raw of p.text.split("\n")) {
      const line = raw.trim();
      if ((freq.get(line) ?? 0) > 2) continue; // header/footer chạy
      if (line.length < 4 || line.length > 80 || /[.,;:]$/.test(line) || /^\d+$/.test(line)) continue;
      const words = line.split(/\s+/).length;
      const numbered = /^(\d+(\.\d+){0,3}|[IVX]+\.|[A-Z]\.)\s+\p{Lu}/u.test(line);
      const titleCase = words <= 9 && /^\p{Lu}/u.test(line) && line.split(/\s+/).filter((w) => /^\p{Lu}/u.test(w)).length >= Math.ceil(words * 0.6);
      if (numbered || titleCase) out.push({ title: line, page: p.page });
    }
  }
  // Chọn đều theo trang để phủ cả chương.
  if (out.length <= max) return out;
  const step = out.length / max;
  return Array.from({ length: max }, (_, i) => out[Math.floor(i * step)]);
}

/* ---------------- AI: chỉ đặt tên tiếng Việt + mô tả, KHÔNG đổi ranh giới ---------------- */

const annotateSchema = {
  type: Type.OBJECT,
  properties: {
    sections: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          i: { type: Type.INTEGER },
          title: { type: Type.STRING },
          description: { type: Type.STRING },
          lessons: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                i: { type: Type.INTEGER },
                title: { type: Type.STRING },
                description: { type: Type.STRING },
                importance: { type: Type.STRING, enum: ["core", "optional"] },
                est_minutes: { type: Type.INTEGER },
              },
              required: ["i", "title", "importance"],
            },
          },
        },
        required: ["i", "title", "lessons"],
      },
    },
  },
  required: ["sections"],
};

const AnnotateZod = z.object({
  sections: z.array(
    z.object({
      i: z.coerce.number().int(),
      title: z.string(),
      description: z.string().optional(),
      lessons: z.array(
        z.object({
          i: z.coerce.number().int(),
          title: z.string(),
          description: z.string().optional(),
          importance: z.enum(["core", "optional"]).catch("core"),
          est_minutes: z.coerce.number().int().optional(),
        }),
      ),
    }),
  ),
});

function annotatePrompt(docTitle: string, plan: SectionPlan[]) {
  const outline = plan
    .map((s, si) =>
      [`S${si} | "${s.source_title}" | tr.${s.from}-${s.to}`, ...s.lessons.map((l, li) => `  L${li} | "${l.source_title}"${l.title !== l.source_title ? ` [${l.title}]` : ""} | tr.${l.from}-${l.to}`)].join("\n"),
    )
    .join("\n");
  return `
Đây là cấu trúc giáo trình "${docTitle}", dựng đúng theo mục lục của sách: S = chương, L = bài học (mục trong sách).
Ranh giới đã CỐ ĐỊNH, không được gộp, tách, thêm, bớt hay đổi thứ tự.

${outline}

Với MỖI chặng S và MỖI bài L (trả về đúng chỉ số i), viết bằng tiếng Việt:
- title: dịch sát nghĩa tên mục gốc trong sách, ngắn gọn (≤ 10 từ); giữ thuật ngữ chuyên ngành tiếng Anh quen dùng
  (vd "Ethernet LAN cơ bản", "Địa chỉ IPv6"). Bài gộp nhiều mục ("A · B") → tên bao quát cả hai.
  Giữ nguyên hậu tố "(phần N)" nếu có. Không bịa chủ đề không có trong tên mục.
- description: 1 câu: học xong bài/chặng này người học hiểu hoặc làm được gì.
- importance (chỉ bài học): core = kiến thức chính; optional = lịch sử, giai thoại, mở rộng ít thi.
- est_minutes (chỉ bài học): thời gian học ước tính, khoảng 4 phút/trang (10–90).`;
}

/** 1 lượt AI đặt tên tiếng Việt/mô tả. Lỗi hoặc thiếu mục → giữ tên gốc trong sách. Không bao giờ đổi trang. */
export async function annotateRoadmap(doc: Pick<Document, "title" | "user_id">, plan: SectionPlan[]): Promise<{ plan: SectionPlan[]; ai: boolean }> {
  const fallback = plan.map((s) => ({
    ...s,
    lessons: s.lessons.map((l) => ({ ...l, est_minutes: l.est_minutes ?? Math.min(90, Math.max(10, len(l) * 4)) })),
  }));
  if (!plan.length) return { plan: fallback, ai: false };
  try {
    const raw = await generateJson({
      parts: [{ text: annotatePrompt(doc.title, plan) }],
      responseSchema: annotateSchema,
      parse: (r) => AnnotateZod.parse(r),
      userId: doc.user_id,
      feature: "split",
      temperature: 0.2,
    });
    const bySection = new Map(raw.sections.map((s) => [s.i, s]));
    const pick = (s: string | undefined) => (s && s.trim() ? s.trim() : null);
    return {
      ai: true,
      plan: fallback.map((s, si) => {
        const a = bySection.get(si);
        const byLesson = new Map((a?.lessons ?? []).map((l) => [l.i, l]));
        return {
          ...s,
          title: pick(a?.title) ?? s.title,
          description: pick(a?.description),
          lessons: s.lessons.map((l, li) => {
            const b = byLesson.get(li);
            return {
              ...l,
              title: pick(b?.title) ?? l.title,
              description: pick(b?.description),
              importance: b?.importance ?? "core",
              est_minutes: b?.est_minutes ? Math.min(120, Math.max(5, b.est_minutes)) : l.est_minutes,
            };
          }),
        };
      }),
    };
  } catch (err) {
    console.warn("[roadmap] AI lỗi, giữ tên mục gốc trong sách:", (err as Error).message.slice(0, 150));
    return { plan: fallback, ai: false };
  }
}

/**
 * Ghi roadmap vào DB. Lập lại roadmap KHÔNG làm mất công học: bài có cùng khoảng trang với bài cũ được giữ
 * nguyên dòng (bài giảng, câu hỏi, flashcard, tiến độ), chỉ cập nhật tên/chặng/thứ tự.
 */
export async function saveRoadmap(doc: Document, plan: SectionPlan[], report: RoadmapReport) {
  return sequelize.transaction(async (transaction) => {
    const oldSections = await RoadmapSection.findAll({ where: { document_id: doc.id }, transaction });
    const oldChapters = await Chapter.findAll({ where: { document_id: doc.id }, transaction });
    const byRange = new Map(oldChapters.map((c) => [`${c.start_page}-${c.end_page}`, c]));
    const kept = new Set<number>();
    let order = 0;
    for (const [si, s] of plan.entries()) {
      const section = await RoadmapSection.create(
        { document_id: doc.id, order_index: si, title: s.title.slice(0, 250), source_title: s.source_title.slice(0, 500), description: s.description },
        { transaction },
      );
      for (const l of s.lessons) {
        const fields = {
          section_id: section.id,
          order_index: order++,
          title: l.title.slice(0, 250),
          source_title: l.source_title.slice(0, 500),
          description: l.description,
          importance: l.importance,
          est_minutes: l.est_minutes,
          subtopics: l.subtopics ?? [],
        };
        const old = byRange.get(`${l.from}-${l.to}`);
        if (old && !kept.has(old.id)) {
          kept.add(old.id);
          await old.update(fields, { transaction });
        } else await Chapter.create({ ...fields, document_id: doc.id, start_page: l.from, end_page: l.to }, { transaction });
      }
    }
    // Chuyển bài giữ lại sang chặng mới TRƯỚC khi xóa chặng cũ (xóa chặng cascade xóa bài).
    await Chapter.destroy({ where: { id: oldChapters.filter((c) => !kept.has(c.id)).map((c) => c.id) }, transaction });
    await RoadmapSection.destroy({ where: { id: oldSections.map((s) => s.id) }, transaction });
    await doc.update({ roadmap_report: report }, { transaction });
    return { lessons: order, kept: kept.size };
  });
}
