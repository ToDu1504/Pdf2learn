import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { BadgeCheck } from "lucide-react";
import type { Evidence } from "../../types";

/**
 * Bài giảng markdown. Dẫn nguồn:
 *  - "(tr. N #k)": đã đối chiếu với sách (câu trích evidence[k]) → nút mở PDF và tô sáng câu gốc;
 *  - "(tr. N)" / "(tr. N–M)": mở trang (bài soạn trước khi có kiểm chứng, hoặc PDF scan);
 *  - "(chưa kiểm chứng)": câu trích AI đưa ra không tìm thấy trong sách.
 */
export function LessonBody({
  markdown,
  onPage,
  evidence,
}: {
  markdown: string;
  onPage: (from: number, to?: number, quote?: string) => void;
  evidence?: Evidence[] | null;
}) {
  const byK = new Map((evidence ?? []).map((e) => [e.k, e]));
  const linked = markdown
    .replace(/\((?:tr|trang)\.?\s*(\d+)(?:\s*[-–]\s*(\d+))?(?:\s*#(\d+))?\)/gi, (_m, a: string, b?: string, k?: string) =>
      k ? `[tr. ${a}](#ev-${k})` : b && Number(b) > Number(a) ? `[tr. ${a}–${b}](#page-${a}-${b})` : `[tr. ${a}](#page-${a})`,
    )
    .replace(/\(chưa kiểm chứng\)/g, "[chưa kiểm chứng](#unverified)");
  return (
    <article className="prose-study prose-lesson">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => {
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
    </article>
  );
}
