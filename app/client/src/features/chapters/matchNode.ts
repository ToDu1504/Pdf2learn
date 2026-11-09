import type { Summary } from "../../types";

export type SummaryTarget = { kind: "overview" } | { kind: "point"; index: number } | { kind: "term"; index: number };

const STOP = new Set(["va", "cua", "la", "cac", "nhung", "mot", "cho", "voi", "trong", "the", "and", "of", "to", "in", "a", "an", "for", "on", "co", "duoc", "khi", "de"]);

/** Bỏ dấu tiếng Việt, chữ thường, tách từ có nghĩa. */
export function tokens(s: string) {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOP.has(w));
}

/** Tỉ lệ từ của node xuất hiện trong ứng viên (node thường là cụm ngắn rút gọn từ ý chính). */
function score(node: string[], candidate: string[]) {
  if (!node.length || !candidate.length) return 0;
  const set = new Set(candidate);
  const hit = node.filter((w) => set.has(w)).length;
  return hit / node.length;
}

/**
 * Tìm phần lý thuyết khớp nhất với chữ trên node sơ đồ.
 * Ưu tiên khái niệm (thuật ngữ trùng gần như nguyên văn), rồi tới ý chính; node gốc → tổng quan.
 */
export function matchNode(text: string, summary: Pick<Summary, "key_points" | "key_terms">, isRoot = false): SummaryTarget | null {
  if (isRoot) return { kind: "overview" };
  const node = tokens(text);
  let best: { target: SummaryTarget; s: number } | null = null;
  const consider = (target: SummaryTarget, s: number) => {
    if (!best || s > best.s) best = { target, s };
  };
  summary.key_terms.forEach((t, index) => {
    const term = tokens(t.term);
    // Node trùng thuật ngữ → gần như chắc chắn; cộng điểm để thắng ý chính có chứa cùng từ.
    const exact = term.length && term.every((w) => node.includes(w)) ? 0.5 : 0;
    consider({ kind: "term", index }, score(node, [...term, ...tokens(t.definition)]) + exact);
  });
  summary.key_points.forEach((p, index) => consider({ kind: "point", index }, score(node, tokens(p.point))));
  const found = best as { target: SummaryTarget; s: number } | null;
  return found && found.s >= 0.34 ? found.target : null;
}

export const targetId = (t: SummaryTarget) => (t.kind === "overview" ? "sum-overview" : t.kind === "point" ? `sum-point-${t.index}` : `sum-term-${t.index}`);
