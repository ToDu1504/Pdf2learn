import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { BarChart3, Check, ChevronLeft, ChevronRight, CircleAlert, Clock, Download, Ellipsis, FileText, Layers, ListChecks, Map, MessageCircle, Pencil, RotateCw, Search, Trash2 } from "lucide-react";
import { download, errorMessage, http } from "../api/client";
import { useChapter, useDocument } from "../api/queries";
import { Page } from "../components/Layout";
import { Badge, Button, cn, EditableTitle, Empty, ProgressBar, Skeleton, Spinner, Tabs } from "../components/ui";
import { SummaryView, type SummaryFocus } from "../features/chapters/SummaryView";
import { QuestionsView } from "../features/chapters/QuestionsView";
import { Mindmap } from "../features/chapters/Mindmap";
import { ChapterEditor } from "../features/documents/ChapterEditor";
import { QuizSetup } from "../features/quiz/QuizSetup";
import { RoadmapView, StateIcon, groupLessons, lessonState } from "../features/roadmap/RoadmapView";
import { LessonBody } from "../features/roadmap/LessonBody";
import { QuickCheck } from "../features/roadmap/QuickCheck";
import { GroundingPanel } from "../features/roadmap/GroundingPanel";
import { stepLabel, useDocumentProgress } from "../hooks/useDocumentProgress";
import { toast } from "../stores/toast";
import { ask } from "../stores/confirm";
import type { PageRange } from "../features/documents/PdfViewer";
import { STATUS } from "./Dashboard";

// react-pdf khá nặng: chỉ tải khi mở khung PDF.
const PdfViewer = lazy(() => import("../features/documents/PdfViewer").then((m) => ({ default: m.PdfViewer })));
const MAX_RANGE = 6; // khớp với PdfViewer / server

type Tab = "lesson" | "summary" | "mindmap" | "questions";

export function DocumentPage() {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const { data: doc, isLoading, error } = useDocument(id);
  const busy = doc?.status === "queued" || doc?.status === "processing";
  const live = useDocumentProgress(id, !!busy);

  // Không có ?chapter → xem roadmap; có → xem bài học.
  const lessonId = Number(params.get("chapter")) || null;
  const chapter = useChapter(lessonId);

  const [tab, setTab] = useState<Tab>("lesson");
  const [focus, setFocus] = useState<SummaryFocus | null>(null);
  const [pdfRange, setPdfRange] = useState<PageRange | null>(null);
  const [pdfExpanded, setPdfExpanded] = useState(false);
  // Mở trang / khoảng trang trong PDF gốc (khoảng tối đa MAX_RANGE trang).
  const setPdfPage = (from: number, to = from, quote?: string) => setPdfRange({ from, to: Math.min(Math.max(to, from), from + MAX_RANGE - 1), quote });
  const [editing, setEditing] = useState(false);
  const [quizOpen, setQuizOpen] = useState(false);
  const top = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setFocus(null);
    setPdfRange(null);
    setPdfExpanded(false);
    top.current?.scrollIntoView({ block: "start" });
  }, [lessonId]);

  // Bài giảng theo yêu cầu: mở bài chưa có nội dung → AI soạn (kèm vài bài kế tiếp trong 1 lượt).
  const requested = useRef(new Set<number>());
  const analyze = async (cid: number) => {
    requested.current.add(cid);
    try {
      await http.post(`/chapters/${cid}/analyze`);
    } catch (err) {
      toast.error(errorMessage(err));
    }
    await qc.invalidateQueries({ queryKey: ["chapter", cid] });
    await qc.invalidateQueries({ queryKey: ["document", id] });
  };
  const ch = chapter.data;
  useEffect(() => {
    if (!ch || doc?.status !== "done" || ch.summary || ch.analyzing || ch.analyze_error || requested.current.has(ch.id)) return;
    void analyze(ch.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ch?.id, ch?.summary, ch?.analyzing, ch?.analyze_error, doc?.status]);
  // Bài vừa soạn xong → làm mới roadmap (các bài prefetch cùng lô cũng đổi trạng thái).
  const hadSummary = useRef<boolean | null>(null);
  useEffect(() => {
    if (hadSummary.current === false && ch?.summary) void qc.invalidateQueries({ queryKey: ["document", id] });
    hadSummary.current = ch ? !!ch.summary : null;
  }, [ch, id, qc]);
  // Bài cũ (trước khi có bài giảng) chỉ có tóm tắt → mở tab Tóm tắt.
  useEffect(() => {
    setTab(ch?.summary && !ch.summary.lesson_md ? "summary" : "lesson");
  }, [ch?.id, ch?.summary]);

  if (isLoading) return <Page><Skeleton className="h-96" /></Page>;
  if (error || !doc) return <Page><Empty icon={<Search />} title="Không tìm thấy tài liệu"><Link className="text-brand-600" to="/app">Về trang chủ</Link></Empty></Page>;

  const progress = live ?? { status: doc.status, progress: doc.progress, step: doc.current_step, error: doc.error_message };
  const ready = doc.chapters.some((c) => c.status === "done");
  const openLesson = (cid: number) => setParams({ chapter: String(cid) });
  const index = lessonId ? doc.chapters.findIndex((c) => c.id === lessonId) : -1;
  const prev = index > 0 ? doc.chapters[index - 1] : null;
  const next = index >= 0 && index + 1 < doc.chapters.length ? doc.chapters[index + 1] : null;
  const section = index >= 0 ? doc.sections?.find((s) => s.id === doc.chapters[index].section_id) : null;

  const retry = async () => {
    try {
      await http.post(`/documents/${id}/retry`);
      await qc.invalidateQueries({ queryKey: ["document", id] });
      toast.info("Đang xử lý lại…");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  const rebuild = async () => {
    if (!(await ask({ title: "Lập lại lộ trình?", message: "Lộ trình được dựng lại theo mục lục của sách. Bài nào giữ nguyên khoảng trang sẽ giữ bài giảng, flashcard và tiến độ; bài đổi ranh giới sẽ được soạn lại.", confirmLabel: "Lập lại" }))) return;
    try {
      await http.post(`/documents/${id}/roadmap/rebuild`);
      setParams({});
      await qc.invalidateQueries({ queryKey: ["document", id] });
      toast.info("Đang lập lại lộ trình…");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  // Đổi tên tài liệu / chặng / bài học rồi làm mới mọi nơi hiển thị tên đó.
  const rename = async (url: string, title: string) => {
    try {
      await http.patch(url, { title });
    } catch (err) {
      toast.error(errorMessage(err));
      throw err;
    }
    await Promise.all(
      [["document", id], ["documents"], ["stats", "overview"], ["chapter", lessonId]].map((queryKey) => qc.invalidateQueries({ queryKey })),
    );
  };
  const remove = async () => {
    if (!(await ask({ title: `Xóa "${doc.title}"?`, message: "Toàn bộ bài học, câu hỏi và flashcard của tài liệu này sẽ bị xóa. Không thể hoàn tác.", confirmLabel: "Xóa", danger: true }))) return;
    await http.delete(`/documents/${id}`);
    await qc.invalidateQueries({ queryKey: ["documents"] });
    navigate("/app");
  };

  const menuItem = "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left hover:bg-black/[0.05] dark:hover:bg-white/10 [&_svg]:size-4 [&_svg]:text-slate-400";

  return (
    <Page
      wide
      title={
        <span ref={top} className="flex flex-wrap items-center gap-3">
          <EditableTitle value={doc.title} label="Đổi tên tài liệu" onSave={(t) => rename(`/documents/${id}`, t)} />{" "}
          {progress.status !== "done" && <Badge color={STATUS[progress.status].color}>{STATUS[progress.status].label}</Badge>}
        </span>
      }
      actions={
        <>
          <Button variant="secondary" onClick={() => setQuizOpen(true)} disabled={!ready}>
            <ListChecks /> Kiểm tra
          </Button>
          <Button variant="secondary" onClick={() => navigate(`/app/documents/${id}/tutor`)} disabled={doc.status !== "done"}>
            <MessageCircle /> Gia sư AI
          </Button>
          <Button variant="secondary" onClick={() => navigate(`/app/flashcards?documentId=${id}`)} disabled={!ready}>
            <Layers /> Flashcard
          </Button>
          <details className="relative">
            <summary className="grid size-10 cursor-pointer list-none place-items-center rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-white/10 dark:text-slate-300 [&::-webkit-details-marker]:hidden" aria-label="Thêm">
              <Ellipsis className="size-4" />
            </summary>
            <div className="absolute right-0 z-20 mt-2 w-64 rounded-2xl border border-black/[0.06] bg-white/90 p-1.5 text-[14px] shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-800/90">
              <button className={menuItem} onClick={rebuild} disabled={busy}>
                <Map /> Lập lại lộ trình
              </button>
              <button className={menuItem} onClick={() => setEditing(true)} disabled={busy}>
                <Pencil /> Sửa khoảng trang bài học
              </button>
              <button className={menuItem} onClick={() => download(`/flashcards/export?documentId=${id}`, "flashcards.csv").catch((e) => toast.error(errorMessage(e)))}>
                <Download /> Xuất flashcard (Anki CSV)
              </button>
              <button className={menuItem} onClick={() => navigate(`/app/stats?documentId=${id}`)}>
                <BarChart3 /> Thống kê tài liệu
              </button>
              <button className={cn(menuItem, "text-rose-500")} onClick={remove}>
                <Trash2 /> Xóa tài liệu
              </button>
            </div>
          </details>
        </>
      }
    >
      {(busy || progress.status === "failed") && (
        <div className="card mb-5 p-4">
          {busy ? (
            <>
              <div className="mb-2 flex justify-between text-sm">
                <span className="font-medium">{stepLabel(progress.step)}</span>
                <span className="text-slate-500">{progress.progress}%</span>
              </div>
              <ProgressBar value={progress.progress} />
              <p className="mt-2 text-xs text-slate-500">Lộ trình sẽ hiện ngay khi phân tích xong.</p>
            </>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-[14px] text-rose-500">{progress.error ?? "Xử lý thất bại"}</p>
              <Button size="sm" onClick={retry}>
                <RotateCw /> Xử lý lại
              </Button>
            </div>
          )}
        </div>
      )}

      {!doc.chapters.length ? (
        <div className="card">
          <Empty icon={<Map />} title="Đang lập lộ trình học…">AI đang đọc cấu trúc giáo trình để chia thành các chặng và bài học.</Empty>
        </div>
      ) : !lessonId ? (
        <RoadmapView doc={doc} onOpen={openLesson} onRenameSection={(sid, t) => rename(`/documents/${id}/sections/${sid}`, t)} />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="h-fit lg:sticky lg:top-8">
            <button className="mb-1 flex w-full items-center gap-1 rounded-lg px-2 py-2 text-left text-[14px] font-medium text-brand-600 hover:bg-black/[0.04] dark:text-brand-400 dark:hover:bg-white/5" onClick={() => setParams({})}>
              <ChevronLeft className="size-4" /> Lộ trình
            </button>
            <div className="max-h-[40vh] overflow-y-auto lg:max-h-[75vh]">
              {groupLessons(doc).map(({ section: s, lessons }, si) => (
                <div key={s.id} className="mb-2">
                  <p className="eyebrow px-2 pt-3 pb-1 text-[11px]">
                    {si + 1}. {s.title}
                  </p>
                  <ul>
                    {lessons.map((c) => (
                      <li key={c.id}>
                        <button
                          onClick={() => openLesson(c.id)}
                          className={cn(
                            "flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition",
                            c.id === lessonId ? "bg-black/[0.06] font-medium dark:bg-white/10" : "text-slate-600 hover:bg-black/[0.04] dark:text-slate-400 dark:hover:bg-white/5",
                          )}
                        >
                          <span className="mt-0.5 shrink-0">
                            <StateIcon state={lessonState(c)} className="size-4" />
                          </span>
                          <span className="flex-1">{c.title}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </aside>

          <div className={cn("grid min-w-0 gap-5", !!pdfRange && !pdfExpanded && "xl:grid-cols-2")}>
            <section className="card min-w-0 px-6 py-8 sm:px-12 sm:py-12">
              {chapter.isLoading || !chapter.data ? (
                <div className="space-y-3">
                  <Skeleton className="h-8 w-2/3" />
                  <Skeleton className="h-24" />
                  <Skeleton className="h-40" />
                </div>
              ) : (
                <>
                  <div className="mb-10 flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                      {section && (
                        <p className="eyebrow">
                          Chặng {(doc.sections?.indexOf(section) ?? 0) + 1}: {section.title}
                        </p>
                      )}
                      <h2 className="mt-1 text-[32px] leading-tight font-bold">
                        <EditableTitle value={chapter.data.title} label="Đổi tên bài học" onSave={(t) => rename(`/chapters/${chapter.data!.id}`, t)} />
                      </h2>
                      {chapter.data.source_title && chapter.data.source_title !== chapter.data.title && (
                        <p className="mt-1.5 text-[13px] text-slate-400" title="Tên mục trong sách">
                          Theo sách: {chapter.data.source_title}
                        </p>
                      )}
                      {chapter.data.description && <p className="mt-2 text-[17px] text-slate-500">{chapter.data.description}</p>}
                      <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-slate-500">
                        {chapter.data.est_minutes ? (
                          <span className="flex items-center gap-1">
                            <Clock className="size-3.5" /> {chapter.data.est_minutes} phút
                          </span>
                        ) : null}
                        <button className="flex items-center gap-1 text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300" onClick={() => setPdfPage(chapter.data!.start_page, chapter.data!.end_page)}>
                          <FileText className="size-3.5" /> Trang {chapter.data.start_page}–{chapter.data.end_page}
                        </button>
                        {chapter.data.completed_at && (
                          <span className="flex items-center gap-1 font-medium text-emerald-600">
                            <Check className="size-3.5" /> Đã hoàn thành
                          </span>
                        )}
                      </p>
                    </div>
                    {chapter.data.summary && (
                      <Tabs
                        value={tab}
                        onChange={(t) => {
                          setFocus(null);
                          setTab(t);
                        }}
                        items={[
                          ...(chapter.data.summary.lesson_md ? [{ value: "lesson" as const, label: "Bài giảng" }] : []),
                          { value: "summary", label: "Tóm tắt" },
                          { value: "mindmap", label: "Sơ đồ" },
                          { value: "questions", label: `Câu hỏi (${chapter.data.questions.length})` },
                        ]}
                      />
                    )}
                  </div>

                  {chapter.data.summary && <GroundingPanel chapter={chapter.data} onPage={setPdfPage} />}

                  {!chapter.data.summary ? (
                    chapter.data.analyze_error && !chapter.data.analyzing ? (
                      <Empty icon={<CircleAlert />} title="Chưa soạn được bài này">
                        <p className="mb-3">{chapter.data.analyze_error}</p>
                        <Button onClick={() => analyze(chapter.data!.id)}>
                          <RotateCw /> Thử lại
                        </Button>
                      </Empty>
                    ) : (
                      <Empty icon={<Spinner className="size-6" />} title="Đang soạn bài giảng…">
                        Soạn luôn vài bài tiếp theo trong cùng 1 lượt, để bạn học tiếp không phải chờ.
                      </Empty>
                    )
                  ) : tab === "lesson" && chapter.data.summary.lesson_md ? (
                    <>
                      <LessonBody markdown={chapter.data.summary.lesson_md} onPage={setPdfPage} evidence={chapter.data.summary.evidence} />
                      <QuickCheck lesson={chapter.data} documentId={id} onNext={next ? () => openLesson(next.id) : undefined} />
                    </>
                  ) : tab === "summary" || tab === "lesson" ? (
                    <>
                      <SummaryView chapter={chapter.data} onPage={setPdfPage} focus={focus} />
                      {!chapter.data.summary.lesson_md && <QuickCheck lesson={chapter.data} documentId={id} onNext={next ? () => openLesson(next.id) : undefined} />}
                    </>
                  ) : tab === "mindmap" ? (
                    <Mindmap
                      chapterId={chapter.data.id}
                      code={chapter.data.summary.mindmap_mermaid}
                      summary={chapter.data.summary}
                      onSelect={(target) => {
                        // Node sơ đồ → chuyển sang phần lý thuyết tương ứng ở tab Tóm tắt.
                        setFocus({ target, nonce: Date.now() });
                        setTab("summary");
                      }}
                    />
                  ) : (
                    <QuestionsView chapter={chapter.data} onPage={setPdfPage} />
                  )}

                  <nav className="mt-12 flex flex-wrap justify-between gap-2 border-t border-black/[0.06] pt-6 dark:border-white/10">
                    {prev ? (
                      <Button variant="ghost" onClick={() => openLesson(prev.id)} className="max-w-[48%]">
                        <ChevronLeft /> <span className="truncate">{prev.title}</span>
                      </Button>
                    ) : (
                      <span />
                    )}
                    {next ? (
                      <Button variant="secondary" onClick={() => openLesson(next.id)} className="max-w-[48%]">
                        <span className="truncate">{next.title}</span> <ChevronRight />
                      </Button>
                    ) : (
                      <Button variant="secondary" onClick={() => setParams({})}>
                        Về lộ trình
                      </Button>
                    )}
                  </nav>
                </>
              )}
            </section>

            {pdfRange && (
              <section
                className={cn(
                  pdfExpanded
                    ? "fixed inset-0 z-50 bg-black/40 p-3 backdrop-blur-sm sm:p-6"
                    : "fixed inset-0 z-40 bg-slate-50 p-2 xl:sticky xl:top-6 xl:z-auto xl:h-[calc(100vh-3rem)] xl:bg-transparent xl:p-0 dark:bg-slate-950",
                )}
              >
                <div className={cn("h-full", pdfExpanded && "mx-auto max-w-6xl")}>
                  <Suspense fallback={<div className="card grid h-full place-items-center"><Spinner /></div>}>
                    <PdfViewer
                      documentId={id}
                      range={pdfRange}
                      pageCount={doc.page_count}
                      onRangeChange={setPdfRange}
                      onClose={() => {
                        setPdfRange(null);
                        setPdfExpanded(false);
                      }}
                      expanded={pdfExpanded}
                      onToggleExpand={() => setPdfExpanded((v) => !v)}
                    />
                  </Suspense>
                </div>
              </section>
            )}
          </div>
        </div>
      )}

      {editing && <ChapterEditor doc={doc} open onClose={() => setEditing(false)} />}
      {quizOpen && <QuizSetup doc={doc} open onClose={() => setQuizOpen(false)} initialChapterId={lessonId ?? undefined} />}
    </Page>
  );
}
