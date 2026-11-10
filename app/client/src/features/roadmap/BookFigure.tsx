import { useEffect, useRef, useState } from "react";
import { pdfjs } from "react-pdf";
import { useQuery } from "@tanstack/react-query";
import { http } from "../../api/client";

// Cùng worker "legacy" như PdfViewer (Chromium 138 của Electron thiếu hàm mà bản thường cần).
pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString();

/** Hình minh họa trong sách (server tìm bằng code, xem services/figures.service.ts). Tọa độ theo tỉ lệ trang. */
export type Figure = { page: number; index: number; x: number; y: number; w: number; h: number; ar: number; caption: string | null };

/** Hình của 1 bài; null = chưa cần (bài chưa có bài giảng). Lỗi thì bài vẫn hiện, chỉ thiếu hình. */
export const useChapterFigures = (chapterId: number | null) =>
  useQuery({
    queryKey: ["figures", chapterId],
    queryFn: async () => (await http.get<Figure[]>(`/chapters/${chapterId}/figures`)).data,
    enabled: !!chapterId,
    staleTime: Infinity,
    retry: false,
  });

// Mỗi tài liệu chỉ mở PDF 1 lần cho mọi hình (pdf.js tải theo đoạn, không tải cả file).
const docs = new Map<number, ReturnType<typeof pdfjs.getDocument>["promise"]>();
const loadPdf = (documentId: number) => {
  let p = docs.get(documentId);
  if (!p) {
    p = pdfjs.getDocument({ url: `/api/v1/documents/${documentId}/file` }).promise;
    p.catch(() => docs.delete(documentId));
    docs.set(documentId, p);
  }
  return p;
};

/**
 * Vẽ đúng vùng hình trên trang PDF gốc (không chép ảnh ra file): chỉ vẽ khi hình sắp lọt vào màn hình,
 * không phóng to quá 1.6 lần kích thước in trong sách để khỏi vỡ ảnh.
 */
export function BookFigure({ documentId, fig, onPage }: { documentId: number; fig: Figure; onPage: (page: number) => void }) {
  const box = useRef<HTMLElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  const [width, setWidth] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setVisible(true), { rootMargin: "400px" });
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)));
    io.observe(el);
    ro.observe(el);
    return () => {
      io.disconnect();
      ro.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!visible || !width || !canvas.current) return;
    let task: { cancel(): void; promise: Promise<void> } | null = null;
    let cancelled = false;
    (async () => {
      try {
        const page = await (await loadPdf(documentId)).getPage(fig.page);
        if (cancelled) return;
        const base = page.getViewport({ scale: 1 });
        const cssW = Math.min(width, fig.w * base.width * 1.6);
        const scale = (cssW / (fig.w * base.width)) * Math.min(2, window.devicePixelRatio || 1);
        const viewport = page.getViewport({ scale, offsetX: -fig.x * base.width * scale, offsetY: -fig.y * base.height * scale });
        const c = canvas.current!;
        c.width = Math.round(fig.w * base.width * scale);
        c.height = Math.round(fig.h * base.height * scale);
        c.style.width = `${Math.round(cssW)}px`;
        task = page.render({ canvas: c, viewport });
        await task.promise;
      } catch (err) {
        if (!cancelled && (err as Error)?.name !== "RenderingCancelledException") {
          console.warn("[figure]", fig.page, err);
          setFailed(true);
        }
      }
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [visible, width, documentId, fig]);

  // Giữ chỗ đúng tỉ lệ trước khi vẽ để trang không nhảy.
  const ratio = (fig.h * fig.ar) / fig.w;
  return (
    <figure ref={box} className="not-prose my-6">
      {failed ? (
        <p className="rounded-xl bg-slate-50 p-4 text-center text-[13px] text-slate-500 dark:bg-slate-900">Không vẽ được hình này. Xem ở trang {fig.page} của PDF.</p>
      ) : (
        <div className="flex justify-center overflow-hidden rounded-xl border border-black/[0.06] bg-[#fffdf9] p-2 dark:border-white/[0.08]">
          <canvas ref={canvas} className="block h-auto max-w-full" style={{ width: "100%", aspectRatio: `${1 / ratio}` }} />
        </div>
      )}
      <figcaption className="mt-2 text-center text-[13px] text-slate-500">
        {fig.caption ?? "Hình trong sách"}
        <button onClick={() => onPage(fig.page)} className="ml-1.5 font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400" title="Mở trang trong PDF gốc">
          tr. {fig.page}
        </button>
      </figcaption>
    </figure>
  );
}
