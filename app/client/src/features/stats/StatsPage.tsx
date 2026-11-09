import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { http } from "../../api/client";
import { useDocuments, useOverview } from "../../api/queries";
import { Page } from "../../components/Layout";
import { Empty, Skeleton } from "../../components/ui";
import { Activity, BarChart3, Coins, Target } from "lucide-react";

type WeakTopic = { topic: string; chapter_title: string; total: number; wrong: number; errorRate: number };
type ChapterScore = { chapter_id: number; title: string; total: number; correct: number; rate: number | null };
type Usage = { day: string; feature: string; input_tokens: number; output_tokens: number; calls: number };

const FEATURE_LABEL: Record<string, string> = {
  split: "Tách chương",
  summarize: "Tóm tắt",
  quiz: "Sinh câu hỏi",
  grade: "Chấm tự luận",
  tutor: "Gia sư AI",
  mindmap: "Sơ đồ",
};
const FEATURE_COLOR: Record<string, string> = {
  split: "#a8a399",
  summarize: "#2f7563",
  quiz: "#86c0ad",
  grade: "#c98a2b",
  tutor: "#6aa253",
  mindmap: "#b08968",
};

const get = async <T,>(url: string) => (await http.get<T>(url)).data;
const tooltipStyle = { borderRadius: 12, border: "1px solid #e4e1da", fontSize: 13 };

function Panel({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`card p-5 ${className ?? ""}`}>
      <h2 className="mb-4 font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export function StatsPage() {
  const [params, setParams] = useSearchParams();
  const docs = useDocuments();
  const documentId = Number(params.get("documentId")) || docs.data?.find((d) => d.status === "done")?.id;
  const overview = useOverview();

  const history = useQuery({
    queryKey: ["stats", "history", documentId],
    queryFn: () => get<{ id: number; finished_at: string; score: number }[]>(`/stats/score-history${documentId ? `?documentId=${documentId}` : ""}`),
  });
  const weak = useQuery({ queryKey: ["stats", "weak", documentId], queryFn: () => get<WeakTopic[]>(`/stats/weak-topics?documentId=${documentId}`), enabled: !!documentId });
  const chapters = useQuery({ queryKey: ["stats", "chapters", documentId], queryFn: () => get<ChapterScore[]>(`/stats/chapter-scores?documentId=${documentId}`), enabled: !!documentId });
  const usage = useQuery({ queryKey: ["stats", "usage"], queryFn: () => get<Usage[]>("/stats/ai-usage") });

  const usageByDay = useMemo(() => {
    const map = new Map<string, Record<string, number | string>>();
    for (const u of usage.data ?? []) {
      const row = map.get(u.day) ?? { day: u.day.slice(5) };
      row[u.feature] = ((row[u.feature] as number) ?? 0) + u.input_tokens + u.output_tokens;
      map.set(u.day, row);
    }
    return [...map.values()];
  }, [usage.data]);
  const features = [...new Set((usage.data ?? []).map((u) => u.feature))];
  const totalTokens = (usage.data ?? []).reduce((n, u) => n + u.input_tokens + u.output_tokens, 0);
  const totalCalls = (usage.data ?? []).reduce((n, u) => n + u.calls, 0);

  const historyData = (history.data ?? []).map((h, i) => ({ n: i + 1, score: h.score, date: new Date(h.finished_at).toLocaleDateString("vi-VN") }));
  const chapterData = (chapters.data ?? []).map((c, i) => ({ name: `C${i + 1}`, title: c.title, rate: c.rate == null ? 0 : Math.round(c.rate * 100), total: c.total }));

  return (
    <Page
      title="Thống kê"
      actions={
        <select className="input w-64" value={documentId ?? ""} onChange={(e) => setParams({ documentId: e.target.value })}>
          {docs.data?.map((d) => (
            <option key={d.id} value={d.id}>
              {d.title}
            </option>
          ))}
        </select>
      }
    >
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ["Bài đã làm", overview.data?.attempts ?? 0],
          ["Điểm trung bình", overview.data?.avgScore?.toFixed(1) ?? "—"],
          ["Thẻ cần ôn", overview.data?.dueCards ?? 0],
          ["Token AI (30 ngày)", totalTokens.toLocaleString("vi-VN")],
        ].map(([l, v]) => (
          <div key={l} className="card p-4">
            <p className="text-xs text-slate-500">{l}</p>
            <p className="text-2xl font-bold">{v}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Điểm qua các lần làm">
          {history.isLoading ? (
            <Skeleton className="h-64" />
          ) : !historyData.length ? (
            <Empty icon={<Activity />} title="Chưa có bài làm" />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={historyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e4e1da" strokeOpacity={0.4} />
                <XAxis dataKey="n" tickLine={false} fontSize={12} />
                <YAxis domain={[0, 10]} tickLine={false} fontSize={12} width={28} />
                <Tooltip contentStyle={tooltipStyle} labelFormatter={(n) => `Lần ${n}`} formatter={(v) => [v, "Điểm"]} />
                <Line type="monotone" dataKey="score" stroke="#2f7563" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </Panel>

        <Panel title="Tỉ lệ đúng theo chương">
          {chapters.isLoading ? (
            <Skeleton className="h-64" />
          ) : !chapterData.some((c) => c.total) ? (
            <Empty icon={<BarChart3 />} title="Chưa có dữ liệu" />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={chapterData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e4e1da" strokeOpacity={0.4} vertical={false} />
                <XAxis dataKey="name" tickLine={false} fontSize={12} />
                <YAxis domain={[0, 100]} unit="%" tickLine={false} fontSize={12} width={40} />
                <Tooltip contentStyle={tooltipStyle} labelFormatter={(_, p) => p?.[0]?.payload?.title} formatter={(v, _n, p) => [`${v}% (${p.payload.total} câu)`, "Đúng"]} />
                <Bar dataKey="rate" fill="#86c0ad" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Panel>

        <Panel title="Chủ đề yếu">
          {!weak.data?.length ? (
            <Empty icon={<Target />} title="Chưa phát hiện chủ đề yếu" />
          ) : (
            <ul className="space-y-3">
              {weak.data.map((w) => (
                <li key={w.topic + w.chapter_title}>
                  <div className="mb-1 flex justify-between gap-3 text-sm">
                    <span>
                      <span className="font-medium">{w.topic}</span> <span className="text-slate-500">· {w.chapter_title}</span>
                    </span>
                    <span className="shrink-0 text-rose-600">
                      sai {w.wrong}/{w.total}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800">
                    <div className="h-full rounded-full bg-rose-500" style={{ width: `${w.errorRate * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title={`Token AI theo ngày · ${totalCalls} lượt gọi`}>
          {!usageByDay.length ? (
            <Empty icon={<Coins />} title="Chưa dùng AI trong 30 ngày qua" />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={usageByDay}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e4e1da" strokeOpacity={0.4} vertical={false} />
                <XAxis dataKey="day" tickLine={false} fontSize={12} />
                <YAxis tickLine={false} fontSize={12} width={50} tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [Number(v).toLocaleString("vi-VN"), FEATURE_LABEL[String(n)] ?? n]} />
                <Legend formatter={(v: string) => FEATURE_LABEL[v] ?? v} wrapperStyle={{ fontSize: 12 }} />
                {features.map((f) => (
                  <Bar key={f} dataKey={f} stackId="a" fill={FEATURE_COLOR[f] ?? "#64748b"} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          )}
        </Panel>
      </div>
    </Page>
  );
}
