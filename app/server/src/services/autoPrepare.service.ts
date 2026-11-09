import { Chapter, Document, UserSettings } from "../models/index.js";
import { availableModels, nextQuotaReset, QuotaExhaustedError } from "./ai/gemini.client.js";
import { analyzeFrom, isAnalyzing } from "./chapterAnalysis.service.js";
import { fullStatus, isPdfTranslatorInstalled, startFullTranslation } from "./translate/pdfTranslate.service.js";

/**
 * CHUẨN BỊ TRƯỚC Ở NỀN (không đợi người học mở tới):
 *  - Tự soạn bài giảng cho mọi bài còn chờ, theo thứ tự lộ trình, tài liệu học gần nhất trước. Mỗi lượt dùng
 *    analyzeFrom (gộp nhiều bài / 1 lượt Gemini). Luôn chừa RESERVE_MODELS model chưa hết lượt cho việc người học
 *    đang làm; hết lượt thì nghỉ tới khi hạn mức ngày reset rồi tự chạy tiếp.
 *  - Tự dịch toàn bộ PDF (Google qua trình duyệt, không tốn lượt AI). Một lượt dịch gặp lỗi (vd. CAPTCHA không ai
 *    giải) thì dừng; TRANSLATE_RETRY_MS sau tự thử lại.
 * Bật/tắt theo người dùng: user_settings.auto_prepare / auto_translate.
 */

const RESERVE_MODELS = 1;
const TICK_MS = 30 * 60_000;
const TRANSLATE_RETRY_MS = 60 * 60_000;
const PAUSE_BETWEEN_MS = 3_000;

let running = false;
let wakeTimer: NodeJS.Timeout | null = null;
const translateTriedAt = new Map<number, number>();

async function enabledUsers(field: "auto_prepare" | "auto_translate") {
  const off = await UserSettings.findAll({ where: { [field]: false }, attributes: ["user_id"] });
  const disabled = new Set(off.map((s) => s.user_id));
  return (userId: number) => !disabled.has(userId);
}

/** Bài kế tiếp cần soạn: tài liệu có hoạt động gần nhất trước, trong tài liệu theo thứ tự lộ trình. */
async function nextPending() {
  const allowed = await enabledUsers("auto_prepare");
  const docs = (await Document.findAll({ where: { status: "done" }, order: [["created_at", "DESC"]] })).filter((d) => allowed(d.user_id));
  const ranked = await Promise.all(
    docs.map(async (doc) => {
      const last = await Chapter.max<Date, Chapter>("completed_at", { where: { document_id: doc.id } });
      return { doc, at: Math.max(new Date(last ?? 0).getTime(), new Date(doc.created_at).getTime()) };
    }),
  );
  for (const { doc } of ranked.sort((a, b) => b.at - a.at)) {
    const ch = (await Chapter.findAll({ where: { document_id: doc.id, status: "pending" }, order: [["order_index", "ASC"]], attributes: ["id"] })).find(
      (c) => !isAnalyzing(c.id),
    );
    if (ch) return { doc, chapterId: ch.id };
  }
  return null;
}

function sleepUntil(at: number) {
  if (wakeTimer) clearTimeout(wakeTimer);
  wakeTimer = setTimeout(() => void kickAutoPrepare(), Math.max(60_000, at - Date.now()));
}

/** Chạy vòng soạn trước (an toàn khi gọi nhiều lần: chỉ 1 vòng chạy). */
export async function kickAutoPrepare() {
  if (running) return;
  running = true;
  let done = 0;
  try {
    for (;;) {
      if (availableModels().length <= RESERVE_MODELS) {
        console.log(`[auto] tạm nghỉ soạn trước: chừa lượt Gemini còn lại cho việc bạn đang làm; chạy tiếp sau khi hạn mức reset`);
        sleepUntil(nextQuotaReset());
        break;
      }
      const next = await nextPending();
      if (!next) break;
      try {
        await analyzeFrom(next.doc, next.chapterId);
        done++;
      } catch (err) {
        if (err instanceof QuotaExhaustedError) {
          sleepUntil(nextQuotaReset());
          break;
        }
        // Lỗi khác: bài đó thành "failed" (analyzeFrom đã ghi), chuyển sang bài kế tiếp.
      }
      await new Promise((r) => setTimeout(r, PAUSE_BETWEEN_MS));
    }
  } finally {
    running = false;
    if (done) console.log(`[auto] đã soạn trước ${done} lượt`);
  }
}

/** Tự dịch toàn bộ các tài liệu chưa dịch xong (mỗi tài liệu thử lại sau TRANSLATE_RETRY_MS nếu lượt trước lỗi). */
export async function kickAutoTranslate(only?: Document) {
  if (!isPdfTranslatorInstalled()) return;
  const allowed = await enabledUsers("auto_translate");
  const docs = only ? [only] : await Document.findAll({ where: { status: "done" }, order: [["created_at", "DESC"]] });
  for (const doc of docs) {
    if (!allowed(doc.user_id)) continue;
    const st = fullStatus(doc);
    if (st.complete || st.running) continue;
    if (st.error && Date.now() - (translateTriedAt.get(doc.id) ?? 0) < TRANSLATE_RETRY_MS) continue;
    translateTriedAt.set(doc.id, Date.now());
    startFullTranslation(doc, doc.user_id);
    console.log(`[auto] dịch trước tài liệu ${doc.id}: còn ${st.total - st.ready}/${st.total} cụm`);
  }
}

/** Gọi khi server khởi động: chạy ngay + định kỳ (bắt kịp khi hạn mức reset, khi có tài liệu mới). */
export function startAutoPrepare() {
  if (process.env.PDF2LEARN_NO_AUTO === "1") return; // chạy thử: không soạn/dịch nền
  const tick = () => {
    void kickAutoPrepare();
    void kickAutoTranslate().catch((err) => console.warn("[auto] dịch trước lỗi:", (err as Error).message));
  };
  setTimeout(tick, 20_000);
  setInterval(tick, TICK_MS).unref();
}
