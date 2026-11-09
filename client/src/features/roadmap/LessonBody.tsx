import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Bài giảng markdown; "(tr. N)" thành nút mở PDF gốc đúng trang. */
export function LessonBody({ markdown, onPage }: { markdown: string; onPage: (from: number, to?: number) => void }) {
  // (tr. 12) → mở 1 trang; (tr. 12–13) → mở cả khoảng trang.
  const linked = markdown.replace(/\((?:tr|trang)\.?\s*(\d+)(?:\s*[-–]\s*(\d+))?\)/gi, (_m, a: string, b?: string) =>
    b && Number(b) > Number(a) ? `[tr. ${a}–${b}](#page-${a}-${b})` : `[tr. ${a}](#page-${a})`,
  );
  return (
    <article className="prose-study prose-lesson">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => {
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
