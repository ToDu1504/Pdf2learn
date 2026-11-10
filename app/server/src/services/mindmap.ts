import type { KeyPoint, KeyTerm } from "../models/index.js";
import type { Subtopic } from "./ai/grounding.js";

/**
 * Sơ đồ tư duy dựng bằng CODE (0 lượt AI): gốc = bài học, nhánh = các mục con của bài theo mục lục sách,
 * lá = ý chính / thuật ngữ ĐÃ KIỂM CHỨNG nằm trong khoảng trang của mục đó. Nhờ vậy sơ đồ theo đúng cấu trúc
 * của sách và chỉ chứa nội dung đã đối chiếu với PDF. Bài không có mục con → 2 nhánh "Ý chính" và "Khái niệm".
 */
const MAX_BRANCHES = 8;
const MAX_LEAVES = 6;
const MAX_WORDS = 12; // tiếng Việt: 1 từ = 1 âm tiết

/** Mermaid mindmap hiểu ( ) [ ] { } là hình dạng nút, "::" là icon → bỏ các ký tự đó. */
const clean = (s: string) =>
  s
    .replace(/[()[\]{}"`<>]/g, " ")
    .replace(/::/g, ":")
    .replace(/\s+/g, " ")
    .trim();

/** Rút gọn câu thành nhãn nút: lấy vế đầu (tới dấu phẩy/hai chấm/chấm), tối đa MAX_WORDS từ. */
export function shortLabel(s: string) {
  const first = clean(s).split(/(?<=\S)[,:;.–—](?:\s|$)/)[0].trim();
  const words = first.split(" ");
  return words.length > MAX_WORDS ? `${words.slice(0, MAX_WORDS).join(" ")}…` : first;
}

type Leaf = { label: string; page: number };

export function buildMindmap(input: {
  title: string;
  subtopics: Subtopic[] | null | undefined;
  key_points: KeyPoint[];
  key_terms: KeyTerm[];
  /** Bản scan (mode "file") không kiểm chứng được: dùng mọi ý. */
  unverifiable?: boolean;
}) {
  const ok = (x: { verified?: boolean }) => input.unverifiable || x.verified !== false;
  const points: Leaf[] = input.key_points.filter(ok).map((p) => ({ label: shortLabel(p.point), page: p.page }));
  const terms: Leaf[] = input.key_terms.filter(ok).map((t) => ({ label: clean(t.term), page: t.page }));
  if (!points.length && !terms.length) return null;

  const subs = (input.subtopics ?? []).filter((s) => clean(s.title));
  let branches: { label: string; leaves: Leaf[] }[];
  if (subs.length >= 2) {
    const inSub = (l: Leaf) => subs.findIndex((s) => l.page >= s.from && l.page <= s.to);
    branches = subs.map((s) => ({ label: clean(s.title), leaves: [] as Leaf[] }));
    const other: Leaf[] = [];
    // Thuật ngữ trước: nhãn ngắn, dễ nhìn; ý chính sau.
    for (const l of [...terms, ...points]) {
      const i = inSub(l);
      (i >= 0 ? branches[i].leaves : other).push(l);
    }
    branches = branches.filter((b) => b.leaves.length);
    if (other.length) branches.push({ label: "Ý khác", leaves: other });
  } else {
    branches = [
      { label: "Ý chính", leaves: points },
      { label: "Khái niệm", leaves: terms },
    ].filter((b) => b.leaves.length);
  }

  const seen = new Set<string>();
  const lines = ["mindmap", `  root((${clean(input.title) || "Bài học"}))`];
  for (const b of branches.slice(0, MAX_BRANCHES)) {
    const leaves = b.leaves.filter((l) => l.label && !seen.has(l.label.toLowerCase()) && seen.add(l.label.toLowerCase())).slice(0, MAX_LEAVES);
    if (!leaves.length) continue;
    lines.push(`    ${b.label}`);
    for (const l of leaves) lines.push(`      ${l.label}`);
  }
  return lines.length > 2 ? lines.join("\n") : null;
}
