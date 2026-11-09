import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { errorMessage, http } from "../../api/client";
import { ArrowRight } from "lucide-react";
import { Badge, Button, cn } from "../../components/ui";
import { toast } from "../../stores/toast";
import type { ChapterDetail } from "../../types";

export const PASS_RATE = 0.7;

/**
 * Kiểm tra nhanh cuối bài: làm đúng ≥ 70% thì bài học được đánh dấu hoàn thành.
 * Chấm ngay trên trình duyệt (đáp án đã có trong dữ liệu bài học), không tốn lượt AI.
 */
export function QuickCheck({ lesson, documentId, onNext }: { lesson: ChapterDetail; documentId: number; onNext?: () => void }) {
  const qc = useQueryClient();
  const questions = lesson.questions.filter((q) => q.type !== "short_answer").slice(0, 5);
  const [picked, setPicked] = useState<Record<number, string>>({});
  const [checked, setChecked] = useState(false);
  const [saving, setSaving] = useState(false);
  const completed = !!lesson.completed_at;

  const setCompleted = async (value: boolean) => {
    setSaving(true);
    try {
      await http.post(`/chapters/${lesson.id}/complete`, { completed: value });
      await Promise.all([qc.invalidateQueries({ queryKey: ["chapter", lesson.id] }), qc.invalidateQueries({ queryKey: ["document", documentId] })]);
      void qc.invalidateQueries({ queryKey: ["documents"] });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const correct = questions.filter((q) => picked[q.id] === q.correct_answer).length;
  const passed = questions.length > 0 && correct / questions.length >= PASS_RATE;

  const check = async () => {
    setChecked(true);
    if (passed && !completed) {
      await setCompleted(true);
      toast.success("Đã hoàn thành bài học");
    }
  };

  return (
    <section className="quick-check mt-12 rounded-2xl bg-slate-50 p-6 dark:bg-white/[0.04]">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-[22px] font-semibold">Kiểm tra nhanh</h3>
          <p className="text-[14px] text-slate-500">Đúng từ {Math.round(PASS_RATE * 100)}% để hoàn thành bài học.</p>
        </div>
        {completed && <Badge color="green">Đã hoàn thành</Badge>}
      </div>

      {!questions.length ? (
        <p className="text-sm text-slate-500">Bài này chưa có câu hỏi kiểm tra.</p>
      ) : (
        <ol className="space-y-5">
          {questions.map((q, i) => {
            const answer = picked[q.id];
            return (
              <li key={q.id}>
                <p className="mb-2.5 text-[15px] font-medium">
                  {i + 1}. {q.content}
                </p>
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {q.options?.map((o) => {
                    const isPicked = answer === o;
                    const isRight = o === q.correct_answer;
                    return (
                      <button
                        key={o}
                        disabled={checked}
                        onClick={() => setPicked({ ...picked, [q.id]: o })}
                        className={cn(
                          "rounded-xl border px-3.5 py-2.5 text-left text-[14px] transition-colors",
                          !checked && (isPicked ? "border-brand-600 bg-white ring-1 ring-brand-600 dark:bg-slate-900" : "border-black/[0.08] bg-white hover:border-black/20 dark:border-white/10 dark:bg-slate-900"),
                          checked && isRight && "border-emerald-500 bg-emerald-50 dark:bg-emerald-500/10",
                          checked && isPicked && !isRight && "border-rose-500 bg-rose-50 dark:bg-rose-500/10",
                          checked && !isPicked && !isRight && "border-transparent bg-white opacity-60 dark:bg-slate-900",
                        )}
                      >
                        {o}
                      </button>
                    );
                  })}
                </div>
                {checked && (
                  <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                    <span className={answer === q.correct_answer ? "font-medium text-emerald-600" : "font-medium text-rose-500"}>{answer === q.correct_answer ? "Chính xác. " : "Chưa đúng. "}</span>
                    {q.explanation}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {questions.length > 0 && !checked && (
          <Button onClick={check} disabled={Object.keys(picked).length < questions.length} loading={saving}>
            Chấm điểm
          </Button>
        )}
        {checked && (
          <>
            <span className={cn("text-[15px] font-semibold", passed ? "text-emerald-600" : "text-rose-500")}>
              {correct}/{questions.length} câu đúng {passed ? "· Đạt" : "· Chưa đạt, hãy xem lại bài"}
            </span>
            <Button
              variant="secondary"
              onClick={() => {
                setPicked({});
                setChecked(false);
              }}
            >
              Làm lại
            </Button>
          </>
        )}
        {(passed || completed) && onNext && (
          <Button onClick={onNext}>
            Bài tiếp theo <ArrowRight />
          </Button>
        )}
        <button className="ml-auto text-[13px] text-slate-500 hover:text-slate-900 dark:hover:text-white" onClick={() => setCompleted(!completed)} disabled={saving}>
          {completed ? "Bỏ đánh dấu hoàn thành" : "Đánh dấu đã học (bỏ qua kiểm tra)"}
        </button>
      </div>
    </section>
  );
}
