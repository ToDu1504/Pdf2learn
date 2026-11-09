import { useMemo, useState } from "react";
import { ArrowRight, BookCheck, Check, ChevronDown, CircleAlert, Clock } from "lucide-react";
import { Button, cn, EditableTitle, ProgressBar, Spinner } from "../../components/ui";
import type { ChapterItem, DocumentDetail, RoadmapReport } from "../../types";

export type LessonState = "completed" | "ready" | "analyzing" | "failed" | "new";

export const lessonState = (c: ChapterItem): LessonState =>
  c.completed_at ? "completed" : c.analyzing ? "analyzing" : c.status === "done" ? "ready" : c.status === "failed" ? "failed" : "new";

const fmtMinutes = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} giờ${m % 60 ? ` ${m % 60} phút` : ""}` : `${m} phút`);

/** Gom bài học theo chặng; tài liệu cũ không có chặng → 1 chặng chung. */
export function groupLessons(doc: DocumentDetail) {
  if (!doc.sections?.length) return [{ section: { id: 0, order_index: 0, title: "Bài học", description: null }, lessons: doc.chapters }];
  return doc.sections.map((section) => ({ section, lessons: doc.chapters.filter((c) => c.section_id === section.id) }));
}

export function nextLesson(doc: DocumentDetail) {
  return doc.chapters.find((c) => !c.completed_at && c.importance !== "optional") ?? doc.chapters.find((c) => !c.completed_at);
}

/** Biểu tượng trạng thái bài học: vòng xám (chưa mở) · chấm xanh (bài giảng sẵn sàng) · tích xanh lá (xong). */
export function StateIcon({ state, className }: { state: LessonState; className?: string }) {
  const base = cn("grid size-5 shrink-0 place-items-center rounded-full", className);
  if (state === "completed")
    return (
      <span className={cn(base, "bg-emerald-500 text-white")}>
        <Check className="size-3" strokeWidth={3} />
      </span>
    );
  if (state === "analyzing") return <span className={base}><Spinner className="size-4 text-brand-500" /></span>;
  if (state === "ready")
    return (
      <span className={cn(base, "border-[1.5px] border-brand-600")}>
        <span className="size-2 rounded-full bg-brand-600" />
      </span>
    );
  if (state === "failed") return <CircleAlert className={cn("size-5 shrink-0 text-rose-500", className)} strokeWidth={1.75} />;
  return <span className={cn(base, "border-[1.5px] border-slate-300 dark:border-slate-600")} />;
}

function LessonCard({ lesson, onOpen }: { lesson: ChapterItem; onOpen: (id: number) => void }) {
  const state = lessonState(lesson);
  const optional = lesson.importance === "optional";
  return (
    <button
      onClick={() => onOpen(lesson.id)}
      title={[lesson.source_title && `Theo sách: ${lesson.source_title}`, lesson.description].filter(Boolean).join("\n") || undefined}
      className={cn(
        "group flex w-full min-w-0 items-center gap-3 rounded-xl border bg-white px-4 py-3 text-left transition hover:border-black/15 hover:shadow-[0_2px_8px_rgba(0,0,0,0.06)] dark:bg-slate-900 dark:hover:border-white/20",
        optional ? "border-dashed border-black/15 dark:border-white/15" : "border-black/[0.06] dark:border-white/[0.08]",
      )}
    >
      <StateIcon state={state} />
      <span className="min-w-0 flex-1">
        <span className={cn("block text-[15px] leading-snug font-medium", state === "completed" && "text-slate-500")}>{lesson.title}</span>
        <span className="mt-0.5 flex items-center gap-2 text-[12px] text-slate-500">
          <span className="tabular-nums">
            tr. {lesson.start_page}–{lesson.end_page}
          </span>
          {lesson.est_minutes ? <span>· {lesson.est_minutes} phút</span> : null}
          {optional && <span>· Tùy chọn</span>}
        </span>
      </span>
      <ArrowRight className="size-4 shrink-0 text-slate-300 opacity-0 transition group-hover:translate-x-0.5 group-hover:opacity-100" />
    </button>
  );
}

const SOURCE_LABEL: Record<RoadmapReport["source"], string> = {
  bookmark: "mục lục (bookmark) của PDF",
  toc: "trang mục lục do AI đọc",
  fixed: "chia đều theo trang (PDF không có mục lục)",
};

/** Đối chiếu với sách: lộ trình phủ bao nhiêu trang, đoạn nào bị bỏ qua và vì sao (tên mục trong sách). */
function BookCheckPanel({ report }: { report: RoadmapReport }) {
  const pct = Math.round((report.covered / Math.max(1, report.page_count)) * 100);
  return (
    <details className="card group mb-14 overflow-hidden">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-4 [&::-webkit-details-marker]:hidden">
        <BookCheck className="size-5 shrink-0 text-brand-600" strokeWidth={1.75} />
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-medium">Đối chiếu với sách</span>
          <span className="block text-[13px] text-slate-500">
            Bài học phủ {report.covered}/{report.page_count} trang ({pct}%) · dựng từ {SOURCE_LABEL[report.source]}
            {report.skipped.length ? ` · ${report.skipped.length} đoạn không thành bài học` : ""}
          </span>
        </span>
        <ChevronDown className="size-4 shrink-0 text-slate-400 transition group-open:rotate-180" />
      </summary>
      <div className="border-t border-black/[0.06] px-5 py-4 text-[14px] dark:border-white/[0.08]">
        <p className="mb-3 text-slate-500">
          Mỗi chặng là một chương, mỗi bài là một mục trong mục lục của sách; AI chỉ dịch tên và viết mô tả, không đổi khoảng trang.
          Các đoạn dưới đây không thành bài học (bìa, mục lục, phần ôn tập cuối chương, phụ lục…):
        </p>
        <ul className="space-y-1.5">
          {report.skipped.map((s) => (
            <li key={s.from} className="flex gap-3">
              <span className="w-24 shrink-0 text-slate-400 tabular-nums">
                tr. {s.from === s.to ? s.from : `${s.from}–${s.to}`}
              </span>
              <span className="min-w-0 text-slate-600 dark:text-slate-300">{s.titles.join(" · ") || "—"}</span>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}

/**
 * Lộ trình dạng trục dọc mảnh: mỗi chặng là một mốc đánh số trên trục, bài học xếp hai bên
 * (màn rộng) hoặc một cột (điện thoại). Bấm bài học để mở bài giảng.
 */
export function RoadmapView({ doc, onOpen, onRenameSection }: { doc: DocumentDetail; onOpen: (lessonId: number) => void; onRenameSection?: (sectionId: number, title: string) => Promise<unknown> }) {
  const [hideOptional, setHideOptional] = useState(false);
  const groups = useMemo(() => groupLessons(doc), [doc]);
  const total = doc.chapters.length;
  const done = doc.chapters.filter((c) => c.completed_at).length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const remaining = doc.chapters.filter((c) => !c.completed_at).reduce((n, c) => n + (c.est_minutes ?? 20), 0);
  const next = nextLesson(doc);
  const hasOptional = doc.chapters.some((c) => c.importance === "optional");

  return (
    <div>
      {/* Tổng quan tiến độ */}
      <div className="mb-14 flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <div className="flex-1 md:max-w-md">
          <p className="text-[48px] leading-none font-semibold tracking-tight tabular-nums">
            {pct}
            <span className="text-[28px] text-slate-400">%</span>
          </p>
          <p className="mt-2 text-[15px] text-slate-500">
            {done}/{total} bài hoàn thành
            {remaining > 0 && (
              <>
                {" · "}
                <Clock className="mb-0.5 inline size-3.5" /> còn khoảng {fmtMinutes(remaining)}
              </>
            )}
          </p>
          <ProgressBar value={pct} className="mt-4" />
        </div>
        <div className="flex flex-col items-start gap-3 md:items-end">
          {next ? (
            <Button size="lg" onClick={() => onOpen(next.id)} className="max-w-full">
              <span className="truncate">{done ? "Học tiếp" : "Bắt đầu học"}</span>
              <ArrowRight />
            </Button>
          ) : (
            <p className="text-[17px] font-semibold text-emerald-600">Bạn đã hoàn thành lộ trình.</p>
          )}
          {next && <p className="max-w-xs truncate text-[13px] text-slate-500 md:text-right">{next.title}</p>}
          {hasOptional && (
            <label className="flex cursor-pointer items-center gap-2 text-[13px] text-slate-500">
              <input type="checkbox" className="accent-brand-600" checked={hideOptional} onChange={(e) => setHideOptional(e.target.checked)} />
              Ẩn bài tùy chọn
            </label>
          )}
        </div>
      </div>

      {doc.roadmap_report && <BookCheckPanel report={doc.roadmap_report} />}

      <div className="relative">
        {/* trục dọc */}
        <div className="absolute top-2 bottom-2 left-[15px] w-px bg-slate-300 md:left-1/2 dark:bg-white/15" />

        <ol className="relative space-y-14">
          {groups.map(({ section, lessons }, si) => {
            const visible = lessons.filter((l) => !hideOptional || l.importance !== "optional");
            const finished = lessons.filter((l) => l.completed_at).length;
            const sectionDone = lessons.length > 0 && finished === lessons.length;
            const rows = Array.from({ length: Math.ceil(visible.length / 2) }, (_, r) => [visible[r * 2], visible[r * 2 + 1]] as const);
            return (
              <li key={section.id}>
                {/* mốc chặng */}
                <div className="mb-6 flex items-start gap-4 md:flex-col md:items-center md:gap-3 md:text-center">
                  <span
                    className={cn(
                      "relative z-10 grid size-8 shrink-0 place-items-center rounded-full text-[13px] font-semibold ring-8 ring-slate-50 dark:ring-slate-950",
                      sectionDone ? "bg-emerald-500 text-white" : "border border-slate-300 bg-white text-slate-700 dark:border-white/20 dark:bg-slate-900 dark:text-slate-200",
                    )}
                  >
                    {sectionDone ? <Check className="size-4" strokeWidth={3} /> : si + 1}
                  </span>
                  <div className="relative z-10 max-w-lg pt-0.5 md:bg-slate-50 md:px-4 md:pt-0 md:dark:bg-slate-950">
                    <p className="text-[22px] leading-tight font-semibold">
                      {section.id && onRenameSection ? (
                        <EditableTitle value={section.title} label="Đổi tên chặng" onSave={(t) => onRenameSection(section.id, t)} />
                      ) : (
                        section.title
                      )}
                    </p>
                    {section.source_title && section.source_title !== section.title && <p className="mt-0.5 text-[12px] text-slate-400">{section.source_title}</p>}
                    {section.description && <p className="mt-1 text-[15px] text-slate-500">{section.description}</p>}
                    <p className="mt-1 text-[12px] text-slate-400">
                      {finished}/{lessons.length} bài
                    </p>
                  </div>
                </div>

                {/* bài học */}
                <div className="space-y-2.5 pl-12 md:pl-0">
                  {rows.map(([left, right], r) => (
                    <div key={r} className="grid gap-2.5 md:grid-cols-[1fr_3rem_1fr] md:gap-0">
                      <div>{left && <LessonCard lesson={left} onOpen={onOpen} />}</div>
                      <div className="relative hidden md:block">
                        {left && <span className="absolute top-1/2 right-1/2 left-0 h-px bg-slate-300 dark:bg-white/15" />}
                        {right && <span className="absolute top-1/2 right-0 left-1/2 h-px bg-slate-300 dark:bg-white/15" />}
                      </div>
                      <div>{right && <LessonCard lesson={right} onOpen={onOpen} />}</div>
                    </div>
                  ))}
                </div>
              </li>
            );
          })}
        </ol>

        <div className="relative mt-14 flex items-center gap-4 md:flex-col md:gap-2">
          <span className="relative z-10 grid size-8 place-items-center rounded-full bg-slate-900 text-white ring-8 ring-slate-50 dark:bg-white dark:text-slate-900 dark:ring-slate-950">
            <Check className="size-4" strokeWidth={3} />
          </span>
          <p className="text-[15px] font-semibold">Hoàn thành</p>
        </div>
      </div>
    </div>
  );
}
