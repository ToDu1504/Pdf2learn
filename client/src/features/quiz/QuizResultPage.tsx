import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { errorMessage, http } from "../../api/client";
import { useQuizResult } from "../../api/queries";
import { Page } from "../../components/Layout";
import { Badge, Button, cn, Empty, Skeleton } from "../../components/ui";
import { toast } from "../../stores/toast";
import type { QuizSession } from "../../types";
import { SpeakButton } from "../audio/SpeakButton";
import { saveQuizSession } from "./QuizSetup";
import { RotateCcw, Search } from "lucide-react";

export function QuizResultPage() {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const { data, isLoading, error } = useQuizResult(id);
  const [filter, setFilter] = useState<"all" | "wrong">("all");
  const [loading, setLoading] = useState(false);

  if (isLoading) return <Page><Skeleton className="h-96" /></Page>;
  if (error || !data) return <Page><Empty icon={<Search />} title="Không tìm thấy kết quả" /></Page>;

  const wrong = data.answers.filter((a) => a.is_correct === false);
  const score = data.score ?? 0;
  const list = filter === "wrong" ? wrong : data.answers;

  const retryWrong = async () => {
    setLoading(true);
    try {
      const { data: s } = await http.post<QuizSession>("/quizzes", { documentId: data.document_id, mode: "weak", count: Math.max(5, wrong.length) });
      saveQuizSession(s);
      navigate(`/app/quiz/${s.attempt.id}`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Page>
      <div className="mx-auto max-w-3xl space-y-5">
        <div className="card flex flex-col items-center gap-2 p-8 text-center">
          <p className="eyebrow">{score >= 8 ? "Xuất sắc" : score >= 5 ? "Đạt" : "Cần ôn thêm"}</p>
          <p className={cn("text-5xl font-bold", score >= 5 ? "text-emerald-600" : "text-rose-600")}>{score.toFixed(1)}</p>
          <p className="text-slate-500">
            Đúng {data.correct_count}/{data.total_questions} câu
          </p>
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            {wrong.length > 0 && (
              <Button onClick={retryWrong} loading={loading}>
                <RotateCcw /> Ôn lại câu sai
              </Button>
            )}
            <Button variant="secondary" onClick={() => navigate(`/app/documents/${data.document_id}`)}>
              Về tài liệu
            </Button>
          </div>
        </div>

        <div className="flex gap-2">
          <Button size="sm" variant={filter === "all" ? "primary" : "secondary"} onClick={() => setFilter("all")}>
            Tất cả ({data.answers.length})
          </Button>
          <Button size="sm" variant={filter === "wrong" ? "primary" : "secondary"} onClick={() => setFilter("wrong")}>
            Câu sai ({wrong.length})
          </Button>
        </div>

        <ol className="space-y-3">
          {list.map((a) => {
            const q = a.question;
            const n = data.answers.indexOf(a) + 1;
            return (
              <li key={a.id} className={cn("card border-l-4 p-5", a.is_correct ? "border-l-emerald-500" : a.is_correct === false ? "border-l-rose-500" : "border-l-amber-400")}>
                <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-semibold">Câu {n}</span>
                  {a.is_correct ? <Badge color="green">Đúng</Badge> : a.is_correct === false ? <Badge color="red">Sai</Badge> : <Badge color="amber">Chưa chấm</Badge>}
                  {a.ai_score != null && <Badge color="brand">AI chấm: {a.ai_score}/10</Badge>}
                  <Link to={`/app/documents/${data.document_id}?chapter=${q.chapter.id}`} className="text-xs text-slate-500 hover:text-brand-600">
                    {q.chapter.title} · tr. {q.source_page}
                  </Link>
                </div>
                <p className="font-medium">{q.content}</p>
                <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                  <div className={cn("rounded-xl p-3", a.is_correct ? "bg-emerald-50 dark:bg-emerald-500/10" : "bg-rose-50 dark:bg-rose-500/10")}>
                    <p className="text-xs text-slate-500">Bạn trả lời</p>
                    <p className="font-medium whitespace-pre-wrap">{a.user_answer ?? "(bỏ trống)"}</p>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/50">
                    <p className="text-xs text-slate-500">{q.type === "short_answer" ? "Đáp án tham khảo" : "Đáp án đúng"}</p>
                    <p className="font-medium whitespace-pre-wrap">{q.correct_answer}</p>
                  </div>
                </div>
                {a.ai_feedback && <p className="mt-3 rounded-xl bg-slate-50 p-3 text-[14px] whitespace-pre-wrap dark:bg-white/5"><span className="font-medium">Nhận xét của AI: </span>{a.ai_feedback}</p>}
                <div className="mt-3 flex items-start gap-2 text-sm text-slate-600 dark:text-slate-400">
                  <p className="flex-1">{q.explanation}</p>
                  <SpeakButton text={`Đáp án đúng: ${q.correct_answer}. ${q.explanation}`} title={`Giải thích câu ${n}`} />
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </Page>
  );
}
