import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { BookMarked, FlaskConical, ListChecks } from "lucide-react";
import { errorMessage, http } from "../../api/client";
import { Modal } from "../../components/ui";
import { toast } from "../../stores/toast";
import type { BookReview as Review, QuizSession } from "../../types";
import { saveQuizSession } from "../quiz/QuizSetup";

/**
 * Ôn tập theo sách cho 1 chặng: câu hỏi in trong sách (đáp án theo sách), ý/thuật ngữ cần nắm, bài lab.
 * Tất cả lấy nguyên văn từ PDF bằng code (server: services/bookReview.service.ts), không do AI soạn.
 */
export function BookReviewActions({ review, documentId, lessonIds, sectionTitle }: { review: Review; documentId: number; lessonIds: number[]; sectionTitle: string }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const recall = review.essentials.length + review.key_terms.length + review.labs.length;
  if (!review.questions && !recall) return null;

  const startQuiz = async () => {
    setStarting(true);
    try {
      const { data } = await http.post<QuizSession>("/quizzes", {
        documentId,
        mode: "chapter",
        chapterIds: lessonIds,
        origin: "book",
        count: Math.min(50, review.questions),
      });
      saveQuizSession(data);
      navigate(`/app/quiz/${data.attempt.id}`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setStarting(false);
    }
  };

  const chip =
    "inline-flex items-center gap-1.5 rounded-full border border-black/[0.08] bg-white px-3 py-1 text-[12px] font-medium text-slate-700 transition hover:border-black/20 disabled:opacity-50 dark:border-white/10 dark:bg-slate-900 dark:text-slate-200 [&_svg]:size-3.5";
  return (
    <div className="mt-2 flex flex-wrap gap-2 md:justify-center">
      {review.questions > 0 && (
        <button className={chip} onClick={startQuiz} disabled={starting} title="Câu hỏi in trong sách, chấm theo đáp án của sách">
          <ListChecks /> Câu hỏi của sách ({review.questions})
        </button>
      )}
      {recall > 0 && (
        <button className={chip} onClick={() => setOpen(true)}>
          <BookMarked /> Cần nắm trước khi thi
        </button>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title={`Cần nắm: ${sectionTitle}`} wide>
        <div className="space-y-6 text-[15px]">
          <p className="text-[13px] text-slate-500">Trích nguyên văn từ phần ôn tập cuối chương của sách.</p>
          {review.essentials.length > 0 && (
            <section>
              <h3 className="mb-2 text-[13px] font-semibold tracking-wide text-slate-500 uppercase">Exam Essentials</h3>
              <ul className="space-y-2">
                {review.essentials.map((e, i) => (
                  <li key={i} className="flex gap-3">
                    <input type="checkbox" className="mt-1.5 accent-brand-600" aria-label="Đã nắm" />
                    <span className="leading-6">
                      {e.text} <span className="text-[12px] text-slate-400">tr. {e.page}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {review.key_terms.length > 0 && (
            <section>
              <h3 className="mb-2 text-[13px] font-semibold tracking-wide text-slate-500 uppercase">Thuật ngữ cần biết</h3>
              <div className="flex flex-wrap gap-1.5">
                {review.key_terms.map((t) => (
                  <span key={t} className="rounded-full bg-slate-100 px-2.5 py-1 text-[13px] dark:bg-white/10">
                    {t}
                  </span>
                ))}
              </div>
            </section>
          )}
          {review.labs.length > 0 && (
            <section>
              <h3 className="mb-2 text-[13px] font-semibold tracking-wide text-slate-500 uppercase">Bài thực hành (lab)</h3>
              <ul className="space-y-1.5">
                {review.labs.map((l) => (
                  <li key={`${l.from}-${l.title}`} className="flex items-center gap-2">
                    <FlaskConical className="size-4 text-slate-400" /> {l.title}
                    <span className="text-[12px] text-slate-400">
                      tr. {l.from === l.to ? l.from : `${l.from}–${l.to}`}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </Modal>
    </div>
  );
}
