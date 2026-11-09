import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { useQuery } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChevronLeft, ChevronRight, Maximize2, Minimize2, RotateCw, X, ZoomIn, ZoomOut } from "lucide-react";
import { authHeader, errorMessage, http } from "../../api/client";
import { Button, IconButton, Spinner, Tabs } from "../../components/ui";

pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

/** Khoảng trang đang xem: 1 trang (from = to) hoặc nhiều trang khi nội dung trích dẫn trải dài. */
export type PageRange = { from: number; to: number };

type Translation = { from: number; to: number; pages: { page: number; text: string | null; status: "translated" | "original" | "empty" }[] };

type ChunkStatus =
  | { available: false }
  | { available: true; chunk: number; from: number; to: number; phase: "queued" | "extracting" | "translating" | "building" | "ready" | "error"; done: number; total: number; unit?: "page" | "segment"; error?: string };

const CHUNK = 10; // khớp CHUNK ở server (pdfTranslate.service.ts)
const PHASE_LABEL = { queued: "Đang chờ tới lượt", extracting: "Đang phân tích bố cục trang", translating: "Đang dịch", building: "Đang dựng lại PDF tiếng Việt" } as const;

const ZOOMS = [0.75, 1, 1.25, 1.5, 2];
export const MAX_RANGE = 6; // khớp MAX_TRANSLATE_PAGES ở server

export const rangeLabel = (r: PageRange) => (r.to > r.from ? `Trang ${r.from}–${r.to}` : `Trang ${r.from}`);

/** Bản dịch giữ nguyên bố cục (VI-Translate) của 1 cụm 10 trang; chưa có thì theo dõi tiến độ. */
function TranslatedChunk({ documentId, pages, width, onUnavailable }: { documentId: number; pages: number[]; width: number; onUnavailable: () => void }) {
  const [retry, setRetry] = useState(false);
  const q = useQuery({
    queryKey: ["translation-pdf", documentId, pages[0], retry],
    queryFn: async () => (await http.get<ChunkStatus>(`/documents/${documentId}/translation/pdf?page=${pages[0]}${retry ? "&retry=1" : ""}`)).data,
    refetchInterval: (query) => {
      const d = query.state.data;
      return d && d.available && d.phase !== "ready" && d.phase !== "error" ? 2000 : false;
    },
  });
  const d = q.data;
  useEffect(() => {
    if (d && !d.available) onUnavailable();
  }, [d, onUnavailable]);
  const file = useMemo(
    () => (d?.available ? { url: `/api/v1/documents/${documentId}/translation/pdf/${d.chunk}`, httpHeaders: authHeader() } : null),
    [d, documentId],
  );

  if (q.error || (d?.available && d.phase === "error"))
    return (
      <div className="p-8 text-center text-[14px]">
        <p className="mb-3 text-rose-500">{q.error ? errorMessage(q.error) : d?.available && d.error}</p>
        <Button size="sm" variant="secondary" onClick={() => (retry ? q.refetch() : setRetry(true))}>
          <RotateCw /> Thử lại
        </Button>
      </div>
    );
  if (!d?.available || d.phase !== "ready") {
    const phase = d?.available ? d.phase : "queued";
    return (
      <div className="grid h-64 place-items-center text-center text-[14px] text-slate-500">
        <div>
          <Spinner className="mx-auto mb-3 size-6" />
          {PHASE_LABEL[phase as keyof typeof PHASE_LABEL] ?? "Đang chuẩn bị"}
          {d?.available && phase === "translating" && d.total > 0 && ` ${d.done}/${d.total} ${d.unit === "page" ? "trang" : "đoạn"}`}
          {d?.available && (
            <p className="mx-auto mt-1 max-w-sm text-[12px] text-slate-400">
              Dịch cả cụm trang {d.from}–{d.to}, giữ nguyên hình, bảng và bố cục. Lần sau mở lại ngay.
              {phase === "translating" && d.unit === "page" && " Nếu cửa sổ trình duyệt bật lên đòi xác minh của Google, hãy hoàn tất để dịch tiếp."}
            </p>
          )}
        </div>
      </div>
    );
  }
  return (
    <Document
      file={file}
      loading={<div className="grid h-64 place-items-center"><Spinner /></div>}
      error={<p className="p-6 text-center text-[14px] text-rose-500">Không mở được bản dịch.</p>}
      className="flex flex-col items-center gap-4 p-4"
    >
      {pages.map((p) => (
        <div key={p} className="shadow-sm">
          <Page pageNumber={p - d.from + 1} width={width} loading={<div className="grid h-64 place-items-center"><Spinner /></div>} />
          {pages.length > 1 && <p className="bg-slate-50 py-1 text-center text-[12px] text-slate-400 dark:bg-slate-950">Trang {p}</p>}
        </div>
      ))}
    </Document>
  );
}

function TranslationView({ documentId, range }: { documentId: number; range: PageRange }) {
  const q = useQuery({
    queryKey: ["translation", documentId, range.from, range.to],
    queryFn: async () => (await http.get<Translation>(`/documents/${documentId}/translation?from=${range.from}&to=${range.to}`)).data,
    staleTime: Infinity,
    retry: false,
  });

  if (q.isLoading)
    return (
      <div className="grid h-64 place-items-center text-center text-[14px] text-slate-500">
        <div>
          <Spinner className="mx-auto mb-3 size-6" />
          Đang dịch {range.to > range.from ? `${range.to - range.from + 1} trang` : "trang"} sang tiếng Việt…
        </div>
      </div>
    );
  if (q.error)
    return (
      <div className="p-8 text-center text-[14px]">
        <p className="mb-3 text-rose-500">{errorMessage(q.error)}</p>
        <Button size="sm" variant="secondary" onClick={() => q.refetch()}>
          <RotateCw /> Thử lại
        </Button>
      </div>
    );

  return (
    <div className="space-y-8 px-6 py-6 sm:px-8">
      {q.data?.pages.map((p) => (
        <section key={p.page}>
          <p className="eyebrow mb-2 flex items-center gap-2">
            Trang {p.page}
            {p.status === "original" && <span className="normal-case">· đã là tiếng Việt</span>}
          </p>
          {p.text ? (
            <div className="prose-study prose-translation">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{p.text}</ReactMarkdown>
            </div>
          ) : (
            <p className="text-[14px] text-slate-500">Trang này không có chữ để dịch (trang trống hoặc bản scan). Xem ở tab Bản gốc.</p>
          )}
        </section>
      ))}
    </div>
  );
}

/**
 * Xem trang gốc trong PDF + bản dịch tiếng Việt.
 * - Khoảng trang (vd. tr. 12–13): hiện tất cả các trang trong khoảng, dịch cả khoảng trong 1 lượt AI.
 * - Zoom bản gốc, mở rộng toàn màn hình.
 */
export function PdfViewer({
  documentId,
  range,
  pageCount,
  onRangeChange,
  onClose,
  expanded,
  onToggleExpand,
}: {
  documentId: number;
  range: PageRange;
  pageCount?: number | null;
  onRangeChange: (r: PageRange) => void;
  onClose: () => void;
  expanded: boolean;
  onToggleExpand: () => void;
}) {
  const file = useMemo(() => ({ url: `/api/v1/documents/${documentId}/file`, httpHeaders: authHeader() }), [documentId]);
  const [numPages, setNumPages] = useState(pageCount ?? 0);
  const [mode, setMode] = useState<"original" | "translation">("original");
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(560);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!box.current) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(280, Math.floor(e.contentRect.width) - 32)));
    ro.observe(box.current);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    box.current?.scrollTo({ top: 0 });
  }, [range.from, range.to, mode]);
  // Esc: thu nhỏ khi đang mở rộng.
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onToggleExpand();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded, onToggleExpand]);

  const last = numPages || range.to;
  const go = (p: number) => {
    const page = Math.min(Math.max(1, p), last);
    onRangeChange({ from: page, to: page });
  };
  const pages = Array.from({ length: Math.min(range.to - range.from + 1, MAX_RANGE) }, (_, i) => range.from + i);
  const zi = ZOOMS.indexOf(zoom);
  // Chưa cài VI-Translate ở server → bản dịch chữ (Gemini).
  const [pdfTranslation, setPdfTranslation] = useState(true);
  const onUnavailable = useCallback(() => setPdfTranslation(false), []);
  const chunks = [...new Set(pages.map((p) => Math.floor((p - 1) / CHUNK)))].map((c) => pages.filter((p) => Math.floor((p - 1) / CHUNK) === c));

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-black/[0.06] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)] dark:border-white/[0.08] dark:bg-slate-900">
      <div className="flex flex-wrap items-center gap-2 border-b border-black/[0.06] px-3 py-2 dark:border-white/[0.08]">
        <Tabs
          value={mode}
          onChange={setMode}
          items={[
            { value: "original", label: "Bản gốc" },
            { value: "translation", label: "Bản dịch" },
          ]}
        />
        <div className="ml-auto flex items-center gap-0.5">
          {(mode === "original" || pdfTranslation) && (
            <>
              <IconButton label="Thu nhỏ chữ" onClick={() => setZoom(ZOOMS[Math.max(0, zi - 1)])} disabled={zi <= 0}>
                <ZoomOut />
              </IconButton>
              <span className="w-10 text-center text-[12px] text-slate-500 tabular-nums">{Math.round(zoom * 100)}%</span>
              <IconButton label="Phóng to chữ" onClick={() => setZoom(ZOOMS[Math.min(ZOOMS.length - 1, zi + 1)])} disabled={zi >= ZOOMS.length - 1}>
                <ZoomIn />
              </IconButton>
            </>
          )}
          <IconButton label={expanded ? "Thu nhỏ khung (Esc)" : "Mở rộng toàn màn hình"} onClick={onToggleExpand}>
            {expanded ? <Minimize2 /> : <Maximize2 />}
          </IconButton>
          <IconButton label="Đóng" onClick={onClose}>
            <X />
          </IconButton>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 border-b border-black/[0.06] px-3 py-1.5 text-[13px] dark:border-white/[0.08]">
        <Button size="sm" variant="ghost" onClick={() => go(range.from - 1)} disabled={range.from <= 1}>
          <ChevronLeft /> Trước
        </Button>
        <span className="font-medium text-slate-600 dark:text-slate-300">
          {rangeLabel(range)}
          {numPages ? <span className="font-normal text-slate-400"> / {numPages}</span> : null}
        </span>
        <Button size="sm" variant="ghost" onClick={() => go(range.to + 1)} disabled={!!numPages && range.to >= numPages}>
          Sau <ChevronRight />
        </Button>
      </div>

      <div ref={box} className="flex-1 overflow-auto bg-slate-50 dark:bg-slate-950">
        {mode === "translation" && pdfTranslation ? (
          chunks.map((ps) => <TranslatedChunk key={ps[0]} documentId={documentId} pages={ps} width={Math.round(width * zoom)} onUnavailable={onUnavailable} />)
        ) : mode === "translation" ? (
          <div className="mx-auto max-w-[72ch] bg-white dark:bg-slate-900">
            <TranslationView documentId={documentId} range={range} />
          </div>
        ) : (
          <Document
            file={file}
            onLoadSuccess={(d) => setNumPages(d.numPages)}
            loading={<div className="grid h-64 place-items-center"><Spinner /></div>}
            error={<p className="p-6 text-center text-[14px] text-rose-500">Không mở được PDF.</p>}
            className="flex flex-col items-center gap-4 p-4"
          >
            {pages.map((p) => (
              <div key={p} className="shadow-sm">
                <Page pageNumber={p} width={Math.round(width * zoom)} loading={<div className="grid h-64 place-items-center"><Spinner /></div>} />
                {pages.length > 1 && <p className="bg-slate-50 py-1 text-center text-[12px] text-slate-400 dark:bg-slate-950">Trang {p}</p>}
              </div>
            ))}
          </Document>
        )}
      </div>
    </div>
  );
}
