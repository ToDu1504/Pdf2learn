import { useEffect } from "react";
import { useSettings } from "../../api/queries";
import { cn, Spinner } from "../../components/ui";
import { usePlayer } from "./playerStore";
import { Pause, Play, SkipBack, SkipForward, X } from "lucide-react";

export const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2];

const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));

/** Trình phát nổi ở layout gốc: vẫn phát khi chuyển trang. */
export function MiniPlayer() {
  const p = usePlayer();
  const { data: settings } = useSettings();

  // Tốc độ mặc định theo cài đặt người dùng.
  useEffect(() => {
    if (settings) usePlayer.getState().setRate(settings.tts_rate);
  }, [settings]);

  // Phím tắt: Space play/pause, ←/→ câu trước/sau (bỏ qua khi đang gõ hoặc trang tự xử lý).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = usePlayer.getState();
      if (!s.segments.length || isTyping(e.target) || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.code === "Space") {
        e.preventDefault();
        s.toggle();
      } else if (e.key === "ArrowRight") s.next();
      else if (e.key === "ArrowLeft") s.prev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!p.segments.length) return null;
  const current = p.segments[Math.min(p.index, p.segments.length - 1)];
  const progress = (Math.min(p.index + (p.playing ? 0.5 : 0), p.segments.length) / p.segments.length) * 100;

  return (
    <div className="fixed right-3 bottom-3 left-3 z-40 sm:left-auto sm:w-[420px]">
      <div className="overflow-hidden rounded-2xl border border-black/[0.06] bg-white/85 shadow-2xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-800/85">
        <div className="h-0.5 bg-black/[0.06] dark:bg-white/10">
          <div className="h-full bg-brand-600 transition-all" style={{ width: `${progress}%` }} />
        </div>
        <div className="flex items-center gap-3 p-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12px] font-medium text-slate-500">{p.title}</p>
            <p className="truncate text-sm text-slate-600 dark:text-slate-300" title={current?.text}>
              {p.buffering ? "Đang tạo giọng đọc…" : current?.text}
            </p>
            <p className="text-[11px] text-slate-400">
              Câu {Math.min(p.index + 1, p.segments.length)}/{p.segments.length}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <IconBtn label="Câu trước (←)" onClick={p.prev}><SkipBack className="size-4" fill="currentColor" /></IconBtn>
            <button
              onClick={p.toggle}
              aria-label={p.playing ? "Tạm dừng" : "Phát"}
              className="grid size-10 place-items-center rounded-full bg-slate-900 text-white hover:bg-slate-700 dark:bg-white dark:text-slate-900"
            >
              {p.buffering && p.playing ? <Spinner className="size-4 text-white" /> : p.playing ? <Pause className="size-4" fill="currentColor" /> : <Play className="ml-0.5 size-4" fill="currentColor" />}
            </button>
            <IconBtn label="Câu sau (→)" onClick={p.next}><SkipForward className="size-4" fill="currentColor" /></IconBtn>
            <select
              aria-label="Tốc độ"
              value={p.rate}
              onChange={(e) => p.setRate(Number(e.target.value))}
              className="rounded-lg bg-transparent px-1 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              {RATES.map((r) => (
                <option key={r} value={r}>
                  {r}x
                </option>
              ))}
            </select>
            <IconBtn label="Đóng" onClick={p.stop}><X className="size-4" /></IconBtn>
          </div>
        </div>
      </div>
    </div>
  );
}

function IconBtn({ label, onClick, children, className }: { label: string; onClick: () => void; children: React.ReactNode; className?: string }) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn("grid size-8 place-items-center rounded-lg text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800", className)}
    >
      {children}
    </button>
  );
}
