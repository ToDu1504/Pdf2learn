import { readFile } from "node:fs/promises";
import { Op } from "sequelize";
import { getDocument, OPS, Util } from "pdfjs-dist/legacy/build/pdf.mjs";
import { DocumentPage, type Chapter, type Document, type PageFigure } from "../models/index.js";
import { pdfPath } from "../middlewares/upload.js";

/**
 * Hình minh họa trong sách, tìm bằng CODE (không gọi AI): đi qua danh sách lệnh vẽ của trang (pdfjs), theo dõi ma trận
 * biến đổi để biết mỗi ảnh nằm ở đâu, gộp các mảnh ảnh sát nhau thành 1 hình, bỏ ảnh nhỏ (biểu tượng, logo) và ảnh
 * phủ gần cả trang (trang scan). Chú thích "Figure 3.2 …" / "Hình 3.2 …" gần nhất bên dưới (hoặc bên trên) gắn vào hình.
 * Giới hạn: hình vẽ bằng nét vector (không phải ảnh) chưa nhận ra được.
 */
type Box = { x: number; y: number; w: number; h: number };

const MIN_W = 0.18;
const MIN_H = 0.06;
const MIN_AREA = 0.025;
const MAX_AREA = 0.85;
const MIN_AREA_UNCAPTIONED = 0.04;
/** Nhãn chú thích, kể cả kiểu chữ in giãn cách "F I G U R E 2 . 3 0" (sách Sybex). Nhóm 1: chữ hoa; nhóm 2: chữ thường. */
const CAPTION =
  /^(?:(F ?I ?G ?U ?R ?E|F ?I ?G ?\.|H ?Ì ?N ?H|E ?X ?H ?I ?B ?I ?T)|(Figure|Fig\.|Hình|Exhibit))\s*(\d(?: ?\d)*(?: ?[.\-–] ?\d(?: ?\d)*)*)\s*[.:—–-]?\s*(.*)$/u;

/**
 * Dòng chú thích → "Hình 2.30: Keyboard and mouse PS/2 ports"; không phải chú thích → null.
 * Nhãn chữ thường ("Figure 2.30") chỉ nhận khi sau số là chữ hoa, để bỏ câu trong thân bài như "Figure 2.34 shows a…"
 * hay dòng chỉ còn "Figure 2.32." do xuống dòng.
 */
export function parseCaption(line: string) {
  const m = CAPTION.exec(line.trim());
  if (!m) return null;
  const num = m[3].replace(/\s/g, "");
  const rest = m[4].trim();
  if (m[2] && !/^[\p{Lu}\d"“(]/u.test(rest)) return null;
  return (rest ? `Hình ${num}: ${rest}` : `Hình ${num}`).slice(0, 200);
}

const IMAGE_OPS = new Set<number>([
  OPS.paintImageXObject,
  OPS.paintInlineImageXObject,
  OPS.paintImageMaskXObject,
  OPS.paintImageXObjectRepeat,
  OPS.paintInlineImageXObjectGroup,
  OPS.paintImageMaskXObjectGroup,
]);

/** Gộp các khung chạm nhau hoặc cách nhau < 1% trang (hình ghép từ nhiều mảnh). */
export function mergeBoxes(boxes: Box[]): Box[] {
  const out = boxes.map((b) => ({ ...b }));
  const near = (a: Box, b: Box, gap = 0.01) => a.x <= b.x + b.w + gap && b.x <= a.x + a.w + gap && a.y <= b.y + b.h + gap && b.y <= a.y + a.h + gap;
  for (let changed = true; changed; ) {
    changed = false;
    for (let i = 0; i < out.length && !changed; i++)
      for (let j = i + 1; j < out.length; j++)
        if (near(out[i], out[j])) {
          const a = out[i], b = out[j];
          const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
          out[i] = { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
          out.splice(j, 1);
          changed = true;
          break;
        }
  }
  return out;
}

/** Hình đáng hiển thị: đủ lớn, không phải ảnh phủ cả trang; sắp từ trên xuống. */
export function keepFigures(boxes: Box[]) {
  // Bỏ ảnh nền TRƯỚC khi gộp (không thì nó nuốt mọi hình): ảnh phủ gần cả trang (trang scan, nền),
  // dải trang trí chạy suốt mép trang (h ≥ 0.9 / w ≥ 0.95, trang mở đầu chương).
  const pieces = boxes.filter((b) => b.w > 0.02 && b.h > 0.02 && b.w * b.h <= MAX_AREA && b.h < 0.9 && b.w < 0.95);
  return mergeBoxes(pieces)
    .filter((b) => b.w >= MIN_W && b.h >= MIN_H && b.w * b.h >= MIN_AREA && b.w * b.h <= MAX_AREA)
    .sort((a, b) => a.y - b.y || a.x - b.x);
}

/** Chú thích gần nhất: dòng bắt đầu bằng "Figure N.N" ngay dưới hình (≤ 12% trang) hoặc ngay trên (≤ 8%). */
export function pickCaption(fig: Box, lines: { y: number; text: string }[]) {
  const bottom = fig.y + fig.h;
  let best: { d: number; text: string } | null = null;
  for (const l of lines) {
    const text = parseCaption(l.text);
    if (!text) continue;
    const d = l.y >= bottom - 0.01 ? l.y - bottom : l.y <= fig.y + 0.01 ? (fig.y - l.y) * 1.5 : Infinity;
    if (d <= 0.12 && (!best || d < best.d)) best = { d, text };
  }
  return best ? best.text : null;
}

/** Các ảnh trên cùng trang có chung 1 chú thích (vd. "(a) iOS và (b) Android" đặt cạnh nhau) → 1 hình. */
export function mergeSameCaption<T extends Box & { caption: string | null }>(figs: T[]): T[] {
  const out: T[] = [];
  for (const f of figs) {
    const same = f.caption ? out.find((o) => o.caption === f.caption) : undefined;
    if (!same) {
      out.push({ ...f });
      continue;
    }
    const x = Math.min(same.x, f.x), y = Math.min(same.y, f.y);
    Object.assign(same, { x, y, w: Math.max(same.x + same.w, f.x + f.w) - x, h: Math.max(same.y + same.h, f.y + f.h) - y });
  }
  return out;
}

type PdfPage = Awaited<ReturnType<Awaited<ReturnType<typeof getDocument>["promise"]>["getPage"]>>;

export async function pageFigures(page: PdfPage): Promise<PageFigure[]> {
  const vp = page.getViewport({ scale: 1 });
  const ops = await page.getOperatorList();
  const boxes: Box[] = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack: number[][] = [];
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    const args = ops.argsArray[i] as unknown[];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() ?? ctm;
    else if (fn === OPS.transform) ctm = Util.transform(ctm, args as number[]);
    else if (fn === OPS.paintFormXObjectBegin) {
      stack.push(ctm);
      const m = args?.[0];
      if (Array.isArray(m) && m.length === 6) ctm = Util.transform(ctm, m as number[]);
    } else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() ?? ctm;
    else if (IMAGE_OPS.has(fn)) {
      // Ảnh vẽ trong ô vuông đơn vị (0,0)–(1,1) của ma trận hiện tại → đổi sang tọa độ khung nhìn (gốc trên trái).
      const m = Util.transform(vp.transform, ctm);
      const pts = [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ].map(([u, v]) => [m[0] * u + m[2] * v + m[4], m[1] * u + m[3] * v + m[5]]);
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      const x0 = Math.max(0, Math.min(...xs)), x1 = Math.min(vp.width, Math.max(...xs));
      const y0 = Math.max(0, Math.min(...ys)), y1 = Math.min(vp.height, Math.max(...ys));
      if (x1 > x0 && y1 > y0) boxes.push({ x: x0 / vp.width, y: y0 / vp.height, w: (x1 - x0) / vp.width, h: (y1 - y0) / vp.height });
    }
  }
  const figs = keepFigures(boxes);
  if (!figs.length) return [];

  // Dòng chữ theo vị trí (để tìm chú thích).
  const content = await page.getTextContent();
  const rows = new Map<number, { y: number; parts: { x: number; s: string }[] }>();
  for (const it of content.items) {
    if (!("str" in it) || !it.str.trim()) continue;
    const [x, y] = vp.convertToViewportPoint(it.transform[4], it.transform[5]);
    const key = Math.round(y / 3);
    const row = rows.get(key) ?? { y: y / vp.height, parts: [] };
    row.parts.push({ x, s: it.str });
    rows.set(key, row);
  }
  const lines = [...rows.values()].map((r) => ({ y: r.y, text: r.parts.sort((a, b) => a.x - b.x).map((p) => p.s).join(" ").replace(/\s+/g, " ").trim() }));
  const r = (n: number) => Math.round(n * 1000) / 1000;
  return mergeSameCaption(figs.map((f) => ({ ...f, caption: pickCaption(f, lines) })))
    // Ảnh nhỏ không chú thích thường là trang trí (số chương ở trang mở đầu, logo) → bỏ.
    .filter((f) => f.caption || f.w * f.h >= MIN_AREA_UNCAPTIONED)
    .map((f) => ({
    x: r(f.x),
    y: r(f.y),
    w: r(f.w),
    h: r(f.h),
    ar: r(vp.height / vp.width),
    caption: f.caption,
  }));
}

const inflight = new Map<string, Promise<void>>();

/** Tính (1 lần, lưu vào document_pages.figures) hình của các trang [from, to] còn chưa tính. */
async function ensureFigures(doc: Document, from: number, to: number) {
  const key = `${doc.id}:${from}-${to}`;
  const running = inflight.get(key);
  if (running) return running;
  const job = (async () => {
    const todo = await DocumentPage.findAll({
      where: { document_id: doc.id, page: { [Op.between]: [from, to] }, figures: { [Op.is]: null } },
      attributes: ["id", "page"],
    });
    if (!todo.length) return;
    const task = getDocument({ data: new Uint8Array(await readFile(pdfPath(doc.file_path))), useSystemFonts: true, verbosity: 0 });
    const pdf = await task.promise;
    try {
      for (const row of todo) {
        let figures: PageFigure[] = [];
        try {
          const page = await pdf.getPage(row.page);
          figures = await pageFigures(page);
          page.cleanup();
        } catch (err) {
          console.warn(`[figures] trang ${row.page}:`, (err as Error).message);
        }
        await row.update({ figures });
      }
    } finally {
      await task.destroy();
    }
  })().finally(() => inflight.delete(key));
  inflight.set(key, job);
  return job;
}

/** Hình minh họa của 1 bài (theo khoảng trang của bài), sắp theo trang rồi từ trên xuống. */
export async function chapterFigures(doc: Document, chapter: Chapter) {
  await ensureFigures(doc, chapter.start_page, chapter.end_page);
  const pages = await DocumentPage.findAll({
    where: { document_id: doc.id, page: { [Op.between]: [chapter.start_page, chapter.end_page] } },
    attributes: ["page", "figures"],
    order: [["page", "ASC"]],
  });
  return pages.flatMap((p) => (p.figures ?? []).map((f, index) => ({ page: p.page, index, ...f })));
}
