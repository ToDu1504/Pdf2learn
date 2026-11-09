import { useState } from "react";
import { errorMessage } from "../../api/client";
import { useTtsStatus } from "../../api/queries";
import { cn, Spinner } from "../../components/ui";
import { toast } from "../../stores/toast";
import { speakText } from "./playerStore";
import { Volume2, VolumeX } from "lucide-react";

/** Nút 🔊 đọc nhanh 1 đoạn. Tự ẩn khi TTS server chưa bật. */
export function SpeakButton({ text, title, className }: { text: string; title?: string; className?: string }) {
  const { data } = useTtsStatus();
  const [loading, setLoading] = useState(false);
  if (!data?.online) return null;
  return (
    <button
      type="button"
      title="Nghe"
      aria-label="Nghe đoạn này"
      className={cn("inline-grid size-7 shrink-0 place-items-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-white/10 dark:hover:text-white", className)}
      onClick={async (e) => {
        e.stopPropagation();
        setLoading(true);
        try {
          await speakText(text, title);
        } catch (err) {
          toast.error(errorMessage(err));
        } finally {
          setLoading(false);
        }
      }}
    >
      {loading ? <Spinner className="size-3.5" /> : <Volume2 className="size-4" strokeWidth={1.75} />}
    </button>
  );
}

export function TtsOfflineHint() {
  const { data } = useTtsStatus();
  if (!data || data.online) return null;
  return (
    <p className="text-xs text-slate-500">
      <VolumeX className="mb-0.5 inline size-3.5" /> Bật TTS server (<code>npm run tts</code>) để dùng tính năng đọc.
    </p>
  );
}
