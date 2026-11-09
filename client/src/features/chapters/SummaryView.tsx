import { useEffect, useRef, useState } from "react";
import { download, errorMessage, http } from "../../api/client";
import { useTtsStatus } from "../../api/queries";
import { Button, cn } from "../../components/ui";
import { toast } from "../../stores/toast";
import type { AudioSegment, ChapterDetail } from "../../types";
import { targetId, type SummaryTarget } from "./matchNode";
import { usePlayer } from "../audio/playerStore";
import { SpeakButton, TtsOfflineHint } from "../audio/SpeakButton";
import { Download, Play, RotateCcw } from "lucide-react";

/** Mở trang (hoặc khoảng trang) trong PDF gốc. */
export type OpenPages = (from: number, to?: number) => void;

export function PageLink({ page, end, onPage }: { page: number; end?: number; onPage: OpenPages }) {
  return (
    <button
      onClick={() => onPage(page, end)}
      className="ml-1 inline-flex items-center rounded-md bg-brand-50 px-1.5 text-xs font-semibold text-brand-700 hover:bg-brand-100 dark:bg-brand-500/15 dark:text-brand-100"
      title="Mở trang trong PDF gốc"
    >
      tr. {page}
    </button>
  );
}

/** Bản đọc của chương: highlight câu đang đọc, bấm câu để tua tới. */
function Transcript() {
  const { segments, index, seek } = usePlayer();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => {
    refs.current[index]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [index]);
  return (
    <div className="max-h-72 space-y-1 overflow-y-auto rounded-xl bg-slate-50 p-3 dark:bg-slate-800/40">
      {segments.map((s, i) => (
        <button
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          onClick={() => seek(i)}
          className={cn(
            "block w-full rounded-lg px-2 py-1 text-left text-sm transition",
            i === index
              ? "bg-brand-600 font-medium text-white shadow"
              : i < index
                ? "text-slate-400 hover:bg-white dark:hover:bg-slate-800"
                : "text-slate-700 hover:bg-white dark:text-slate-300 dark:hover:bg-slate-800",
          )}
        >
          {s.text}
        </button>
      ))}
    </div>
  );
}

export type SummaryFocus = { target: SummaryTarget; nonce: number };

export function SummaryView({ chapter, onPage, focus }: { chapter: ChapterDetail; onPage: OpenPages; focus?: SummaryFocus | null }) {
  // Được chọn từ sơ đồ tư duy: cuộn tới và nháy sáng phần lý thuyết tương ứng.
  useEffect(() => {
    if (!focus) return;
    const el = document.getElementById(targetId(focus.target));
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.remove("focus-flash");
    void el.offsetWidth; // khởi động lại animation khi bấm cùng node lần nữa
    el.classList.add("focus-flash");
  }, [focus]);

  const s = chapter.summary!;
  const tts = useTtsStatus();
  const [loading, setLoading] = useState(false);
  const source = usePlayer((p) => p.source);
  const listening = source?.kind === "chapter" && source.chapterId === chapter.id;

  const listen = async () => {
    setLoading(true);
    try {
      const { data } = await http.post<AudioSegment[]>(`/chapters/${chapter.id}/audio`, {});
      usePlayer.getState().load(data, { title: chapter.title, source: { kind: "chapter", chapterId: chapter.id } });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        {tts.data?.online ? (
          <>
            <Button onClick={listen} loading={loading} variant={listening ? "secondary" : "primary"}>
              {listening ? <><RotateCcw /> Nghe lại từ đầu</> : <><Play fill="currentColor" /> Nghe bài</>}
            </Button>
            <Button
              variant="ghost"
              onClick={() => download(`/chapters/${chapter.id}/audio/download`, "chuong.wav").catch((e) => toast.error(errorMessage(e)))}
            >
              <Download /> Tải audio
            </Button>
          </>
        ) : (
          <TtsOfflineHint />
        )}
      </div>

      {listening && <Transcript />}

      <section id="sum-overview">
        <h3 className="mb-2 flex items-center gap-1 text-sm font-semibold tracking-wide text-slate-500 uppercase">
          Tổng quan <SpeakButton text={s.overview} title="Tổng quan" />
        </h3>
        <p className="leading-7">{s.overview}</p>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold tracking-wide text-slate-500 uppercase">Ý chính</h3>
        <ul className="space-y-2">
          {s.key_points.map((k, i) => (
            <li key={i} id={`sum-point-${i}`} className="flex gap-3 rounded-xl border border-slate-100 p-3 dark:border-slate-800">
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-brand-600 text-xs font-bold text-white">{i + 1}</span>
              <p className="flex-1 leading-6">
                {k.point}
                <PageLink page={k.page} end={k.page_end} onPage={onPage} />
              </p>
              <SpeakButton text={k.point} title="Ý chính" />
            </li>
          ))}
        </ul>
      </section>

      {s.key_terms.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold tracking-wide text-slate-500 uppercase">Khái niệm</h3>
          <dl className="grid gap-3 sm:grid-cols-2">
            {s.key_terms.map((t, i) => (
              <div key={i} id={`sum-term-${i}`} className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/40">
                <dt className="flex items-center justify-between gap-2 font-semibold">
                  <span>
                    {t.term}
                    <PageLink page={t.page} end={t.page_end} onPage={onPage} />
                  </span>
                  <SpeakButton text={`${t.term}: ${t.definition}`} title="Khái niệm" />
                </dt>
                <dd className="mt-1 text-sm text-slate-600 dark:text-slate-400">{t.definition}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </div>
  );
}
