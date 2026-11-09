import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, BookOpenCheck, CircleAlert, RotateCw, ScanText, Sparkles } from "lucide-react";
import { errorMessage, http } from "../../api/client";
import { Button } from "../../components/ui";
import { ask } from "../../stores/confirm";
import { toast } from "../../stores/toast";
import type { ChapterDetail } from "../../types";
import type { OpenPages } from "../chapters/SummaryView";

/**
 * Đối chiếu bài học với sách (server: services/ai/grounding.ts):
 *  - bao nhiêu dẫn chứng trong bài giảng đã tìm thấy nguyên văn trong PDF, bao nhiêu ý bị loại vì không có trong sách;
 *  - mục nào trong mục lục của bài mà bài giảng chưa nói tới (bổ sung bằng 1 lượt AI);
 *  - bài soạn trước khi có quy tắc này → mời soạn lại.
 */
export function GroundingPanel({ chapter, onPage }: { chapter: ChapterDetail; onPage: OpenPages }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<"supplement" | "reanalyze" | null>(null);
  const g = chapter.summary?.grounding;

  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["chapter", chapter.id] }), qc.invalidateQueries({ queryKey: ["document", chapter.document.id] })]);
  const reanalyze = async () => {
    const ok = await ask({
      title: "Soạn lại bài này?",
      message: "Bài giảng, tóm tắt và câu hỏi được soạn lại theo quy tắc đối chiếu với sách (tốn 1 lượt AI). Flashcard trùng thuật ngữ được giữ lịch ôn.",
      confirmLabel: "Soạn lại",
    });
    if (!ok) return;
    setBusy("reanalyze");
    try {
      await http.post(`/chapters/${chapter.id}/reanalyze`);
      await refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };
  const supplement = async () => {
    setBusy("supplement");
    try {
      await http.post(`/chapters/${chapter.id}/supplement`);
      await refresh();
      toast.success("Đã bổ sung bài giảng");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const box = "mb-8 rounded-2xl border border-black/[0.06] px-4 py-3 text-[14px] dark:border-white/[0.08]";

  if (!g)
    return (
      <div className={`${box} flex flex-wrap items-center gap-3`}>
        <CircleAlert className="size-4 shrink-0 text-amber-500" />
        <p className="min-w-0 flex-1 text-slate-600 dark:text-slate-300">
          Bài này được soạn trước khi có quy tắc đối chiếu với sách: các ý chưa được kiểm chứng với PDF.
        </p>
        <Button size="sm" variant="secondary" loading={busy === "reanalyze"} onClick={reanalyze}>
          <RotateCw /> Soạn lại có kiểm chứng
        </Button>
      </div>
    );

  if (g.mode === "file")
    return (
      <div className={`${box} flex items-center gap-3`}>
        <ScanText className="size-4 shrink-0 text-slate-400" />
        <p className="text-slate-600 dark:text-slate-300">PDF dạng ảnh scan: không đối chiếu tự động được. Hãy bấm số trang để xem bản gốc khi học.</p>
      </div>
    );

  const dropped = g.points.dropped + g.terms.dropped + g.questions.dropped;
  return (
    <div className={box}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <BadgeCheck className="size-4 shrink-0 text-brand-600" />
        <p className="min-w-0 flex-1 text-slate-600 dark:text-slate-300">
          <span className="font-medium text-slate-900 dark:text-slate-100">Đã đối chiếu với sách:</span>{" "}
          {g.lesson.total ? `${g.lesson.verified}/${g.lesson.total} dẫn chứng của bài giảng tìm thấy nguyên văn trong PDF` : "bài giảng chưa có dẫn chứng"}
          {dropped > 0 && ` · đã loại ${dropped} ý không có trong sách`}
          {g.subtopics > 0 && ` · phủ ${g.subtopics - g.missing.length}/${g.subtopics} mục của sách`}
        </p>
        <button onClick={reanalyze} disabled={!!busy} className="text-[13px] text-slate-400 hover:text-slate-700 disabled:opacity-40 dark:hover:text-slate-200">
          Soạn lại
        </button>
      </div>
      {g.missing.length > 0 && (
        <div className="mt-3 border-t border-black/[0.06] pt-3 dark:border-white/[0.08]">
          <p className="mb-2 flex items-center gap-2 text-slate-600 dark:text-slate-300">
            <BookOpenCheck className="size-4 shrink-0 text-amber-500" /> Bài giảng chưa nói tới các mục sau của sách:
          </p>
          <ul className="mb-3 flex flex-wrap gap-1.5">
            {g.missing.map((m) => (
              <li key={`${m.from}-${m.title}`}>
                <button
                  onClick={() => onPage(m.from, m.to)}
                  className="rounded-full bg-slate-100 px-2.5 py-1 text-[12px] text-slate-700 hover:bg-slate-200 dark:bg-white/10 dark:text-slate-200"
                  title="Mở mục này trong PDF"
                >
                  {m.title} · tr. {m.from === m.to ? m.from : `${m.from}–${m.to}`}
                </button>
              </li>
            ))}
          </ul>
          <Button size="sm" variant="secondary" loading={busy === "supplement"} onClick={supplement}>
            <Sparkles /> Bổ sung các mục này (1 lượt AI)
          </Button>
        </div>
      )}
    </div>
  );
}
