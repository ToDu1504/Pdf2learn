import { Type } from "@google/genai";
import { z } from "zod";
import { env } from "../../config/env.js";
import { generateJson } from "../ai/gemini.client.js";

/**
 * Dịch các đoạn (segment) mà VI-Translate xuất ra ở chế độ handoff.
 * - Chính: Google Translate (endpoint gtx, miễn phí). Gộp nhiều đoạn vào 1 request để ít bị chặn.
 * - Dự phòng: Gemini khi Google trả 429 (mạng bị tạm chặn) — tốn lượt AI.
 * Thẻ <bN></bN> (công thức/code) và <sN>…</sN> (đậm/nghiêng) phải giữ nguyên: tách văn bản theo thẻ,
 * chỉ dịch phần chữ giữa các thẻ rồi ghép lại.
 */

const TAG = /(<\/?[bs]\d+>)/i;
const BATCH_CHARS = 4000;
const GOOGLE_COOLDOWN_MS = 10 * 60_000;
const GEMINI_BATCH_CHARS = 20_000; // ~2 lượt/cụm 10 trang: gói miễn phí chỉ ~20 lượt/ngày mỗi model

let googleBlockedUntil = 0;

class GoogleBlockedError extends Error {}

async function gtx(text: string): Promise<string> {
  if (Date.now() < googleBlockedUntil) throw new GoogleBlockedError();
  const res = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=vi&dt=t`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: new URLSearchParams({ q: text }),
    signal: AbortSignal.timeout(30_000),
    redirect: "manual", // bị chặn thì Google chuyển hướng sang trang CAPTCHA
  });
  if (res.status === 429 || res.status === 403 || (res.status >= 300 && res.status < 400)) {
    googleBlockedUntil = Date.now() + GOOGLE_COOLDOWN_MS;
    throw new GoogleBlockedError();
  }
  if (!res.ok) throw new Error(`Google Translate lỗi ${res.status}`);
  const data = (await res.json()) as [Array<[string]> | null];
  return (data[0] ?? []).map((s) => s[0]).join("");
}

/** Dịch 1 nhóm dòng trong 1 request; số dòng trả về lệch thì chia đôi nhóm và dịch lại. */
async function googleBatch(lines: string[]): Promise<string[]> {
  const out = (await gtx(lines.join("\n"))).split("\n");
  if (out.length === lines.length) return out.map((s) => s.trim());
  if (lines.length === 1) return [out.join(" ").trim()];
  const mid = Math.ceil(lines.length / 2);
  return [...(await googleBatch(lines.slice(0, mid))), ...(await googleBatch(lines.slice(mid)))];
}

const GeminiZod = z.object({ items: z.array(z.object({ i: z.coerce.number().int(), vi: z.string() })) });
const geminiSchema = {
  type: Type.OBJECT,
  properties: {
    items: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: { i: { type: Type.INTEGER }, vi: { type: Type.STRING, description: "Bản dịch tiếng Việt của dòng i" } },
        required: ["i", "vi"],
      },
    },
  },
  required: ["items"],
};

async function geminiBatch(lines: string[], userId: number): Promise<(string | null)[]> {
  const res = await generateJson({
    systemInstruction: "Bạn là biên dịch viên Anh–Việt cho giáo trình kỹ thuật. Mọi bản dịch phải là TIẾNG VIỆT.",
    parts: [
      {
        text:
          "Dịch từng dòng sau sang tiếng Việt tự nhiên, trung thành, không thêm ý. Giữ nguyên lệnh, địa chỉ IP, tên sản phẩm, số liệu và thuật ngữ quen dùng tiếng Anh. Trả về mảng items với đúng chỉ số i.\n\n" +
          JSON.stringify(lines.map((text, i) => ({ i, text }))),
      },
    ],
    responseSchema: geminiSchema,
    parse: (raw) => GeminiZod.parse(raw),
    userId,
    feature: "translate",
    temperature: 0.2,
  });
  const out: (string | null)[] = lines.map(() => null);
  for (const it of res.items) if (it.i >= 0 && it.i < lines.length && it.vi.trim()) out[it.i] = it.vi.trim();
  return out;
}

function chunkBy(lines: string[], maxChars: number) {
  const groups: string[][] = [];
  let cur: string[] = [];
  let size = 0;
  for (const l of lines) {
    if (cur.length && size + l.length > maxChars) {
      groups.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(l);
    size += l.length + 1;
  }
  if (cur.length) groups.push(cur);
  return groups;
}

export type SegmentProgress = (done: number, total: number) => void;

/** Trả về bản dịch theo `src`. Đoạn không dịch được thì không có trong kết quả (engine giữ nguyên bản gốc). */
export async function translateSegments(srcs: string[], userId: number, onProgress?: SegmentProgress) {
  // Tách theo thẻ, gom các mẩu chữ cần dịch (bỏ trùng). Xuống dòng trong mẩu → khoảng trắng (dùng \n làm ranh giới).
  const pieces = new Map<string, string | null>();
  const split = srcs.map((src) => src.split(TAG));
  for (const parts of split)
    for (const p of parts) if (!TAG.test(p) && /\p{L}/u.test(p)) pieces.set(p.replace(/\s+/g, " ").trim(), null);

  const todo = [...pieces.keys()];
  let done = 0;
  onProgress?.(0, todo.length);

  let rest: string[] = [];
  for (const [gi, group] of chunkBy(todo, BATCH_CHARS).entries()) {
    try {
      const vi = await googleBatch(group);
      group.forEach((g, i) => pieces.set(g, vi[i] || null));
      done += group.length;
      onProgress?.(done, todo.length);
      await new Promise((r) => setTimeout(r, 400)); // giãn request, tránh bị Google chặn
    } catch (err) {
      if (!(err instanceof GoogleBlockedError)) throw err;
      rest = chunkBy(todo, BATCH_CHARS).slice(gi).flat();
      break;
    }
  }

  if (rest.length) {
    if (!env.GEMINI_API_KEY) throw new Error("Google Translate đang tạm chặn mạng của bạn. Thử lại sau khoảng 10 phút.");
    // Mỗi nhóm thử 2 lần; còn nhóm lỗi thì báo lỗi (không lưu bản dịch dở — người dùng bấm Thử lại).
    const results = await Promise.allSettled(
      chunkBy(rest, GEMINI_BATCH_CHARS).map(async (group) => {
        const vi = await geminiBatch(group, userId).catch(() => geminiBatch(group, userId));
        group.forEach((g, i) => pieces.set(g, vi[i]));
        done += group.length;
        onProgress?.(done, todo.length);
      }),
    );
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    if (failed.length) {
      console.warn(`[translate] ${failed.length}/${results.length} nhóm Gemini lỗi:`, failed[0].reason);
      throw failed[0].reason;
    }
  }

  const result = new Map<string, string>();
  srcs.forEach((src, k) => {
    let ok = true;
    const dst = split[k]
      .map((p) => {
        if (TAG.test(p) || !/\p{L}/u.test(p)) return p;
        const vi = pieces.get(p.replace(/\s+/g, " ").trim());
        if (!vi) ok = false;
        return (p.match(/^\s*/)?.[0] ?? "") + (vi ?? p.trim()) + (p.match(/\s*$/)?.[0] ?? "");
      })
      .join("");
    if (ok) result.set(src, dst);
  });
  return result;
}
