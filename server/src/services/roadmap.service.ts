import { Type } from "@google/genai";
import { z } from "zod";
import { sequelize } from "../config/db.js";
import { Chapter, RoadmapSection, type Document } from "../models/index.js";
import { generateJson } from "./ai/gemini.client.js";
import type { ChapterRange, OutlineNode } from "./pdf.service.js";

/**
 * Lập roadmap học từ cấu trúc sách:
 *   section (chặng) = 1 chương sách (đã lọc bìa/mục lục/phụ lục)
 *   topic (bài học) = 1 mục con, khoảng 3–15 trang → đây là đơn vị AI soạn bài + kiểm tra.
 * Nguồn mục con: bookmark cấp dưới chương; không có thì lấy "tiêu đề ứng viên" dò từ text trang.
 * 1 lượt AI để gom nhóm/đặt tên tiếng Việt/mô tả/độ quan trọng/thời gian. AI lỗi → roadmap tất định.
 */

type Candidate = { title: string; page: number };
export type TopicPlan = { title: string; description: string | null; start_page: number; importance: "core" | "optional"; est_minutes: number | null };
export type SectionPlan = { range: ChapterRange; title: string; description: string | null; topics: TopicPlan[] };

const MIN_TOPIC_PAGES = 3;
const MAX_TOPIC_PAGES = 15;
// Mục con không phải nội dung học (phần ôn tập cuối chương, câu hỏi tự đánh giá...).
const SKIP_TOPIC = /^(do i know this already|chapter review|review all|key terms?|exam preparation|foundation topics|answers? to|summary|quiz|exercises?|bài tập|câu hỏi ôn tập|tóm tắt chương)/i;

/** Mục con của 1 chương lấy từ cây bookmark: chọn cấp nông nhất nằm trong khoảng trang của chương. */
export function childBookmarks(tree: OutlineNode[], range: ChapterRange): Candidate[] {
  const all: (Candidate & { depth: number })[] = [];
  const walk = (nodes: OutlineNode[], depth: number) =>
    nodes.forEach((n) => {
      all.push({ title: n.title, page: n.page, depth });
      walk(n.children, depth + 1);
    });
  walk(tree, 0);
  const self = all.find((n) => n.page === range.start_page && n.title === range.title);
  const inside = all.filter((n) => n.page >= range.start_page && n.page <= range.end_page && n !== self && (!self || n.depth > self.depth));
  // "Foundation Topics" là nhóm bọc các mục thật → lấy cả cấp con của nó.
  const pool = inside.filter((n) => !SKIP_TOPIC.test(n.title) || /foundation topics/i.test(n.title));
  if (!pool.length) return [];
  const depths = [...new Set(pool.map((n) => n.depth))].sort((a, b) => a - b);
  for (const d of depths) {
    const level = pool.filter((n) => n.depth <= d && !SKIP_TOPIC.test(n.title));
    if (level.length >= 2) return dedupe(level);
  }
  return dedupe(pool.filter((n) => !SKIP_TOPIC.test(n.title)));
}

const dedupe = (xs: Candidate[]) =>
  xs
    .map(({ title, page }) => ({ title: title.trim(), page }))
    .sort((a, b) => a.page - b.page)
    .filter((x, i, arr) => x.title && (i === 0 || x.page !== arr[i - 1].page || x.title !== arr[i - 1].title));

/**
 * Dò tiêu đề mục từ text trang (khi PDF không có bookmark con): dòng ngắn, không kết thúc bằng dấu chấm,
 * dạng "1.2 Tiêu đề" hoặc viết hoa đầu câu; bỏ dòng lặp lại ở nhiều trang (header/footer).
 */
export function headingCandidates(pages: { page: number; text: string }[], max = 25): Candidate[] {
  const freq = new Map<string, number>();
  for (const p of pages) for (const line of new Set(p.text.split("\n").map((l) => l.trim()))) freq.set(line, (freq.get(line) ?? 0) + 1);
  const out: Candidate[] = [];
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

/** Roadmap không cần AI: mỗi chương chia theo mục con (gộp mục quá ngắn, chia mục quá dài). */
export function deterministicPlan(ranges: ChapterRange[], childrenOf: (r: ChapterRange) => Candidate[]): SectionPlan[] {
  return ranges.map((range) => {
    const starts = [{ title: range.title, page: range.start_page }, ...childrenOf(range).filter((c) => c.page > range.start_page)];
    const topics: TopicPlan[] = [];
    for (const [i, s] of starts.entries()) {
      const end = i + 1 < starts.length ? starts[i + 1].page - 1 : range.end_page;
      const prev = topics.at(-1);
      // Mục quá ngắn → gộp vào mục trước.
      if (prev && end - s.page + 1 < MIN_TOPIC_PAGES) continue;
      topics.push({ title: i === 0 && starts.length > 1 ? `Giới thiệu: ${range.title}` : s.title, description: null, start_page: s.page, importance: "core", est_minutes: null });
    }
    return { range, title: range.title, description: null, topics: splitLong(topics, range) };
  });
}

/** Bài học dài hơn MAX_TOPIC_PAGES → chia thành phần (1), (2)... */
function splitLong(topics: TopicPlan[], range: ChapterRange): TopicPlan[] {
  const out: TopicPlan[] = [];
  topics.forEach((t, i) => {
    const end = i + 1 < topics.length ? topics[i + 1].start_page - 1 : range.end_page;
    const len = end - t.start_page + 1;
    const parts = Math.ceil(len / MAX_TOPIC_PAGES);
    if (parts <= 1) return out.push(t);
    const size = Math.ceil(len / parts);
    for (let k = 0; k < parts; k++) out.push({ ...t, title: `${t.title} (phần ${k + 1})`, start_page: t.start_page + k * size });
  });
  return out;
}

/* ---------------- AI ---------------- */

const roadmapSchema = {
  type: Type.OBJECT,
  properties: {
    sections: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          index: { type: Type.INTEGER },
          skip: { type: Type.BOOLEAN },
          title: { type: Type.STRING },
          description: { type: Type.STRING },
          topics: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                description: { type: Type.STRING },
                start_page: { type: Type.INTEGER },
                importance: { type: Type.STRING, enum: ["core", "optional"] },
                est_minutes: { type: Type.INTEGER },
              },
              required: ["title", "start_page", "importance"],
            },
          },
        },
        required: ["index", "title", "topics"],
      },
    },
  },
  required: ["sections"],
};

const RoadmapZod = z.object({
  sections: z.array(
    z.object({
      index: z.number().int(),
      skip: z.boolean().optional(),
      title: z.string().min(1),
      description: z.string().optional(),
      topics: z.array(
        z.object({
          title: z.string().min(1),
          description: z.string().optional(),
          start_page: z.number().int(),
          importance: z.enum(["core", "optional"]).catch("core"),
          est_minutes: z.number().int().optional(),
        }),
      ),
    }),
  ),
});

function roadmapPrompt(docTitle: string, outline: string) {
  return `
Bạn là chuyên gia thiết kế lộ trình học. Dưới đây là cấu trúc giáo trình "${docTitle}":
mỗi chặng (S<index>) có khoảng trang, kèm các mục con (tiêu đề + trang bắt đầu).

${outline}

Hãy thiết kế ROADMAP HỌC bằng tiếng Việt:
- Giữ thứ tự chặng. Chặng không phải nội dung học (hướng dẫn ôn thi, kế hoạch học, giới thiệu sách...) → skip = true.
- title: tên chặng ngắn gọn bằng tiếng Việt (giữ thuật ngữ chuyên ngành tiếng Anh nếu cần, vd "Ethernet LAN cơ bản").
- description: 1 câu nói chặng này giúp người học làm được gì.
- topics: 3–8 bài học / chặng, theo thứ tự trang. Gộp các mục con quá nhỏ, bỏ mục ôn tập/câu hỏi cuối chương.
  Mỗi bài khoảng ${MIN_TOPIC_PAGES}–${MAX_TOPIC_PAGES} trang. start_page PHẢI lấy từ trang của mục con được liệt kê (hoặc trang đầu chặng), tăng dần.
  title: tên bài tiếng Việt ngắn (≤ 8 từ); description: 1 câu; importance: core (bắt buộc) / optional (mở rộng, ít thi);
  est_minutes: thời gian học ước tính (10–60).`;
}

function outlineText(plans: { range: ChapterRange; candidates: Candidate[] }[]) {
  return plans
    .map(({ range, candidates }, i) =>
      [`S${i} | "${range.title}" | trang ${range.start_page}-${range.end_page}`, ...candidates.slice(0, 40).map((c) => `  - "${c.title}" tr.${c.page}`)].join("\n"),
    )
    .join("\n");
}

/** Chuẩn hóa kết quả AI: trang trong khoảng chặng, tăng dần, bài đầu bắt đầu ở trang đầu chặng. */
function sanitize(plan: z.infer<typeof RoadmapZod>, ranges: ChapterRange[]): SectionPlan[] {
  const out: SectionPlan[] = [];
  for (const s of plan.sections) {
    const range = ranges[s.index];
    if (!range || s.skip || out.some((o) => o.range === range)) continue;
    const topics = s.topics
      .map((t) => ({ ...t, start_page: Math.min(Math.max(t.start_page, range.start_page), range.end_page) }))
      .sort((a, b) => a.start_page - b.start_page)
      .filter((t, i, arr) => i === 0 || t.start_page > arr[i - 1].start_page);
    if (!topics.length) continue;
    topics[0].start_page = range.start_page;
    out.push({
      range,
      title: s.title,
      description: s.description ?? null,
      topics: splitLong(
        topics.map((t) => ({ title: t.title, description: t.description ?? null, start_page: t.start_page, importance: t.importance, est_minutes: t.est_minutes ?? null })),
        range,
      ),
    });
  }
  return out;
}

export async function planRoadmap(opts: {
  doc: Pick<Document, "title" | "user_id">;
  ranges: ChapterRange[];
  childrenOf: (r: ChapterRange) => Candidate[];
}): Promise<{ plan: SectionPlan[]; ai: boolean }> {
  const inputs = opts.ranges.map((range) => ({ range, candidates: opts.childrenOf(range) }));
  try {
    const raw = await generateJson({
      parts: [{ text: roadmapPrompt(opts.doc.title, outlineText(inputs)) }],
      responseSchema: roadmapSchema,
      parse: (r) => RoadmapZod.parse(r),
      userId: opts.doc.user_id,
      feature: "split",
      temperature: 0.2,
    });
    const plan = sanitize(raw, opts.ranges);
    if (plan.length) return { plan, ai: true };
  } catch (err) {
    console.warn("[roadmap] AI lỗi, dùng roadmap từ bookmark:", (err as Error).message.slice(0, 150));
  }
  return { plan: deterministicPlan(opts.ranges, opts.childrenOf), ai: false };
}

/** Ghi roadmap vào DB: roadmap_sections + chapters (bài học) với khoảng trang liên tục. */
export async function saveRoadmap(documentId: number, plan: SectionPlan[]) {
  return sequelize.transaction(async (transaction) => {
    let order = 0;
    for (const [si, s] of plan.entries()) {
      const section = await RoadmapSection.create(
        { document_id: documentId, order_index: si, title: s.title.slice(0, 250), description: s.description },
        { transaction },
      );
      for (const [ti, t] of s.topics.entries()) {
        const end = ti + 1 < s.topics.length ? s.topics[ti + 1].start_page - 1 : s.range.end_page;
        await Chapter.create(
          {
            document_id: documentId,
            section_id: section.id,
            order_index: order++,
            title: t.title.slice(0, 250),
            description: t.description,
            start_page: t.start_page,
            end_page: Math.max(t.start_page, end),
            importance: t.importance,
            est_minutes: t.est_minutes ?? Math.max(10, Math.round((end - t.start_page + 1) * 4)),
          },
          { transaction },
        );
      }
    }
    return order;
  });
}
