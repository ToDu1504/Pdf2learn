import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { errorMessage, http } from "../../api/client";
import { Page } from "../../components/Layout";
import { Badge, Button, cn, DIFFICULTY_LABEL, Empty, ProgressBar, TYPE_LABEL } from "../../components/ui";
import { toast } from "../../stores/toast";
import { ask, useConfirm } from "../../stores/confirm";
import type { QuizResult, QuizSession } from "../../types";
import { ChevronLeft, ChevronRight, Clock, ListChecks } from "lucide-react";

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export function QuizPlayPage() {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const session = useMemo<QuizSession | null>(() => {
    try {
      return JSON.parse(sessionStorage.getItem(`quiz:${id}`) ?? "null") as QuizSession | null;
    } catch {
      return null;
    }
  }, [id]);
  const draftKey = `quiz-draft:${id}`;
  const [answers, setAnswers] = useState<Record<number, string>>(() => {
    try {
      return JSON.parse(sessionStorage.getItem(draftKey) ?? "{}") as Record<number, string>;
    } catch {
      return {};
    }
  });
  const [i, setI] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const deadline = useRef(session?.time_limit_sec ? Date.now() + session.time_limit_sec * 1000 : null);
  const [left, setLeft] = useState(session?.time_limit_sec ?? 0);

  useEffect(() => {
    sessionStorage.setItem(draftKey, JSON.stringify(answers));
  }, [answers, draftKey]);

  const submit = useCallback(
    async (auto = false) => {
      if (!session || submitting) return;
      if (auto) useConfirm.getState().close(false); // hết giờ khi đang hỏi xác nhận → đóng hộp thoại
      const unanswered = session.questions.filter((q) => !answers[q.id]?.trim()).length;
      if (!auto && unanswered && !(await ask({ title: "Nộp bài?", message: `Còn ${unanswered} câu chưa trả lời.`, confirmLabel: "Nộp bài", cancelLabel: "Làm tiếp" }))) return;
      setSubmitting(true);
      try {
        const { data } = await http.post<QuizResult>(`/quizzes/${id}/submit`, {
          answers: Object.entries(answers).map(([questionId, answer]) => ({ questionId: Number(questionId), answer })),
        });
        qc.setQueryData(["quiz-result", id], data);
        void qc.invalidateQueries({ queryKey: ["quiz-history"] });
        void qc.invalidateQueries({ queryKey: ["stats"] });
        sessionStorage.removeItem(`quiz:${id}`);
        sessionStorage.removeItem(draftKey);
        navigate(`/app/quiz/${id}/result`, { replace: true });
      } catch (err) {
        toast.error(errorMessage(err));
        setSubmitting(false);
      }
    },
    [answers, draftKey, id, navigate, qc, session, submitting],
  );

  // Đồng hồ chế độ thi: hết giờ tự nộp.
  useEffect(() => {
    if (!deadline.current) return;
    const t = setInterval(() => {
      const s = Math.max(0, Math.round((deadline.current! - Date.now()) / 1000));
      setLeft(s);
      if (s === 0) {
        clearInterval(t);
        toast.info("Hết giờ! Đang nộp bài…");
        void submit(true);
      }
    }, 500);
    return () => clearInterval(t);
  }, [submit]);

  const q = session?.questions[i];

  // Phím tắt: 1–4 chọn đáp án, ←/→ chuyển câu, Enter sang câu tiếp.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!session || !q || (e.target as HTMLElement).tagName === "TEXTAREA") return;
      const n = Number(e.key);
      if (q.options && n >= 1 && n <= q.options.length) setAnswers((a) => ({ ...a, [q.id]: q.options![n - 1] }));
      else if (e.key === "ArrowRight" || e.key === "Enter") {
        e.preventDefault();
        setI((x) => Math.min(session.questions.length - 1, x + 1));
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        setI((x) => Math.max(0, x - 1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [q, session]);

  if (!session || !q)
    return (
      <Page>
        <Empty icon={<ListChecks />} title="Không tìm thấy bài làm">
          Bài đã nộp hoặc phiên đã hết. <Link to={`/app/quiz/${id}/result`} className="text-brand-600">Xem kết quả</Link>
        </Empty>
      </Page>
    );

  const total = session.questions.length;
  const answered = session.questions.filter((x) => answers[x.id]?.trim()).length;

  return (
    <Page>
      <div className="mx-auto max-w-3xl">
        <div className="mb-4 flex items-center justify-between gap-4">
          <div className="flex-1">
            <div className="mb-1 flex justify-between text-sm text-slate-500">
              <span>
                Câu {i + 1}/{total}
              </span>
              <span>Đã trả lời {answered}/{total}</span>
            </div>
            <ProgressBar value={((i + 1) / total) * 100} />
          </div>
          {deadline.current && (
            <div className={cn("rounded-xl px-3 py-2 font-mono text-lg font-bold", left < 60 ? "bg-rose-100 text-rose-700 dark:bg-rose-500/15" : "bg-slate-100 dark:bg-slate-800")}>
              <Clock className="mb-0.5 inline size-4" /> {fmt(left)}
            </div>
          )}
        </div>

        <div className="card p-6">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Badge color="brand">{TYPE_LABEL[q.type]}</Badge>
            <Badge>{DIFFICULTY_LABEL[q.difficulty]}</Badge>
            <span className="ml-auto">
            </span>
          </div>
          <h2 className="mb-5 text-lg leading-7 font-semibold">{q.content}</h2>

          {q.type === "short_answer" ? (
            <textarea
              className="input min-h-36"
              placeholder="Nhập câu trả lời của bạn (AI sẽ chấm theo rubric)…"
              value={answers[q.id] ?? ""}
              onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
            />
          ) : (
            <div className="space-y-2">
              {q.options?.map((o, k) => {
                const selected = answers[q.id] === o;
                return (
                  <button
                    key={k}
                    onClick={() => setAnswers({ ...answers, [q.id]: o })}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left text-[15px] transition-colors",
                      selected ? "border-brand-600 bg-brand-50 ring-1 ring-brand-600 dark:bg-brand-500/10" : "border-black/10 hover:border-black/20 dark:border-white/10 dark:hover:border-white/20",
                    )}
                  >
                    <span className={cn("grid size-7 shrink-0 place-items-center rounded-lg text-sm font-bold", selected ? "bg-brand-600 text-white" : "bg-slate-100 dark:bg-slate-800")}>
                      {q.type === "mcq" ? "ABCD"[k] : k + 1}
                    </span>
                    {o}
                  </button>
                );
              })}
              <p className="pt-1 text-xs text-slate-400">Phím tắt: 1–{q.options?.length} chọn đáp án · ←/→ chuyển câu</p>
            </div>
          )}
        </div>

        <div className="mt-4 flex flex-wrap gap-1.5">
          {session.questions.map((x, k) => (
            <button
              key={x.id}
              onClick={() => setI(k)}
              className={cn(
                "size-8 rounded-lg text-xs font-semibold transition",
                k === i ? "bg-brand-600 text-white" : answers[x.id]?.trim() ? "bg-brand-100 text-brand-700 dark:bg-brand-500/20 dark:text-brand-100" : "bg-slate-100 dark:bg-slate-800",
              )}
            >
              {k + 1}
            </button>
          ))}
        </div>

        <div className="mt-6 flex justify-between gap-2">
          <Button variant="secondary" onClick={() => setI(Math.max(0, i - 1))} disabled={i === 0}>
            <ChevronLeft /> Câu trước
          </Button>
          {i < total - 1 ? (
            <Button onClick={() => setI(i + 1)}>Câu sau <ChevronRight /></Button>
          ) : (
            <Button onClick={() => submit()} loading={submitting}>
              Nộp bài
            </Button>
          )}
        </div>
        {i < total - 1 && (
          <div className="mt-3 text-right">
            <button className="text-sm text-slate-500 hover:text-brand-600" onClick={() => submit()} disabled={submitting}>
              Nộp bài ngay
            </button>
          </div>
        )}
        {submitting && <p className="mt-3 text-center text-sm text-slate-500">Đang chấm bài{session.questions.some((x) => x.type === "short_answer") ? " (AI đang chấm câu tự luận)…" : "…"}</p>}
      </div>
    </Page>
  );
}
