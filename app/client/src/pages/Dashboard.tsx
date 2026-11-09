import { Link, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, BookOpen, ChevronRight, FileText, Inbox, Layers, ListChecks, Trash2 } from "lucide-react";
import { useDocuments, useOverview, useQuizHistory } from "../api/queries";
import { Page } from "../components/Layout";
import { Badge, Button, Empty, IconButton, ProgressBar, Skeleton } from "../components/ui";
import { errorMessage, http } from "../api/client";
import { toast } from "../stores/toast";
import { ask } from "../stores/confirm";
import { UploadZone } from "../features/documents/UploadZone";
import { stepLabel } from "../hooks/useDocumentProgress";
import type { DocumentItem } from "../types";

export const STATUS: Record<DocumentItem["status"], { label: string; color: "slate" | "brand" | "green" | "red" }> = {
  queued: { label: "Đang chờ", color: "slate" },
  processing: { label: "Đang phân tích", color: "brand" },
  done: { label: "Sẵn sàng", color: "green" },
  failed: { label: "Lỗi", color: "red" },
};

const fmtDate = (s: string) => new Date(s).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });

/** "Hôm nay": học tiếp bài kế tiếp + ôn thẻ đến hạn — vòng học chính của app. */
function Today() {
  const navigate = useNavigate();
  const { data, isLoading } = useOverview();
  if (isLoading) return <Skeleton className="mb-10 h-28" />;
  const next = data?.nextLesson;
  const due = data?.dueCards ?? 0;
  if (!next && !due) return null;
  return (
    <section className="mb-10 grid gap-3 md:grid-cols-2">
      {next && (
        <div className="card flex flex-col gap-3 p-5">
          <p className="eyebrow flex items-center gap-2">
            <BookOpen className="size-4" strokeWidth={1.75} /> Học tiếp
          </p>
          <div className="min-w-0">
            <p className="truncate text-[17px] font-semibold">{next.title}</p>
            <p className="truncate text-[13px] text-slate-500">
              {next.documentTitle} · bài {next.done + 1}/{next.total}
              {next.estMinutes ? ` · khoảng ${next.estMinutes} phút` : ""}
            </p>
            <ProgressBar value={(next.done / Math.max(1, next.total)) * 100} className="mt-2 h-1 max-w-xs" />
          </div>
          <Button className="self-start" onClick={() => navigate(`/app/documents/${next.documentId}?chapter=${next.chapterId}`)}>
            Học bài này <ArrowRight />
          </Button>
        </div>
      )}
      <div className="card flex flex-col gap-3 p-5">
        <p className="eyebrow flex items-center gap-2">
          <Layers className="size-4" strokeWidth={1.75} /> Ôn tập
        </p>
        <div>
          <p className="text-[17px] font-semibold">{due ? `${due} thẻ đến hạn ôn` : "Không có thẻ nào cần ôn"}</p>
          <p className="text-[13px] text-slate-500">
            {due ? "Ôn đúng lúc sắp quên giúp nhớ lâu hơn (lặp lại ngắt quãng)." : "Học xong một bài, các khái niệm của bài sẽ vào lịch ôn."}
          </p>
        </div>
        {due > 0 && (
          <Button variant="secondary" className="self-start" onClick={() => navigate("/app/flashcards")}>
            Ôn ngay <ArrowRight />
          </Button>
        )}
      </div>
    </section>
  );
}

export function Dashboard() {
  const docs = useDocuments();
  const qc = useQueryClient();
  const removeDoc = async (d: DocumentItem) => {
    if (!(await ask({ title: `Xóa "${d.title}"?`, message: "Toàn bộ bài học, câu hỏi và flashcard của tài liệu này sẽ bị xóa. Không thể hoàn tác.", confirmLabel: "Xóa", danger: true }))) return;
    try {
      await http.delete(`/documents/${d.id}`);
      await Promise.all([qc.invalidateQueries({ queryKey: ["documents"] }), qc.invalidateQueries({ queryKey: ["stats", "overview"] })]);
      toast.info("Đã xóa tài liệu");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  const overview = useOverview();
  const history = useQuizHistory();

  const stats = [
    { label: "Tài liệu", value: overview.data?.documents },
    { label: "Bài kiểm tra", value: overview.data?.attempts },
    { label: "Điểm trung bình", value: overview.data?.avgScore != null ? overview.data.avgScore.toFixed(1) : "—" },
    { label: "Thẻ cần ôn", value: overview.data?.dueCards, to: "/app/flashcards" },
  ];

  return (
    <Page title="Chào bạn.">
      <Today />
      <div className="mb-10 grid grid-cols-2 overflow-hidden rounded-2xl border border-black/[0.06] bg-white lg:grid-cols-4 dark:border-white/[0.08] dark:bg-slate-900">
        {stats.map((s, i) => {
          const body = (
            <div className={`h-full px-5 py-4 ${i > 0 ? "border-l border-black/[0.06] dark:border-white/[0.08]" : ""} ${i === 2 ? "max-lg:border-l-0 max-lg:border-t" : ""} ${i === 3 ? "max-lg:border-t" : ""}`}>
              <p className="text-[13px] text-slate-500">{s.label}</p>
              {overview.isLoading ? <Skeleton className="mt-1 h-8 w-12" /> : <p className="mt-0.5 text-[28px] font-semibold tracking-tight">{s.value ?? 0}</p>}
            </div>
          );
          return s.to ? (
            <Link key={s.label} to={s.to} className="transition-colors hover:bg-slate-50 dark:hover:bg-white/5">
              {body}
            </Link>
          ) : (
            <div key={s.label}>{body}</div>
          );
        })}
      </div>

      <div className="grid gap-10 lg:grid-cols-3 [&>*]:min-w-0">
        <div className="space-y-4 lg:col-span-2">
          <UploadZone />
          <h2 className="pt-4 text-[22px] font-semibold">Tài liệu</h2>
          {docs.isLoading ? (
            <Skeleton className="h-48" />
          ) : !docs.data?.length ? (
            <div className="card">
              <Empty icon={<Inbox />} title="Chưa có tài liệu">
                Tải giáo trình PDF lên, AI sẽ lập lộ trình học cho bạn.
              </Empty>
            </div>
          ) : (
            <ul className="card divide-y divide-black/[0.06] overflow-hidden dark:divide-white/[0.08]">
              {docs.data.map((d) => (
                <li key={d.id}>
                  <Link to={`/app/documents/${d.id}`} className="group flex items-center gap-4 px-5 py-4 transition-colors hover:bg-slate-50 dark:hover:bg-white/5">
                    <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-500 dark:bg-white/10">
                      <FileText className="size-5" strokeWidth={1.5} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px] font-semibold">{d.title}</p>
                      <p className="text-[13px] text-slate-500">
                        {d.chapter_count ? `${d.completed_count ?? 0}/${d.chapter_count} bài · ` : ""}
                        {d.page_count ? `${d.page_count} trang · ` : ""}
                        {fmtDate(d.created_at)}
                      </p>
                      {d.status === "done" && !!d.chapter_count && <ProgressBar value={((d.completed_count ?? 0) / d.chapter_count) * 100} className="mt-2 h-1 max-w-xs" />}
                      {(d.status === "processing" || d.status === "queued") && (
                        <div className="mt-2 max-w-xs">
                          <ProgressBar value={d.progress} className="h-1" />
                          <p className="mt-1 text-[12px] text-slate-500">{stepLabel(d.current_step)}</p>
                        </div>
                      )}
                    </div>
                    {d.status !== "done" && <Badge color={STATUS[d.status].color}>{STATUS[d.status].label}</Badge>}
                    <IconButton
                      label="Xóa tài liệu"
                      className="hover:text-rose-500 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
                      onClick={(e) => {
                        e.preventDefault();
                        void removeDoc(d);
                      }}
                    >
                      <Trash2 />
                    </IconButton>
                    <ChevronRight className="size-4 text-slate-300" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-4">
          <h2 className="text-[22px] font-semibold">Kiểm tra gần đây</h2>
          <div className="card divide-y divide-black/[0.06] overflow-hidden dark:divide-white/[0.08]">
            {history.isLoading ? (
              <Skeleton className="m-4 h-24" />
            ) : !history.data?.length ? (
              <Empty icon={<ListChecks />} title="Chưa có bài kiểm tra">
                Mở một tài liệu và chọn “Kiểm tra”.
              </Empty>
            ) : (
              history.data.slice(0, 8).map((a) => (
                <Link key={a.id} to={`/app/quiz/${a.id}/result`} className="flex items-center justify-between px-5 py-3 transition-colors hover:bg-slate-50 dark:hover:bg-white/5">
                  <div>
                    <p className="text-[15px]">
                      {a.correct_count}/{a.total_questions} câu đúng
                    </p>
                    <p className="text-[12px] text-slate-500">{a.finished_at && fmtDate(a.finished_at)}</p>
                  </div>
                  <span className={`text-[17px] font-semibold tabular-nums ${(a.score ?? 0) >= 5 ? "text-slate-900 dark:text-white" : "text-rose-500"}`}>{a.score?.toFixed(1)}</span>
                </Link>
              ))
            )}
          </div>
        </div>
      </div>
    </Page>
  );
}
