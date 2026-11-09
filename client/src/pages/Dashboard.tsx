import { Link } from "react-router-dom";
import { ChevronRight, FileText, Inbox, ListChecks } from "lucide-react";
import { useDocuments, useOverview, useQuizHistory } from "../api/queries";
import { Page } from "../components/Layout";
import { Badge, Empty, ProgressBar, Skeleton } from "../components/ui";
import { UploadZone } from "../features/documents/UploadZone";
import { stepLabel } from "../hooks/useDocumentProgress";
import { useAuth } from "../stores/auth";
import type { DocumentItem } from "../types";

export const STATUS: Record<DocumentItem["status"], { label: string; color: "slate" | "brand" | "green" | "red" }> = {
  queued: { label: "Đang chờ", color: "slate" },
  processing: { label: "Đang phân tích", color: "brand" },
  done: { label: "Sẵn sàng", color: "green" },
  failed: { label: "Lỗi", color: "red" },
};

const fmtDate = (s: string) => new Date(s).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });

export function Dashboard() {
  const user = useAuth((s) => s.user);
  const docs = useDocuments();
  const overview = useOverview();
  const history = useQuizHistory();

  const stats = [
    { label: "Tài liệu", value: overview.data?.documents },
    { label: "Bài kiểm tra", value: overview.data?.attempts },
    { label: "Điểm trung bình", value: overview.data?.avgScore != null ? overview.data.avgScore.toFixed(1) : "—" },
    { label: "Thẻ cần ôn", value: overview.data?.dueCards, to: "/app/flashcards" },
  ];

  return (
    <Page title={`Chào ${user?.full_name?.split(" ").at(-1) ?? "bạn"}.`}>
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
                  <Link to={`/app/documents/${d.id}`} className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-slate-50 dark:hover:bg-white/5">
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
