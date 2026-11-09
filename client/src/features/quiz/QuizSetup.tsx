import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { errorMessage, http } from "../../api/client";
import { Button, cn, DIFFICULTY_LABEL, Modal, TYPE_LABEL } from "../../components/ui";
import { toast } from "../../stores/toast";
import type { Difficulty, DocumentDetail, QuestionType, QuizMode, QuizSession } from "../../types";

const MODES: { value: QuizMode; label: string; desc: string }[] = [
  { value: "chapter", label: "Theo chương", desc: "Chọn 1 hoặc vài chương" },
  { value: "mixed", label: "Trộn cả sách", desc: "Câu ngẫu nhiên mọi chương" },
  { value: "weak", label: "Ôn điểm yếu", desc: "Chủ đề bạn hay làm sai" },
  { value: "exam", label: "Thi thử", desc: "Bấm giờ 1 phút/câu" },
];

export const saveQuizSession = (s: QuizSession) => sessionStorage.setItem(`quiz:${s.attempt.id}`, JSON.stringify(s));

export function QuizSetup({ doc, open, onClose, initialChapterId }: { doc: DocumentDetail; open: boolean; onClose: () => void; initialChapterId?: number }) {
  const navigate = useNavigate();
  const [mode, setMode] = useState<QuizMode>(initialChapterId ? "chapter" : "mixed");
  const [chapterIds, setChapterIds] = useState<number[]>(initialChapterId ? [initialChapterId] : []);
  const [count, setCount] = useState(10);
  const [difficulty, setDifficulty] = useState<Difficulty | "">("");
  const [types, setTypes] = useState<QuestionType[]>(["mcq", "true_false", "short_answer"]);
  const [loading, setLoading] = useState(false);

  const start = async () => {
    setLoading(true);
    try {
      const { data } = await http.post<QuizSession>("/quizzes", {
        documentId: doc.id,
        mode,
        chapterIds: mode === "chapter" || mode === "exam" ? chapterIds : undefined,
        count,
        difficulty: difficulty || undefined,
        types,
      });
      saveQuizSession(data);
      navigate(`/app/quiz/${data.attempt.id}`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  return (
    <Modal open={open} onClose={onClose} title="Tạo bài ôn tập" wide>
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {MODES.map((m) => (
            <button
              key={m.value}
              onClick={() => setMode(m.value)}
              className={cn(
                "rounded-xl border p-3 text-left transition",
                mode === m.value ? "border-brand-500 bg-brand-50 dark:bg-brand-500/10" : "border-slate-200 hover:border-slate-300 dark:border-slate-700",
              )}
            >
              <p className="text-sm font-semibold">{m.label}</p>
              <p className="text-xs text-slate-500">{m.desc}</p>
            </button>
          ))}
        </div>

        {(mode === "chapter" || mode === "exam") && (
          <div>
            <p className="label">Chương {mode === "exam" && <span className="font-normal text-slate-400">(bỏ trống = cả sách)</span>}</p>
            <div className="flex max-h-40 flex-wrap gap-2 overflow-y-auto">
              {doc.chapters
                .filter((c) => c.status === "done")
                .map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setChapterIds(toggle(chapterIds, c.id))}
                    className={cn(
                      "rounded-full border px-3 py-1 text-sm",
                      chapterIds.includes(c.id) ? "border-brand-500 bg-brand-600 text-white" : "border-slate-300 dark:border-slate-700",
                    )}
                  >
                    {c.title}
                  </button>
                ))}
            </div>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="label">Số câu</label>
            <input className="input" type="number" min={1} max={50} value={count} onChange={(e) => setCount(Number(e.target.value))} />
          </div>
          <div>
            <label className="label">Độ khó (thang Bloom)</label>
            <select className="input" value={difficulty} onChange={(e) => setDifficulty(e.target.value as Difficulty | "")}>
              <option value="">Trộn</option>
              {Object.entries(DIFFICULTY_LABEL).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <div>
            <p className="label">Loại câu</p>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(TYPE_LABEL) as QuestionType[]).map((t) => (
                <label key={t} className="flex items-center gap-1 text-sm">
                  <input type="checkbox" checked={types.includes(t)} onChange={() => setTypes(toggle(types, t))} />
                  {TYPE_LABEL[t]}
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Hủy
          </Button>
          <Button onClick={start} loading={loading} disabled={!types.length || (mode === "chapter" && !chapterIds.length)}>
            Bắt đầu làm bài
          </Button>
        </div>
      </div>
    </Modal>
  );
}
