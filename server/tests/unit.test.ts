import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { sm2 } from "../src/services/srs.service.js";
import { splitSentences } from "../src/services/tts/sentenceSplitter.js";
import { normalizeForSpeech } from "../src/services/tts/textNormalizer.js";
import { buildRanges, cutChapterPdf, fixedRanges, readPdfMeta, toDocumentPage } from "../src/services/pdf.service.js";
import { concatWav, parseWav } from "../src/services/tts/wav.js";
import { AnalysisZod, QuizZod, MindmapZod } from "../src/services/ai/schemas.js";
import { isDailyQuotaError, withRetry } from "../src/utils/withRetry.js";
import { PRIORITY, ttsQueue } from "../src/services/tts/ttsQueue.js";

describe("sm2", () => {
  const fresh = { ease_factor: 2.5, interval_days: 0, repetitions: 0 };
  it("1, 6, rồi nhân ease factor", () => {
    const a = sm2(fresh, 4);
    expect(a.interval_days).toBe(1);
    const b = sm2(a, 4);
    expect(b.interval_days).toBe(6);
    const c = sm2(b, 4);
    expect(c.interval_days).toBe(Math.round(6 * b.ease_factor));
  });
  it("quên thì học lại, ease không dưới 1.3", () => {
    let card = { ...fresh, repetitions: 5, interval_days: 40 };
    for (let i = 0; i < 10; i++) card = { ...card, ...sm2(card, 0) };
    expect(card.repetitions).toBe(0);
    expect(card.interval_days).toBe(1);
    expect(card.ease_factor).toBe(1.3);
  });
});

describe("splitSentences", () => {
  it("không tách ở số thập phân, viết tắt và dấu hai chấm", () => {
    const s = splitSentences("Giá trị pi là 3.14 theo TS. Nguyễn Văn A. Định nghĩa: hệ điều hành quản lý tài nguyên.");
    expect(s).toEqual(["Giá trị pi là 3.14 theo TS. Nguyễn Văn A.", "Định nghĩa: hệ điều hành quản lý tài nguyên."]);
  });
  it("cắt câu dài, không đoạn nào vượt maxLen", () => {
    const long = Array.from({ length: 30 }, (_, i) => `mệnh đề số ${i}`).join(", ") + ".";
    const parts = splitSentences(long, 100);
    expect(parts.length).toBeGreaterThan(1);
    parts.forEach((p) => expect(p.length).toBeLessThanOrEqual(100));
    expect(parts.join(" ").replace(/\s+/g, " ")).toBe(long);
  });
  it("gộp câu quá ngắn vào câu trước", () => {
    expect(splitSentences("Đây là một câu đủ dài để đứng riêng. Đúng.")).toEqual(["Đây là một câu đủ dài để đứng riêng. Đúng."]);
  });
});

describe("normalizeForSpeech", () => {
  it("bỏ markdown, trích dẫn trang, code; mở rộng viết tắt theo ranh giới từ", () => {
    const out = normalizeForSpeech("**CSDL** là kho dữ liệu (tr. 12). VD: MySQL đạt 50%.\n```sql\nSELECT 1\n```");
    expect(out).toContain("cơ sở dữ liệu là kho dữ liệu");
    expect(out).toContain("ví dụ: MySQL đạt 50 phần trăm");
    expect(out).not.toMatch(/tr\. 12|\*|SELECT/);
  });
  it("không thay viết tắt nằm giữa từ", () => {
    expect(normalizeForSpeech("VDSL khác VD")).toBe("VDSL khác ví dụ");
  });
});

describe("page ranges", () => {
  it("đổi số trang trong chương về trang gốc và kẹp trong khoảng", () => {
    const ch = { start_page: 41, end_page: 60 };
    expect(toDocumentPage(1, ch)).toBe(41);
    expect(toDocumentPage(5, ch)).toBe(45);
    expect(toDocumentPage(99, ch)).toBe(60);
    expect(toDocumentPage(0, ch)).toBe(41);
  });
  it("buildRanges sắp xếp, bỏ trùng, bỏ ngoài khoảng", () => {
    const r = buildRanges(
      [
        { title: "C2", page: 20 },
        { title: "C1", page: 5 },
        { title: "dup", page: 20 },
        { title: "out", page: 999 },
      ],
      50,
    );
    expect(r).toEqual([
      { title: "C1", start_page: 5, end_page: 19 },
      { title: "C2", start_page: 20, end_page: 50 },
    ]);
  });
  it("fixedRanges phủ hết tài liệu", () => {
    expect(fixedRanges(45, 20).map((r) => [r.start_page, r.end_page])).toEqual([[1, 20], [21, 40], [41, 45]]);
  });
});

describe("pdf", () => {
  it("đọc số trang và cắt chương", async () => {
    const doc = await PDFDocument.create();
    for (let i = 0; i < 10; i++) doc.addPage();
    const file = path.join(tmpdir(), `studyai-test-${Date.now()}.pdf`);
    await writeFile(file, await doc.save());
    expect((await readPdfMeta(file)).pageCount).toBe(10);
    const cut = await PDFDocument.load(await cutChapterPdf(file, 3, 6));
    expect(cut.getPageCount()).toBe(4);
  });
});

function makeWav(samples: number, rate = 48000) {
  const data = Buffer.alloc(samples * 2);
  const b = Buffer.alloc(44);
  b.write("RIFF", 0, "ascii");
  b.writeUInt32LE(36 + data.length, 4);
  b.write("WAVEfmt ", 8, "ascii");
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36, "ascii");
  b.writeUInt32LE(data.length, 40);
  return Buffer.concat([b, data]);
}

describe("wav", () => {
  it("đọc thời lượng và ghép file", () => {
    expect(parseWav(makeWav(48000)).durationMs).toBe(1000);
    const joined = concatWav([makeWav(48000), makeWav(24000)]);
    expect(parseWav(joined).durationMs).toBe(1500);
  });
});

describe("QuizZod", () => {
  it("giữ câu hợp lệ, bỏ câu có đáp án không nằm trong options", () => {
    const base = { difficulty: "easy", explanation: "x", source_page: 1, topic: "t" };
    const out = QuizZod.parse({
      questions: [
        { ...base, type: "mcq", content: "ok", options: ["a", "b", "c", "d"], correct_answer: "b" },
        { ...base, type: "mcq", content: "bad", options: ["a", "b", "c", "d"], correct_answer: "z" },
        { ...base, type: "true_false", content: "tf", correct_answer: "Đúng" },
        { foo: 1 },
      ],
    });
    expect(out.map((q) => q.content)).toEqual(["ok", "tf"]);
    expect(out[1].options).toEqual(["Đúng", "Sai"]);
  });
  it("MindmapZod bỏ code fence", () => {
    expect(MindmapZod.parse({ mermaid: "```mermaid\nmindmap\n  root((A))\n```" }).mermaid).toBe("mindmap\n  root((A))");
  });
});

describe("quota", () => {
  it("phân biệt hết hạn mức ngày với giới hạn theo phút", () => {
    const daily = { status: 429, message: "Quota exceeded for metric: generate_content_free_tier_requests ... GenerateRequestsPerDayPerProjectPerModel-FreeTier" };
    const minute = { status: 429, message: "Quota exceeded ... GenerateRequestsPerMinutePerProjectPerModel. Please retry in 12.5s" };
    expect(isDailyQuotaError(daily)).toBe(true);
    expect(isDailyQuotaError(minute)).toBe(false);
    expect(isDailyQuotaError({ status: 500, message: "per day" })).toBe(false);
  });
  it("không retry khi hết hạn mức ngày", async () => {
    let calls = 0;
    const err = Object.assign(new Error("requests per day limit exceeded"), { status: 429 });
    await expect(withRetry(async () => { calls++; throw err; }, 3, 1)).rejects.toBe(err);
    expect(calls).toBe(1);
  });
  it("AnalysisZod tách tóm tắt và câu hỏi từ 1 response", () => {
    const out = AnalysisZod.parse({
      overview: "o",
      key_points: [{ point: "p", page: 1 }],
      key_terms: [],
      questions: [{ type: "true_false", difficulty: "easy", content: "c", correct_answer: "Sai", explanation: "e", source_page: 2, topic: "t" }],
    });
    expect(out.summary.overview).toBe("o");
    expect(out.questions).toHaveLength(1);
  });
});

describe("ttsQueue", () => {
  it("chạy 1 luồng, gộp trùng key, ưu tiên task người dùng đang nghe", async () => {
    const order: string[] = [];
    let active = 0;
    const job = (k: string) => async () => {
      active++;
      expect(active).toBe(1);
      await new Promise((r) => setTimeout(r, 5));
      order.push(k);
      active--;
    };
    const runs = { a: 0 };
    const a = ttsQueue.enqueue("a", async () => { runs.a++; await job("a")(); });
    const a2 = ttsQueue.enqueue("a", async () => { runs.a++; });
    const b = ttsQueue.enqueue("b", job("b"));
    const c = ttsQueue.enqueue("c", job("c"));
    ttsQueue.enqueue("c", job("c"), PRIORITY.listening);
    await Promise.all([a, a2, b, c]);
    expect(runs.a).toBe(1);
    expect(order).toEqual(["a", "c", "b"]);
  });
});

describe("chapter splitting", () => {
  it("tách Part dài thành các chương con, giữ mục ngắn", async () => {
    const { flattenOutline } = await import("../src/services/pdf.service.js");
    const tree = [
      { title: "Cover", page: 1, children: [] },
      { title: "Part I", page: 10, children: [
        { title: "Chapter 1", page: 11, children: [] },
        { title: "Chapter 2", page: 40, children: [] },
      ] },
      { title: "Index", page: 100, children: [] },
    ];
    expect(flattenOutline(tree, 120).map((s) => s.title)).toEqual(["Cover", "Chapter 1", "Chapter 2", "Index"]);
  });
  it("bỏ mục không phải nội dung và mục quá ngắn", async () => {
    const { pickStudyChapters } = await import("../src/services/pdf.service.js");
    const r = (title: string, s: number, e: number) => ({ title, start_page: s, end_page: e });
    const out = pickStudyChapters([
      r("Cover", 1, 2), r("Contents", 3, 9), r("Chapter 1 TCP/IP", 10, 30), r("Part I: Review", 31, 34),
      r("Chương 2: Tiến trình", 35, 60), r("Part IX: Appendixes", 61, 90), r("Index", 91, 99),
    ]);
    expect(out.map((x) => x.title)).toEqual(["Chapter 1 TCP/IP", "Chương 2: Tiến trình"]);
  });
});

describe("roadmap", () => {
  it("lấy mục con từ bookmark, bỏ mục ôn tập, bỏ qua nhóm 'Foundation Topics'", async () => {
    const { childBookmarks } = await import("../src/services/roadmap.service.js");
    const tree = [
      { title: "Chapter 1", page: 10, children: [
        { title: "Do I Know This Already?", page: 10, children: [] },
        { title: "Foundation Topics", page: 12, children: [
          { title: "Perspectives on Networking", page: 12, children: [] },
          { title: "TCP/IP Networking Model", page: 15, children: [] },
        ] },
        { title: "Chapter Review", page: 28, children: [] },
      ] },
    ];
    const out = childBookmarks(tree, { title: "Chapter 1", start_page: 10, end_page: 30 });
    expect(out.map((c) => c.title)).toEqual(["Perspectives on Networking", "TCP/IP Networking Model"]);
  });
  it("roadmap tất định: gộp mục quá ngắn, chia mục quá dài, khoảng trang liên tục", async () => {
    const { deterministicPlan } = await import("../src/services/roadmap.service.js");
    const range = { title: "Chương 1", start_page: 1, end_page: 40 };
    const plan = deterministicPlan([range], () => [
      { title: "A", page: 5 },
      { title: "B (ngắn)", page: 6 },
      { title: "C", page: 8 },
    ]);
    const topics = plan[0].topics;
    expect(topics.map((t) => t.title)).not.toContain("B (ngắn)");
    expect(topics[0].start_page).toBe(1);
    // C dài 33 trang (8–40) → chia thành nhiều phần ≤ 15 trang
    expect(topics.filter((t) => t.title.startsWith("C")).length).toBeGreaterThanOrEqual(3);
    const starts = topics.map((t) => t.start_page);
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
  });
  it("dò tiêu đề từ text, bỏ header lặp lại", async () => {
    const { headingCandidates } = await import("../src/services/roadmap.service.js");
    const header = "Giáo Trình Mạng Máy Tính";
    const pages = [
      { page: 1, text: `${header}\n1.1 Mô hình OSI\nNội dung dài của trang một, kết thúc bằng dấu chấm.` },
      { page: 2, text: `${header}\nCâu văn bình thường.\n1.2 Giao Thức TCP` },
      { page: 3, text: `${header}\nTầng Ứng Dụng Và Dịch Vụ\nđoạn văn.` },
    ];
    const titles = headingCandidates(pages).map((c) => c.title);
    expect(titles).toEqual(["1.1 Mô hình OSI", "1.2 Giao Thức TCP", "Tầng Ứng Dụng Và Dịch Vụ"]);
  });
});
