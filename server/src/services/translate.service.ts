import { Type } from "@google/genai";
import { Op } from "sequelize";
import { z } from "zod";
import { Document, DocumentPage, PageTranslation } from "../models/index.js";
import { generateJson } from "./ai/gemini.client.js";

export const MAX_TRANSLATE_PAGES = 6; // 1 lượt AI dịch tối đa ngần này trang
const LANG = "vi";

export type TranslatedPage = { page: number; text: string | null; status: "translated" | "original" | "empty" };

/** Trang đã là tiếng Việt (nhiều ký tự có dấu) → không cần dịch. */
export function isVietnamese(text: string) {
  const letters = text.match(/\p{L}/gu)?.length ?? 0;
  if (!letters) return false;
  const vi = text.match(/[ăâđêôơưàáạảãằắặẳẵầấậẩẫèéẹẻẽềếệểễìíịỉĩòóọỏõồốộổỗờớợởỡùúụủũừứựửữỳýỵỷỹ]/giu)?.length ?? 0;
  return vi / letters > 0.06;
}

const schema = {
  type: Type.OBJECT,
  properties: {
    pages: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          page: { type: Type.INTEGER },
          text: { type: Type.STRING, description: "Bản dịch TIẾNG VIỆT của trang (markdown). Không được giữ nguyên tiếng Anh." },
        },
        required: ["page", "text"],
      },
    },
  },
  required: ["pages"],
};
const Zod = z.object({ pages: z.array(z.object({ page: z.coerce.number().int(), text: z.string() })) });

const prompt = (pages: number[]) => `
Dịch nội dung các trang giáo trình phía trên sang TIẾNG VIỆT tự nhiên, dễ hiểu cho người học.
Quy tắc:
- Dịch đầy đủ, trung thành, không tóm tắt, không thêm ý.
- Thuật ngữ chuyên ngành: dịch kèm tiếng Anh trong ngoặc ở lần xuất hiện đầu, vd "bộ định tuyến (router)"; thuật ngữ quen dùng tiếng Anh thì giữ nguyên.
- Giữ nguyên câu lệnh, cấu hình, mã nguồn, địa chỉ IP, tên sản phẩm (đặt trong khối code markdown nếu là lệnh nhiều dòng).
- Trình bày bằng markdown: tiêu đề mục dùng ###, danh sách gạch đầu dòng, bảng nếu nguồn là bảng.
- Bỏ phần header/footer lặp lại (tên sách, số trang, tên chương ở lề).
- Trả về mảng "pages", mỗi phần tử ứng với 1 nhãn [Trang N]: ${pages.join(", ")}.`;

/** Tài liệu cùng file (cache theo sha256) để dùng lại bản dịch người khác đã tạo. */
async function documentIdsSharingFile(doc: Document) {
  if (!doc.file_hash) return [doc.id];
  const twins = await Document.findAll({ where: { file_hash: doc.file_hash }, attributes: ["id"] });
  return [doc.id, ...twins.map((t) => t.id).filter((id) => id !== doc.id)];
}

/** Dịch các trang [from, to] (đã kẹp ≤ MAX_TRANSLATE_PAGES). Trang đã dịch lấy từ cache. */
export async function translatePages(doc: Document, from: number, to: number, userId: number): Promise<TranslatedPage[]> {
  const pageNums = Array.from({ length: to - from + 1 }, (_, i) => from + i);
  const sources = await DocumentPage.findAll({ where: { document_id: doc.id, page: { [Op.between]: [from, to] } } });
  const textOf = new Map(sources.map((p) => [p.page, p.text]));

  const ids = await documentIdsSharingFile(doc);
  const cached = await PageTranslation.findAll({ where: { document_id: ids, lang: LANG, page: pageNums } });
  const done = new Map<number, string>();
  for (const id of ids) for (const c of cached.filter((x) => x.document_id === id)) if (!done.has(c.page)) done.set(c.page, c.text);

  const out = new Map<number, TranslatedPage>();
  const todo: number[] = [];
  for (const p of pageNums) {
    const text = textOf.get(p) ?? "";
    if (done.has(p)) out.set(p, { page: p, text: done.get(p)!, status: "translated" });
    else if (text.trim().length < 30) out.set(p, { page: p, text: null, status: "empty" }); // trang trống / trang scan
    else if (isVietnamese(text)) out.set(p, { page: p, text, status: "original" });
    else todo.push(p);
  }

  if (todo.length) {
    const res = await translateWithGemini(todo, textOf, userId);
    for (const r of res.pages) {
      if (!todo.includes(r.page) || out.has(r.page) || !r.text.trim()) continue;
      out.set(r.page, { page: r.page, text: r.text.trim(), status: "translated" });
      await PageTranslation.findOrCreate({
        where: { document_id: doc.id, page: r.page, lang: LANG },
        defaults: { document_id: doc.id, page: r.page, lang: LANG, text: r.text.trim() },
      });
    }
  }
  // Trang AI bỏ sót: trả về rỗng để giao diện cho phép thử lại.
  return pageNums.map((p) => out.get(p) ?? { page: p, text: null, status: "empty" as const });
}

/** Dự phòng khi chưa cài VI-Translate: Gemini dịch chữ của trang (tốn lượt). */
async function translateWithGemini(todo: number[], textOf: Map<number, string>, userId: number) {
  {
    const body = todo.map((p) => `[Trang ${p}]\n${textOf.get(p)}`).join("\n\n");
    return generateJson({
      systemInstruction: "Bạn là biên dịch viên chuyên nghiệp Anh–Việt cho giáo trình. Mọi nội dung trả về phải là TIẾNG VIỆT.",
      parts: [{ text: "Hãy DỊCH SANG TIẾNG VIỆT nội dung các trang sau." }, { text: body }, { text: prompt(todo) }],
      responseSchema: schema,
      // Model nhẹ đôi khi chỉ chép lại nguyên văn: coi là lỗi để generateJson gọi lại 1 lần.
      parse: (raw) => {
        const parsed = Zod.parse(raw);
        const untranslated = parsed.pages.filter((p) => p.text.length > 120 && !isVietnamese(p.text));
        if (untranslated.length) throw new Error(`AI chưa dịch trang ${untranslated.map((p) => p.page).join(", ")}`);
        return parsed;
      },
      userId,
      feature: "translate",
      temperature: 0.2,
    });
  }
}
