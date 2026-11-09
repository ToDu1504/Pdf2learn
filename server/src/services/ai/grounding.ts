/**
 * KIỂM CHỨNG NỘI DUNG AI VỚI SÁCH — quy tắc "không trích được nguyên văn thì không được dạy".
 *
 * AI phải kèm mỗi ý một câu trích NGUYÊN VĂN ngắn từ sách (quote) + số trang. Code (không phải AI) đối chiếu
 * câu trích với text trang đã trích từ PDF (document_pages):
 *   - tìm thấy ở đúng trang            → verified
 *   - tìm thấy ở trang khác trong bài  → verified, sửa lại số trang
 *   - không tìm thấy trong bài         → ý bị loại (ý chính, thuật ngữ, câu hỏi) hoặc gắn nhãn
 *                                         "chưa kiểm chứng" (câu dẫn trong bài giảng)
 * PDF scan (không có text) không đối chiếu được: giữ nguyên, gắn verified = false.
 */

export type PageText = { page: number; text: string };
export type Located = { page: number; score: number };

/** Từ (chữ/số) đã chuẩn hóa: bỏ gạch nối cuối dòng, ligature, dấu câu, hoa/thường. */
export function tokens(s: string): string[] {
  return (
    s
      .normalize("NFKC")
      .toLowerCase()
      .replace(/(\p{L})-\s*\n\s*(\p{L})/gu, "$1$2") // gạch nối ngắt dòng trong PDF
      .match(/[\p{L}\p{N}]+/gu) ?? []
  );
}

const grams = (t: string[], n: number) => {
  const out: string[] = [];
  for (let i = 0; i + n <= t.length; i++) out.push(t.slice(i, i + n).join(" "));
  return out;
};

export const MIN_QUOTE_TOKENS = 4;
export const MATCH_THRESHOLD = 0.7;

/**
 * Bộ tìm câu trích trong các trang của 1 bài. Điểm = tỉ lệ cụm 3 từ (2 từ nếu câu trích ngắn) của câu trích
 * có mặt trong trang (gộp cả trang kế tiếp, vì câu trích có thể vắt qua 2 trang). Chịu được AI sửa nhẹ
 * chính tả/dấu câu nhưng không chịu được diễn giải lại.
 */
export function quoteLocator(pages: PageText[]) {
  const sorted = [...pages].sort((a, b) => a.page - b.page);
  const toks = new Map(sorted.map((p) => [p.page, tokens(p.text)]));
  const cache = new Map<string, Set<string>>();
  /** spill = trang + đầu trang sau (câu vắt trang). */
  const gramSet = (page: number, n: number, spill: boolean) => {
    const key = `${page}:${n}:${spill}`;
    let set = cache.get(key);
    if (!set) {
      const own = toks.get(page) ?? [];
      set = new Set(grams(spill ? [...own, ...(toks.get(page + 1) ?? []).slice(0, 60)] : own, n));
      cache.set(key, set);
    }
    return set;
  };

  return (quote: string | null | undefined, hint?: number): Located | null => {
    const qt = tokens(quote ?? "");
    if (qt.length < MIN_QUOTE_TOKENS) return null;
    const n = qt.length >= 8 ? 3 : 2;
    const qg = grams(qt, n);
    // Trang AI ghi được thử trước: hòa điểm thì giữ trang đó.
    const order = sorted.map((p) => p.page).sort((a, b) => (a === hint ? -1 : b === hint ? 1 : a - b));
    const best = (spill: boolean) => {
      let top: Located | null = null;
      for (const page of order) {
        const set = gramSet(page, n, spill);
        const score = qg.filter((g) => set.has(g)).length / qg.length;
        if (!top || score > top.score) top = { page, score };
        if (score === 1) break;
      }
      return top && top.score >= MATCH_THRESHOLD ? top : null;
    };
    // Ưu tiên trang chứa trọn câu trích; chỉ ghép trang sau khi câu vắt qua 2 trang.
    return best(false) ?? best(true);
  };
}

/** Thuật ngữ (hoặc 1 phần của nó: "RAM (Random Access Memory)") có xuất hiện trong text bài không. */
export function termInText(term: string, chapterTokens: string): boolean {
  const parts = term
    .split(/[()/,;]| - | – /)
    .map((p) => tokens(p).join(" "))
    .filter((p) => p.length >= 2);
  return parts.some((p) => ` ${chapterTokens} `.includes(` ${p} `));
}

export type Evidence = { k: number; page: number; quote: string; verified: boolean };
export type Subtopic = { title: string; from: number; to: number };
export type Grounding = {
  mode: "text" | "file";
  /** Câu dẫn nguồn trong bài giảng: đã đối chiếu / tổng. */
  lesson: { verified: number; total: number };
  points: { kept: number; dropped: number };
  terms: { kept: number; dropped: number };
  questions: { kept: number; dropped: number };
  /** Mục con của bài trong sách mà nội dung đã kiểm chứng chưa chạm tới. */
  missing: Subtopic[];
  subtopics: number;
};

/** Mục con nào có ít nhất 1 trích dẫn đã kiểm chứng nằm trong khoảng trang của nó. */
export function missingSubtopics(subtopics: Subtopic[], verifiedPages: number[]): Subtopic[] {
  return subtopics.filter((s) => !verifiedPages.some((p) => p >= s.from && p <= s.to));
}

/**
 * Bài giảng markdown: AI đánh dấu nguồn bằng [^k] (k = chỉ số trong lesson_quotes). Đổi thành
 * "(tr. P #k)" khi câu trích đã kiểm chứng, "(chưa kiểm chứng)" khi không. Marker không có câu trích bị bỏ.
 */
export function rewriteLessonCitations(md: string, evidence: Evidence[]): { md: string; verified: number; total: number } {
  const byK = new Map(evidence.map((e) => [e.k, e]));
  let verified = 0;
  let total = 0;
  const out = md.replace(/\s?\[\^(\d+)\]/g, (_m, k: string) => {
    const e = byK.get(Number(k));
    if (!e) return "";
    total++;
    if (!e.verified) return " (chưa kiểm chứng)";
    verified++;
    return ` (tr. ${e.page} #${e.k})`;
  });
  return { md: out, verified, total };
}

type PointIn = { point: string; page: number; page_end?: number; quote?: string };
type TermIn = { term: string; definition: string; page: number; page_end?: number; quote?: string };
type QuestionIn = { source_page: number; source_quote?: string | null };
export type LessonQuote = { k: number; page: number; quote: string };

/**
 * Áp quy tắc kiểm chứng lên kết quả AI của 1 bài. `pages` = text các trang của bài (null nếu PDF scan → không
 * đối chiếu được, giữ nguyên và gắn verified = false). Số trang đầu vào đã được đổi sang trang PDF gốc.
 */
export function applyGrounding<Q extends QuestionIn>(input: {
  pages: PageText[] | null;
  subtopics: Subtopic[];
  lesson_md?: string | null;
  lesson_quotes?: LessonQuote[];
  key_points?: PointIn[];
  key_terms?: TermIn[];
  questions?: Q[];
}) {
  const { pages, subtopics } = input;
  const points = input.key_points ?? [];
  const terms = input.key_terms ?? [];
  const questions = input.questions ?? [];
  const quotes = input.lesson_quotes ?? [];

  if (!pages?.length) {
    // PDF scan: không có text để đối chiếu.
    const evidence = quotes.map((q) => ({ ...q, verified: false }));
    // Giữ số trang AI ghi, bỏ "#k" để giao diện không coi là đã kiểm chứng.
    const lesson = input.lesson_md != null ? rewriteLessonCitations(input.lesson_md, evidence.map((e) => ({ ...e, verified: true }))) : null;
    return {
      lesson_md: lesson?.md.replace(/ #\d+\)/g, ")") ?? null,
      evidence,
      key_points: points.map((k) => ({ ...k, verified: false })),
      key_terms: terms.map((t) => ({ ...t, verified: false })),
      questions: questions.map((q) => ({ ...q, verified: false })),
      grounding: {
        mode: "file",
        lesson: { verified: 0, total: lesson?.total ?? 0 },
        points: { kept: points.length, dropped: 0 },
        terms: { kept: terms.length, dropped: 0 },
        questions: { kept: questions.length, dropped: 0 },
        missing: [],
        subtopics: subtopics.length,
      } satisfies Grounding,
    };
  }

  const locate = quoteLocator(pages);
  const allTokens = pages.map((p) => tokens(p.text).join(" ")).join(" ");
  const verifiedPages: number[] = [];
  const found = (quote: string | null | undefined, hint: number) => {
    const loc = locate(quote, hint);
    if (loc) verifiedPages.push(loc.page);
    return loc;
  };

  const keptPoints = points.flatMap((k) => {
    const loc = found(k.quote, k.page);
    if (!loc) return [];
    const { page_end, ...rest } = k;
    return [{ ...rest, page: loc.page, ...(page_end && page_end > loc.page ? { page_end } : {}), verified: true }];
  });
  const keptTerms = terms.flatMap((t) => {
    if (!termInText(t.term, allTokens)) return [];
    const loc = found(t.quote, t.page);
    if (!loc) return [];
    const { page_end, ...rest } = t;
    return [{ ...rest, page: loc.page, ...(page_end && page_end > loc.page ? { page_end } : {}), verified: true }];
  });
  const keptQuestions = questions.flatMap((q) => {
    const loc = found(q.source_quote, q.source_page);
    return loc ? [{ ...q, source_page: loc.page, verified: true }] : [];
  });
  const evidence: Evidence[] = quotes.map((q) => {
    const loc = found(q.quote, q.page);
    return { k: q.k, page: loc?.page ?? q.page, quote: q.quote, verified: !!loc };
  });
  const lesson = input.lesson_md != null ? rewriteLessonCitations(input.lesson_md, evidence) : null;

  return {
    lesson_md: lesson?.md ?? null,
    evidence,
    key_points: keptPoints,
    key_terms: keptTerms,
    questions: keptQuestions,
    grounding: {
      mode: "text",
      lesson: { verified: lesson?.verified ?? 0, total: lesson?.total ?? 0 },
      points: { kept: keptPoints.length, dropped: points.length - keptPoints.length },
      terms: { kept: keptTerms.length, dropped: terms.length - keptTerms.length },
      questions: { kept: keptQuestions.length, dropped: questions.length - keptQuestions.length },
      missing: missingSubtopics(subtopics, verifiedPages),
      subtopics: subtopics.length,
    } satisfies Grounding,
  };
}
