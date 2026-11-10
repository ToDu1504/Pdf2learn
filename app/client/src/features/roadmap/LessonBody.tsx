import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { BadgeCheck } from "lucide-react";
import type { Evidence } from "../../types";
import { BookFigure, type Figure } from "./BookFigure";

/**
 * Bài giảng markdown. Dẫn nguồn:
 *  - "(tr. N #k)": đã đối chiếu với sách (câu trích evidence[k]) → nút mở PDF và tô sáng câu gốc;
 *  - "(tr. N)" / "(tr. N–M)": mở trang (bài soạn trước khi có kiểm chứng, hoặc PDF scan);
 *  - "(chưa kiểm chứng)": câu trích AI đưa ra không tìm thấy trong sách.
 */
const CITE = /\((?:tr|trang)\.?\s*(\d+)(?:\s*[-–]\s*(\d+))?/gi;
const FIG_MARK = /^%%FIG(\d+)%%$/;

/**
 * Đặt hình của sách ngay sau đoạn ĐẦU TIÊN của bài dẫn tới trang có hình ("(tr. N)"), như giáo viên vừa giảng vừa
 * chỉ vào hình. Hình không có đoạn nào nhắc tới trang của nó → trả về để hiện ở cuối bài.
 */
export function placeFigures(markdown: string, figures: Figure[]) {
  const blocks: string[] = [];
  let cur: string[] = [];
  let fence = false;
  for (const line of markdown.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    if (!fence && !line.trim()) {
      if (cur.length) blocks.push(cur.join("\n"));
      cur = [];
    } else cur.push(line);
  }
  if (cur.length) blocks.push(cur.join("\n"));

  const placed = new Set<number>();
  const out: string[] = [];
  for (const block of blocks) {
    out.push(block);
    const pages = new Set<number>();
    for (const m of block.matchAll(CITE)) {
      const a = Number(m[1]);
      const b = m[2] && Number(m[2]) > a ? Math.min(Number(m[2]), a + 6) : a;
      for (let p = a; p <= b; p++) pages.add(p);
    }
    figures.forEach((f, i) => {
      if (!placed.has(i) && pages.has(f.page)) {
        placed.add(i);
        out.push(`%%FIG${i}%%`);
      }
    });
  }
  return { markdown: out.join("\n\n"), rest: figures.filter((_, i) => !placed.has(i)) };
}

export function LessonBody({
  markdown,
  onPage,
  evidence,
  documentId,
  figures,
}: {
  markdown: string;
  onPage: (from: number, to?: number, quote?: string) => void;
  evidence?: Evidence[] | null;
  documentId?: number;
  figures?: Figure[];
}) {
  const byK = new Map((evidence ?? []).map((e) => [e.k, e]));
  const figs = documentId && figures?.length ? figures : [];
  const placedFigs = placeFigures(markdown, figs);
  const linked = placedFigs.markdown
    .replace(/\((?:tr|trang)\.?\s*(\d+)(?:\s*[-–]\s*(\d+))?(?:\s*#(\d+))?\)/gi, (_m, a: string, b?: string, k?: string) =>
      k ? `[tr. ${a}](#ev-${k})` : b && Number(b) > Number(a) ? `[tr. ${a}–${b}](#page-${a}-${b})` : `[tr. ${a}](#page-${a})`,
    )
    .replace(/\(chưa kiểm chứng\)/g, "[chưa kiểm chứng](#unverified)");
  return (
    <article className="prose-study prose-lesson">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => {
            const m = typeof children === "string" ? FIG_MARK.exec(children.trim()) : null;
            const fig = m && figs[Number(m[1])];
            return fig ? <BookFigure documentId={documentId!} fig={fig} onPage={(p) => onPage(p)} /> : <p>{children}</p>;
          },
          a:({ href, children }) => {
            const ev = /^#ev-(\d+)$/.exec(href ?? "");
            const e = ev && byK.get(Number(ev[1]));
            if (e)
              return (
                <button
                  onClick={() => onPage(e.page, e.page, e.quote)}
                  className="mx-0.5 inline-flex items-center gap-0.5 align-baseline text-[0.8em] font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300"
                  title={`Đã đối chiếu với sách — câu gốc: "${e.quote}"`}
                >
                  <BadgeCheck className="size-3" />
                  {children}
                </button>
              );
            if (href === "#unverified")
              return (
                <span
                  className="mx-0.5 rounded bg-amber-100 px-1 align-baseline text-[0.72em] font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"
                  title="AI đưa ra câu trích nhưng không tìm thấy trong sách: hãy đối chiếu với PDF trước khi tin ý này"
                >
                  {children}
                </span>
              );
            const m = /^#page-(\d+)(?:-(\d+))?$/.exec(href ?? "");
            if (m)
              return (
                <button
                  onClick={() => onPage(Number(m[1]), m[2] ? Number(m[2]) : undefined)}
                  className="mx-0.5 align-baseline text-[0.8em] font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300"
                  title="Mở trang trong PDF gốc"
                >
                  {children}
                </button>
              );
            return (
              <a href={href} target="_blank" rel="noreferrer" className="text-brand-600 hover:text-brand-700">
                {children}
              </a>
            );
          },
        }}
      >
        {linked}
      </ReactMarkdown>
      {placedFigs.rest.length > 0 && (
        <section>
          <h2>Hình khác trong bài</h2>
          {placedFigs.rest.map((f) => (
            <BookFigure key={`${f.page}-${f.index}`} documentId={documentId!} fig={f} onPage={(p) => onPage(p)} />
          ))}
        </section>
      )}
    </article>
  );
}
