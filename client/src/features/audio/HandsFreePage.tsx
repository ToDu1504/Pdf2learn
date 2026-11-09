import { useEffect, useRef, useState } from "react";
import { http, errorMessage } from "../../api/client";
import { useDocuments, useTtsStatus } from "../../api/queries";
import { Page } from "../../components/Layout";
import { Button, cn, Empty } from "../../components/ui";
import { toast } from "../../stores/toast";
import type { ChapterDetail, DocumentDetail, Flashcard } from "../../types";
import { questionSpeech } from "../chapters/QuestionsView";
import { fetchSpeech, playAndWait, usePlayer } from "./playerStore";
import { TtsOfflineHint } from "./SpeakButton";
import { ArrowRight, BookOpen, Headphones, Pause, Play, X } from "lucide-react";

type Item = { prompt: string; promptSpeech: string; answer: string; answerSpeech: string };
type Phase = "idle" | "question" | "countdown" | "answer" | "done";

async function loadItems(documentId: number, source: "quiz" | "flashcard"): Promise<Item[]> {
  if (source === "flashcard") {
    const cards = (await http.get<Flashcard[]>(`/flashcards/due?documentId=${documentId}&limit=30`)).data;
    return cards.map((c) => ({ prompt: c.front, promptSpeech: `${c.front}. Bạn có nhớ không?`, answer: c.back, answerSpeech: c.back }));
  }
  const doc = (await http.get<DocumentDetail>(`/documents/${documentId}`)).data;
  const chapters = await Promise.all(doc.chapters.filter((c) => c.status === "done").map((c) => http.get<ChapterDetail>(`/chapters/${c.id}`).then((r) => r.data)));
  const questions = chapters
    .flatMap((c) => c.questions)
    .filter((q) => q.type !== "short_answer")
    .sort(() => Math.random() - 0.5)
    .slice(0, 20);
  return questions.map((q) => ({
    prompt: q.content,
    promptSpeech: questionSpeech(q),
    answer: `${q.correct_answer}\n${q.explanation}`,
    answerSpeech: `Đáp án đúng là: ${q.correct_answer}. ${q.explanation}`,
  }));
}

/** Ôn tập rảnh tay: đọc câu hỏi → đếm ngược → đọc đáp án + giải thích → câu tiếp. */
export function HandsFreePage() {
  const docs = useDocuments();
  const tts = useTtsStatus();
  const [documentId, setDocumentId] = useState<number | null>(null);
  const [source, setSource] = useState<"quiz" | "flashcard">("quiz");
  const [wait, setWait] = useState(7);
  const [items, setItems] = useState<Item[]>([]);
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>("idle");
  const [count, setCount] = useState(0);
  const run = useRef(0); // tăng mỗi lần dừng/bắt đầu để hủy vòng lặp cũ
  const paused = useRef(false);
  const [isPaused, setPaused] = useState(false);

  const ready = docs.data?.filter((d) => d.status === "done") ?? [];
  useEffect(() => {
    if (!documentId && ready.length) setDocumentId(ready[0].id);
  }, [ready, documentId]);

  useEffect(
    () => () => {
      run.current++;
      usePlayer.getState().stop();
    },
    [],
  );

  const sleepWhile = async (ms: number, token: number, tick?: (left: number) => void) => {
    const end = Date.now() + ms;
    while (Date.now() < end || paused.current) {
      if (run.current !== token) return false;
      if (paused.current) {
        await new Promise((r) => setTimeout(r, 200));
        continue;
      }
      tick?.(Math.ceil((end - Date.now()) / 1000));
      await new Promise((r) => setTimeout(r, 200));
    }
    return run.current === token;
  };

  const start = async (from = 0, list = items) => {
    const token = ++run.current;
    paused.current = false;
    setPaused(false);
    for (let i = from; i < list.length; i++) {
      if (run.current !== token) return;
      setIndex(i);
      setPhase("question");
      try {
        const [q, a] = await Promise.all([fetchSpeech(list[i].promptSpeech), fetchSpeech(list[i].answerSpeech)]);
        if (run.current !== token) return;
        await playAndWait(q, `Câu ${i + 1}/${list.length}`);
        if (run.current !== token) return;
        setPhase("countdown");
        if (!(await sleepWhile(wait * 1000, token, setCount))) return;
        setPhase("answer");
        await playAndWait(a, `Đáp án câu ${i + 1}`);
        if (!(await sleepWhile(1200, token))) return;
      } catch (err) {
        toast.error(errorMessage(err));
        setPhase("idle");
        return;
      }
    }
    if (run.current === token) setPhase("done");
  };

  const begin = async () => {
    if (!documentId) return;
    try {
      const list = await loadItems(documentId, source);
      if (!list.length) return toast.info(source === "flashcard" ? "Không có thẻ cần ôn" : "Tài liệu chưa có câu hỏi");
      setItems(list);
      void start(0, list);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const stop = () => {
    run.current++;
    usePlayer.getState().stop();
    setPhase("idle");
  };

  const togglePause = () => {
    paused.current = !paused.current;
    setPaused(paused.current);
    const p = usePlayer.getState();
    if (paused.current) p.pause();
    else if (phase !== "countdown") p.play();
  };

  // Phím: Space tạm dừng, → bỏ qua câu, Esc dừng. Tai nghe dùng Media Session qua playerStore.
  useEffect(() => {
    if (phase === "idle" || phase === "done") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        e.preventDefault();
        togglePause();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        usePlayer.getState().stop();
        void start(index + 1);
      } else if (e.key === "Escape") stop();
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  });

  const item = items[index];
  const active = phase !== "idle" && phase !== "done";

  if (active && item)
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-slate-950 text-white">
        <div className="flex items-center justify-between p-4 text-sm text-slate-400">
          <span>
            Câu {index + 1}/{items.length}
          </span>
          <button onClick={stop} className="rounded-lg px-3 py-1 hover:bg-white/10">
            <X className="size-4" /> Thoát (Esc)
          </button>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center gap-8 px-6 text-center">
          <p className="max-w-4xl text-2xl leading-relaxed font-semibold sm:text-4xl">{item.prompt}</p>
          {phase === "countdown" && <div className="text-7xl font-bold text-brand-500 tabular-nums">{isPaused ? <Pause className="size-16" strokeWidth={1.5} /> : count}</div>}
          {phase === "answer" && <p className="max-w-3xl text-lg whitespace-pre-line text-emerald-300 sm:text-2xl">{item.answer}</p>}
          {phase === "question" && <p className="animate-pulse text-slate-400">Đang đọc câu hỏi…</p>}
        </div>
        <div className="flex justify-center gap-3 p-8">
          <Button variant="secondary" size="lg" onClick={togglePause}>
            {isPaused ? <><Play /> Tiếp tục</> : <><Pause /> Tạm dừng</>}
          </Button>
          <Button
            size="lg"
            onClick={() => {
              usePlayer.getState().stop();
              void start(index + 1);
            }}
          >
            Bỏ qua <ArrowRight />
          </Button>
        </div>
      </div>
    );

  return (
    <Page title="Ôn tập rảnh tay">
      <div className="card mx-auto max-w-xl space-y-5 p-6">
        <p className="text-sm text-slate-600 dark:text-slate-400">
          App đọc câu hỏi, chờ bạn nghĩ vài giây, rồi đọc đáp án và giải thích. Hợp khi đi đường, nấu ăn, tập thể dục.
        </p>
        {!tts.data?.online ? (
          <TtsOfflineHint />
        ) : !ready.length ? (
          <Empty icon={<BookOpen />} title="Chưa có tài liệu sẵn sàng" />
        ) : (
          <>
            {phase === "done" && <p className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300">Đã xong {items.length} câu!</p>}
            <div>
              <label className="label">Tài liệu</label>
              <select className="input" value={documentId ?? ""} onChange={(e) => setDocumentId(Number(e.target.value))}>
                {ready.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.title}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <p className="label">Nguồn</p>
              <div className="grid grid-cols-2 gap-2">
                {(["quiz", "flashcard"] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setSource(s)}
                    className={cn("rounded-xl border p-3 text-sm font-medium", source === s ? "border-brand-500 bg-brand-50 dark:bg-brand-500/10" : "border-slate-200 dark:border-slate-700")}
                  >
                    {s === "quiz" ? "Câu hỏi trắc nghiệm" : "Flashcard cần ôn"}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="label">Thời gian suy nghĩ: {wait} giây</label>
              <input type="range" min={3} max={15} value={wait} onChange={(e) => setWait(Number(e.target.value))} className="w-full accent-brand-600" />
            </div>
            <Button size="lg" className="w-full" onClick={begin}>
              <Headphones /> Bắt đầu
            </Button>
            <p className="text-center text-xs text-slate-400">Space: tạm dừng · →: bỏ qua · Esc: thoát</p>
          </>
        )}
      </div>
    </Page>
  );
}
