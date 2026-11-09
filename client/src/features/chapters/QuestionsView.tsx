import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { errorMessage, http } from "../../api/client";
import { Badge, Button, cn, DIFFICULTY_LABEL, Empty, TYPE_LABEL } from "../../components/ui";
import { toast } from "../../stores/toast";
import type { ChapterDetail, Difficulty, Question, QuestionType } from "../../types";
import { PageLink, type OpenPages } from "./SummaryView";
import { CircleHelp, Sparkles } from "lucide-react";

function QuestionCard({ q, index, onPage, chapterId }: { q: Question; index: number; onPage: OpenPages; chapterId: number }) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const report = async () => {
    if (!confirm("Xóa câu hỏi này vì sai/không phù hợp?")) return;
    try {
      await http.delete(`/chapters/${chapterId}/questions/${q.id}`);
      await qc.invalidateQueries({ queryKey: ["chapter", chapterId] });
      toast.success("Đã xóa câu hỏi");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  return (
    <li className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-slate-400">#{index + 1}</span>
        <Badge color="brand">{TYPE_LABEL[q.type]}</Badge>
        <Badge color={q.difficulty === "easy" ? "green" : q.difficulty === "hard" ? "red" : "amber"}>{DIFFICULTY_LABEL[q.difficulty]}</Badge>
        <span className="text-xs text-slate-500">{q.topic}</span>
        <span className="ml-auto flex items-center">
        </span>
      </div>
      <p className="font-medium">{q.content}</p>
      {q.options && q.type === "mcq" && (
        <ol className="mt-2 space-y-1 text-sm">
          {q.options.map((o, i) => (
            <li
              key={i}
              className={cn("rounded-lg px-2 py-1", open && o === q.correct_answer && "bg-emerald-50 font-medium text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300")}
            >
              {"ABCD"[i]}. {o}
            </li>
          ))}
        </ol>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" onClick={() => setOpen(!open)}>
          {open ? "Ẩn đáp án" : "Xem đáp án"}
        </Button>
        <button onClick={report} className="text-xs text-slate-400 hover:text-rose-600">
          Báo câu hỏi sai
        </button>
      </div>
      {open && (
        <div className="mt-3 rounded-xl bg-emerald-50 p-3 text-sm dark:bg-emerald-500/10">
          <p className="flex items-start justify-between gap-2 font-semibold text-emerald-800 dark:text-emerald-300">
            <span>
              Đáp án: {q.correct_answer}
              <PageLink page={q.source_page} onPage={onPage} />
            </span>
          </p>
          <p className="mt-1 text-slate-700 dark:text-slate-300">{q.explanation}</p>
        </div>
      )}
    </li>
  );
}

export function QuestionsView({ chapter, onPage }: { chapter: ChapterDetail; onPage: OpenPages }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<{ type: QuestionType; difficulty: Difficulty; count: number }>({ type: "mcq", difficulty: "medium", count: 5 });
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<Difficulty | "all">("all");

  const generate = async () => {
    setLoading(true);
    try {
      const { data } = await http.post<Question[]>(`/chapters/${chapter.id}/questions/generate`, form);
      await qc.invalidateQueries({ queryKey: ["chapter", chapter.id] });
      toast.success(`Đã sinh thêm ${data.length} câu hỏi`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const list = chapter.questions.filter((q) => filter === "all" || q.difficulty === filter);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2 rounded-xl bg-slate-50 p-3 dark:bg-slate-800/40">
        <div>
          <label className="label text-xs">Loại</label>
          <select className="input h-9 py-1" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as QuestionType })}>
            {Object.entries(TYPE_LABEL).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label text-xs">Độ khó</label>
          <select className="input h-9 py-1" value={form.difficulty} onChange={(e) => setForm({ ...form, difficulty: e.target.value as Difficulty })}>
            {Object.entries(DIFFICULTY_LABEL).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label text-xs">Số câu</label>
          <input className="input h-9 w-20 py-1" type="number" min={1} max={15} value={form.count} onChange={(e) => setForm({ ...form, count: Number(e.target.value) })} />
        </div>
        <Button onClick={generate} loading={loading}>
          <Sparkles /> Sinh thêm câu hỏi
        </Button>
      </div>

      <div className="flex items-center gap-2 text-sm">
        <span className="text-slate-500">Lọc:</span>
        {(["all", "easy", "medium", "hard"] as const).map((d) => (
          <button
            key={d}
            onClick={() => setFilter(d)}
            className={cn("rounded-full px-3 py-1", filter === d ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900" : "bg-slate-100 dark:bg-slate-800")}
          >
            {d === "all" ? `Tất cả (${chapter.questions.length})` : DIFFICULTY_LABEL[d]}
          </button>
        ))}
      </div>

      {!list.length ? (
        <Empty icon={<CircleHelp />} title="Chưa có câu hỏi" />
      ) : (
        <ol className="space-y-3">
          {list.map((q, i) => (
            <QuestionCard key={q.id} q={q} index={i} onPage={onPage} chapterId={chapter.id} />
          ))}
        </ol>
      )}
    </div>
  );
}
