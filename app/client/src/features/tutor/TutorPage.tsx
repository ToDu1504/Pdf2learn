import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { errorMessage, http, postStream } from "../../api/client";
import { useDocument, useTutorSession, useTutorSessions } from "../../api/queries";
import { Button, cn, Empty, Spinner } from "../../components/ui";
import { toast } from "../../stores/toast";
import type { TutorMessage, TutorQuiz, TutorSession } from "../../types";
import { ChevronLeft, MessageCircle, Sparkles, Wrench, X } from "lucide-react";

type StreamEvent =
  | { type: "text"; delta: string }
  | { type: "tool"; name: string; args: unknown }
  | { type: "quiz"; chapterTitle: string; questions: TutorQuiz["questions"] }
  | { type: "done"; messageId: number }
  | { type: "error"; message: string };

type ChatItem = { id: string; role: "user" | "model"; content: string; quizzes: TutorQuiz[]; tools: string[]; streaming?: boolean };

const TOOL_LABEL: Record<string, string> = {
  list_chapters: "Xem danh sách chương",
  get_chapter_summary: "Đọc tóm tắt chương",
  read_chapter: "Đọc nội dung chương",
  get_weak_topics: "Xem chủ đề bạn hay sai",
  create_quiz: "Tạo bài ôn nhanh",
};

const SUGGESTIONS = ["Tóm tắt giúp mình chương 1", "Giải thích khái niệm quan trọng nhất bằng ví dụ", "Mình hay sai chủ đề nào?", "Cho mình 3 câu hỏi ôn nhanh"];

const fromServer = (m: TutorMessage): ChatItem => ({
  id: String(m.id),
  role: m.role === "user" ? "user" : "model",
  content: m.content,
  quizzes: (m.tool_calls ?? []).flatMap((t) => (t.quiz ? [t.quiz] : [])),
  tools: [],
});

function QuizCard({ quiz }: { quiz: TutorQuiz }) {
  const [picked, setPicked] = useState<Record<number, string>>({});
  const correct = quiz.questions.filter((q) => picked[q.id] === q.correct_answer).length;
  const done = Object.keys(picked).length === quiz.questions.length;
  return (
    <div className="mt-3 rounded-xl border border-brand-200 bg-white p-4 dark:border-brand-500/30 dark:bg-slate-900">
      <p className="mb-3 text-[14px] font-semibold">Ôn nhanh: {quiz.chapterTitle}</p>
      <ol className="space-y-4">
        {quiz.questions.map((q, i) => {
          const answer = picked[q.id];
          return (
            <li key={q.id}>
              <p className="mb-2 text-sm font-medium">
                {i + 1}. {q.content}
              </p>
              <div className="grid gap-1.5">
                {q.options?.map((o) => (
                  <button
                    key={o}
                    disabled={!!answer}
                    onClick={() => setPicked({ ...picked, [q.id]: o })}
                    className={cn(
                      "rounded-lg border px-3 py-1.5 text-left text-sm transition",
                      !answer && "border-slate-200 hover:border-brand-400 dark:border-slate-700",
                      answer && o === q.correct_answer && "border-emerald-500 bg-emerald-50 dark:bg-emerald-500/10",
                      answer === o && o !== q.correct_answer && "border-rose-500 bg-rose-50 dark:bg-rose-500/10",
                      answer && o !== q.correct_answer && answer !== o && "border-slate-200 opacity-60 dark:border-slate-700",
                    )}
                  >
                    {o}
                  </button>
                ))}
              </div>
              {answer && (
                <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">
                  {answer === q.correct_answer ? "Chính xác. " : "Chưa đúng. "}
                  {q.explanation} (tr. {q.source_page})
                </p>
              )}
            </li>
          );
        })}
      </ol>
      {done && (
        <p className="mt-3 text-sm font-semibold">
          Kết quả: {correct}/{quiz.questions.length} câu đúng
        </p>
      )}
    </div>
  );
}

function Bubble({ item }: { item: ChatItem }) {
  if (item.role === "user")
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-[20px] bg-brand-600 px-4 py-2.5 whitespace-pre-wrap text-white">{item.content}</div>
      </div>
    );
  return (
    <div className="flex gap-3">
      <div className="grid size-8 shrink-0 place-items-center rounded-full bg-slate-900 text-white dark:bg-white dark:text-slate-900"><Sparkles className="size-4" /></div>
      <div className="min-w-0 max-w-[90%] flex-1">
        {item.tools.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1">
            {item.tools.map((t, i) => (
              <span key={i} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                <Wrench className="mb-0.5 inline size-3" /> {TOOL_LABEL[t] ?? t}
              </span>
            ))}
          </div>
        )}
        <div className="rounded-2xl rounded-tl-md bg-white px-4 py-2.5 shadow-sm dark:bg-slate-900">
          {item.content ? (
            <div className="prose-study">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{item.content}</ReactMarkdown>
            </div>
          ) : (
            <span className="flex items-center gap-2 text-sm text-slate-500">
              <Spinner className="size-4" /> Gia sư đang suy nghĩ…
            </span>
          )}
          {item.streaming && item.content && <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-brand-500 align-middle" />}
          {!item.streaming && item.content && (
            <div className="mt-1 flex justify-end">
            </div>
          )}
        </div>
        {item.quizzes.map((q, i) => (
          <QuizCard key={i} quiz={q} />
        ))}
      </div>
    </div>
  );
}

export function TutorPage() {
  const documentId = Number(useParams().id);
  const qc = useQueryClient();
  const doc = useDocument(documentId);
  const sessions = useTutorSessions(documentId);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const session = useTutorSession(sessionId);
  const [items, setItems] = useState<ChatItem[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!sessionId && sessions.data?.length) setSessionId(sessions.data[0].id);
  }, [sessions.data, sessionId]);
  useEffect(() => {
    if (session.data && !sending) setItems(session.data.messages.filter((m) => m.role !== "tool").map(fromServer));
  }, [session.data, sending]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [items]);
  useEffect(() => () => abort.current?.abort(), []);

  const newSession = async () => {
    try {
      const { data } = await http.post<TutorSession>("/tutor/sessions", { documentId });
      await qc.invalidateQueries({ queryKey: ["tutor-sessions", documentId] });
      setSessionId(data.id);
      setItems([]);
      return data.id;
    } catch (err) {
      toast.error(errorMessage(err));
      return null;
    }
  };

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || sending) return;
    const sid = sessionId ?? (await newSession());
    if (!sid) return;
    setInput("");
    setSending(true);
    const modelId = `m${Date.now()}`;
    setItems((xs) => [...xs, { id: `u${Date.now()}`, role: "user", content, quizzes: [], tools: [] }, { id: modelId, role: "model", content: "", quizzes: [], tools: [], streaming: true }]);
    const patch = (fn: (m: ChatItem) => ChatItem) => setItems((xs) => xs.map((x) => (x.id === modelId ? fn(x) : x)));

    abort.current = new AbortController();
    try {
      await postStream<StreamEvent>(
        `/tutor/sessions/${sid}/messages`,
        { content },
        (e) => {
          if (e.type === "text") {
            patch((m) => ({ ...m, content: m.content + e.delta }));
          } else if (e.type === "tool") patch((m) => ({ ...m, tools: [...m.tools, e.name] }));
          else if (e.type === "quiz") patch((m) => ({ ...m, quizzes: [...m.quizzes, { chapterTitle: e.chapterTitle, questions: e.questions }] }));
          else if (e.type === "error") {
            toast.error(e.message);
            patch((m) => ({ ...m, content: m.content || "Gia sư gặp lỗi, bạn thử lại nhé." }));
          }
        },
        abort.current.signal,
      );
    } catch (err) {
      if (!abort.current.signal.aborted) {
        toast.error(errorMessage(err));
        patch((m) => ({ ...m, content: m.content || "Không gửi được tin nhắn." }));
      }
    } finally {
      patch((m) => ({ ...m, streaming: false }));
      setSending(false);
      void qc.invalidateQueries({ queryKey: ["tutor-sessions", documentId] });
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void send(input);
  };

  return (
    <div className="flex h-[calc(100vh-57px)] lg:h-screen">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-slate-200 bg-white p-3 md:flex dark:border-slate-800 dark:bg-slate-900">
        <Link to={`/app/documents/${documentId}`} className="mb-3 truncate px-2 text-sm text-slate-500 hover:text-brand-600">
          <ChevronLeft className="mb-0.5 inline size-4" /> {doc.data?.title ?? "Tài liệu"}
        </Link>
        <Button onClick={newSession} variant="secondary" className="mb-3">
          + Cuộc trò chuyện mới
        </Button>
        <ul className="flex-1 space-y-1 overflow-y-auto">
          {sessions.data?.map((s) => (
            <li key={s.id} className="group flex items-center">
              <button
                onClick={() => setSessionId(s.id)}
                className={cn("flex-1 truncate rounded-lg px-2 py-2 text-left text-sm", s.id === sessionId ? "bg-brand-50 font-medium text-brand-700 dark:bg-brand-500/15 dark:text-brand-100" : "hover:bg-slate-100 dark:hover:bg-slate-800")}
              >
                {s.title}
              </button>
              <button
                className="hidden px-1 text-slate-400 group-hover:block hover:text-rose-600"
                aria-label="Xóa"
                onClick={async () => {
                  await http.delete(`/tutor/sessions/${s.id}`);
                  if (s.id === sessionId) {
                    setSessionId(null);
                    setItems([]);
                  }
                  void qc.invalidateQueries({ queryKey: ["tutor-sessions", documentId] });
                }}
              >
                <X className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-white/70 px-4 py-2.5 backdrop-blur dark:border-slate-800 dark:bg-slate-900/70">
          <div className="min-w-0">
            <p className="font-semibold">Gia sư AI</p>
            <p className="truncate text-xs text-slate-500">Trả lời dựa trên “{doc.data?.title}”, có trích dẫn trang</p>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" className="md:hidden" onClick={newSession}>
              + Mới
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-6">
          <div className="mx-auto max-w-3xl space-y-5">
            {!items.length ? (
              <Empty icon={<MessageCircle />} title="Hỏi gia sư bất cứ điều gì về giáo trình">
                <div className="mt-3 flex flex-wrap justify-center gap-2">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} onClick={() => send(s)} className="rounded-full border border-slate-300 px-3 py-1.5 text-sm hover:border-brand-400 hover:text-brand-600 dark:border-slate-700">
                      {s}
                    </button>
                  ))}
                </div>
              </Empty>
            ) : (
              items.map((it) => <Bubble key={it.id} item={it} />)
            )}
            <div ref={bottom} />
          </div>
        </div>

        <form onSubmit={submit} className="border-t border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
          <div className="mx-auto flex max-w-3xl items-end gap-2">
            <textarea
              rows={1}
              className="input max-h-40 min-h-11 resize-none py-2.5"
              placeholder="Nhập câu hỏi… (Enter để gửi, Shift+Enter xuống dòng)"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void send(input);
                }
              }}
            />
            {sending ? (
              <Button type="button" variant="secondary" onClick={() => abort.current?.abort()} className="h-11">
                ■ Dừng
              </Button>
            ) : (
              <Button type="submit" className="h-11" disabled={!input.trim()}>
                Gửi
              </Button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
