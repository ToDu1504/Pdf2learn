import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { errorMessage, http } from "../../api/client";
import { useDocuments, useDueCards } from "../../api/queries";
import { Page } from "../../components/Layout";
import { Button, cn, Empty, ProgressBar, Skeleton } from "../../components/ui";
import { toast } from "../../stores/toast";
import { SpeakButton } from "../audio/SpeakButton";
import { CircleCheck } from "lucide-react";

// SM-2: Quên (1) · Khó (3) · Tốt (4) · Dễ (5); phím tắt 1–4.
const GRADES = [
  { quality: 1, label: "Quên", key: "1", className: "text-rose-500" },
  { quality: 3, label: "Khó", key: "2", className: "text-amber-500" },
  { quality: 4, label: "Tốt", key: "3", className: "text-emerald-600" },
  { quality: 5, label: "Dễ", key: "4", className: "text-brand-600" },
];

export function FlashcardsPage() {
  const [params, setParams] = useSearchParams();
  const documentId = Number(params.get("documentId")) || undefined;
  const docs = useDocuments();
  const { data: cards, isLoading } = useDueCards(documentId);
  const qc = useQueryClient();
  const [i, setI] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reviewed, setReviewed] = useState(0);

  useEffect(() => {
    setI(0);
    setReviewed(0);
  }, [documentId]);

  const card = cards?.[i];

  const grade = async (quality: number) => {
    if (!card || busy) return;
    setBusy(true);
    try {
      await http.post(`/flashcards/${card.id}/review`, { quality });
      setReviewed((r) => r + 1);
      setFlipped(false);
      // "Quên" thì đưa thẻ xuống cuối để gặp lại trong phiên.
      if (quality < 3 && cards) qc.setQueryData(["flashcards", "due", documentId ?? "all"], [...cards, card]);
      setI((x) => x + 1);
      void qc.invalidateQueries({ queryKey: ["stats", "overview"] });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === "SELECT") return;
      if (e.code === "Space" || e.key === "Enter") {
        e.preventDefault(); // không để MiniPlayer bắt Space
        setFlipped((f) => !f);
      } else if (flipped) {
        const g = GRADES.find((x) => x.key === e.key);
        if (g) void grade(g.quality);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const remaining = cards ? Math.max(0, cards.length - i) : 0;

  return (
    <Page
      title="Flashcard"
      actions={
        <select className="input w-64" value={documentId ?? ""} onChange={(e) => setParams(e.target.value ? { documentId: e.target.value } : {})}>
          <option value="">Tất cả tài liệu</option>
          {docs.data?.map((d) => (
            <option key={d.id} value={d.id}>
              {d.title}
            </option>
          ))}
        </select>
      }
    >
      <div className="mx-auto max-w-2xl">
        {isLoading ? (
          <Skeleton className="h-80" />
        ) : !card ? (
          <div className="card">
            <Empty icon={<CircleCheck />} title={reviewed ? `Bạn đã ôn ${reviewed} thẻ hôm nay` : "Không có thẻ nào cần ôn"}>
              Thẻ sẽ quay lại đúng lúc bạn sắp quên (thuật toán SM-2).{" "}
              <Link to="/app/hands-free" className="text-brand-600">
                Thử ôn rảnh tay
              </Link>
            </Empty>
          </div>
        ) : (
          <>
            <div className="mb-3 flex items-center justify-between text-sm text-slate-500">
              <span className="truncate">{card.chapter?.title}</span>
              <span>Còn {remaining} thẻ</span>
            </div>
            <ProgressBar value={(reviewed / Math.max(1, reviewed + remaining)) * 100} className="mb-4" />

            <div className="flip h-72 cursor-pointer select-none sm:h-80" onClick={() => setFlipped(!flipped)}>
              <div className={cn("flip-inner relative h-full", flipped && "flipped")}>
                <div className="flip-face card absolute inset-0 flex flex-col items-center justify-center p-8 text-center">
                  <p className="text-xs font-semibold tracking-wide text-slate-400 uppercase">Mặt trước</p>
                  <p className="mt-3 text-2xl font-bold">{card.front}</p>
                  <SpeakButton text={card.front} title="Flashcard" className="mt-4" />
                  <p className="absolute bottom-4 text-xs text-slate-400">Bấm hoặc Space để lật</p>
                </div>
                <div className="flip-face flip-back card absolute inset-0 flex flex-col items-center justify-center overflow-y-auto bg-brand-50 p-8 text-center dark:bg-slate-800">
                  <p className="text-xs font-semibold tracking-wide text-slate-400 uppercase">{card.front}</p>
                  <p className="mt-3 text-lg leading-7">{card.back}</p>
                  <SpeakButton text={card.back} title="Flashcard" className="mt-4" />
                </div>
              </div>
            </div>

            <div className={cn("mt-5 grid grid-cols-4 gap-2 transition", !flipped && "pointer-events-none opacity-40")}>
              {GRADES.map((g) => (
                <button key={g.quality} onClick={() => grade(g.quality)} disabled={busy} className={cn("rounded-2xl bg-white py-3 text-[15px] font-semibold shadow-[0_1px_2px_rgba(0,0,0,0.06)] ring-1 ring-black/[0.06] transition hover:bg-slate-50 active:opacity-80 dark:bg-slate-900 dark:ring-white/10", g.className)}>
                  {g.label}
                  <span className="block text-xs font-normal opacity-75">phím {g.key}</span>
                </button>
              ))}
            </div>
            {!flipped && (
              <div className="mt-3 text-center">
                <Button variant="ghost" onClick={() => setFlipped(true)}>
                  Hiện đáp án
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </Page>
  );
}
