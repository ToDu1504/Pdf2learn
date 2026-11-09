import { useEffect } from "react";
import { BadgeCheck } from "lucide-react";
import type { ChapterDetail } from "../../types";
import { targetId, type SummaryTarget } from "./matchNode";

/** Mở trang (hoặc khoảng trang) trong PDF gốc; có `quote` thì tô sáng câu gốc trong trang. */
export type OpenPages = (from: number, to?: number, quote?: string) => void;

/** Nút "tr. N". Ý đã đối chiếu với sách (verified) có dấu tích; bấm để mở trang và tô sáng câu trích. */
export function PageLink({ page, end, onPage, quote, verified }: { page: number; end?: number; onPage: OpenPages; quote?: string | null; verified?: boolean | null }) {
  return (
    <button
      onClick={() => onPage(page, end, quote ?? undefined)}
      className="ml-1 inline-flex items-center gap-0.5 rounded-md bg-brand-50 px-1.5 text-xs font-semibold text-brand-700 hover:bg-brand-100 dark:bg-brand-500/15 dark:text-brand-100"
      title={verified ? `Đã đối chiếu với sách — câu gốc: "${quote}"` : "Mở trang trong PDF gốc"}
    >
      {verified && <BadgeCheck className="size-3" />}
      tr. {page}
    </button>
  );
}

export type SummaryFocus = { target: SummaryTarget; nonce: number };

export function SummaryView({ chapter, onPage, focus }: { chapter: ChapterDetail; onPage: OpenPages; focus?: SummaryFocus | null }) {
  // Được chọn từ sơ đồ tư duy: cuộn tới và nháy sáng phần lý thuyết tương ứng.
  useEffect(() => {
    if (!focus) return;
    const el = document.getElementById(targetId(focus.target));
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.remove("focus-flash");
    void el.offsetWidth; // khởi động lại animation khi bấm cùng node lần nữa
    el.classList.add("focus-flash");
  }, [focus]);

  const s = chapter.summary!;
  return (
    <div className="space-y-6">
      <section id="sum-overview">
        <h3 className="mb-2 flex items-center gap-1 text-sm font-semibold tracking-wide text-slate-500 uppercase">
          Tổng quan
        </h3>
        <p className="leading-7">{s.overview}</p>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold tracking-wide text-slate-500 uppercase">Ý chính</h3>
        <ul className="space-y-2">
          {s.key_points.map((k, i) => (
            <li key={i} id={`sum-point-${i}`} className="flex gap-3 rounded-xl border border-slate-100 p-3 dark:border-slate-800">
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-brand-600 text-xs font-bold text-white">{i + 1}</span>
              <p className="flex-1 leading-6">
                {k.point}
                <PageLink page={k.page} end={k.page_end} onPage={onPage} quote={k.quote} verified={k.verified} />
              </p>
            </li>
          ))}
        </ul>
      </section>

      {s.key_terms.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold tracking-wide text-slate-500 uppercase">Khái niệm</h3>
          <dl className="grid gap-3 sm:grid-cols-2">
            {s.key_terms.map((t, i) => (
              <div key={i} id={`sum-term-${i}`} className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/40">
                <dt className="flex items-center justify-between gap-2 font-semibold">
                  <span>
                    {t.term}
                    <PageLink page={t.page} end={t.page_end} onPage={onPage} quote={t.quote} verified={t.verified} />
                  </span>
                </dt>
                <dd className="mt-1 text-sm text-slate-600 dark:text-slate-400">{t.definition}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </div>
  );
}
