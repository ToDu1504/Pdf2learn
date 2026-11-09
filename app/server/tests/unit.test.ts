import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { sm2 } from "../src/services/srs.service.js";
import { buildRanges, cutChapterPdf, fixedRanges, readPdfMeta, toDocumentPage, type OutlineNode } from "../src/services/pdf.service.js";
import { AnalysisZod, QuizZod, MindmapZod } from "../src/services/ai/schemas.js";
import { isDailyQuotaError, withRetry } from "../src/utils/withRetry.js";

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

// Mục lục thật của sách có bản quyền: chỉ có ở máy dev (gitignored), thiếu thì bỏ qua test tương ứng.
const hasBook = (name: string) => existsSync(path.join(__dirname, "fixtures", `outline-${name}.json`));
const books = hasBook("comptia-tech") && hasBook("ccna");

describe("roadmap", () => {
  // Mục lục thật của 2 giáo trình (trích bookmark bằng PyMuPDF): roadmap phải bám đúng sách.
  const fixture = (name: string) =>
    JSON.parse(readFileSync(path.join(__dirname, "fixtures", `outline-${name}.json`), "utf8")) as { pageCount: number; tree: OutlineNode[] };
  const build = async (name: string) => {
    const { flattenOutline, pickStudyChapters } = await import("../src/services/pdf.service.js");
    const { structureBook, findNode, roadmapReport, REVIEW_TOPIC, MAX_TOPIC_PAGES } = await import("../src/services/roadmap.service.js");
    const { pageCount, tree } = fixture(name);
    const ranges = pickStudyChapters(buildRanges(flattenOutline(tree, pageCount), pageCount));
    const plan = structureBook(ranges, (r) => findNode(tree, r)?.children ?? []);
    return { plan, tree, pageCount, report: roadmapReport(plan, pageCount, tree, "bookmark", false), REVIEW_TOPIC, MAX_TOPIC_PAGES };
  };
  const lessonsOf = (plan: { lessons: { from: number; to: number; source_title: string; title: string }[] }[]) => plan.flatMap((s) => s.lessons);
  const walk = (ns: OutlineNode[], depth = 0): (OutlineNode & { depth: number })[] => ns.flatMap((n) => [{ ...n, depth }, ...walk(n.children, depth + 1)]);

  it.skipIf(!books)("chặng = chương sách (không tách chương dài, tách Part → Chapter)", async () => {
    const comptia = await build("comptia-tech");
    expect(comptia.plan.map((s) => s.source_title)).toEqual(Array.from({ length: 12 }, (_, i) => expect.stringMatching(new RegExp(`^Chapter ${i + 1} `))));
    const ccna = await build("ccna");
    expect(ccna.plan.map((s) => s.source_title)).toEqual(Array.from({ length: 29 }, (_, i) => expect.stringMatching(new RegExp(`^Chapter ${i + 1} `))));
  });

  for (const name of ["comptia-tech", "ccna"]) {
    it.skipIf(!books)(`${name}: bài học không chồng trang, theo thứ tự, ≤ MAX_TOPIC_PAGES`, async () => {
      const { plan, MAX_TOPIC_PAGES } = await build(name);
      const lessons = lessonsOf(plan);
      lessons.forEach((l, i) => {
        expect(l.to).toBeGreaterThanOrEqual(l.from);
        expect(l.to - l.from + 1).toBeLessThanOrEqual(MAX_TOPIC_PAGES);
        if (i) expect(l.from).toBeGreaterThan(lessons[i - 1].to);
      });
    });

    it.skipIf(!books)(`${name}: phần ôn tập cuối chương không thành bài học, được liệt kê trong báo cáo`, async () => {
      const { plan, tree, report, REVIEW_TOPIC } = await build(name);
      const lessons = lessonsOf(plan);
      for (const l of lessons) expect(l.source_title).not.toMatch(REVIEW_TOPIC);
      // Trang thứ 2 trở đi của mục ôn tập (trang đầu có thể chung với đoạn cuối bài) không thuộc bài nào.
      const nodes = walk(tree).sort((a, b) => a.page - b.page);
      for (const n of nodes.filter((x) => x.depth >= 1 && REVIEW_TOPIC.test(x.title.replace(/\s+/g, " ")))) {
        const next = nodes.find((m) => m.page > n.page);
        if (!next || next.page - n.page < 2) continue;
        expect(lessons.some((l) => l.from <= n.page + 1 && n.page + 1 <= l.to), `${n.title} tr.${n.page + 1}`).toBe(false);
      }
      // Báo cáo khớp với bài học: trang được học + trang bỏ qua = toàn bộ sách.
      const skippedPages = report.skipped.reduce((n, s) => n + s.to - s.from + 1, 0);
      expect(report.covered + skippedPages).toBe(report.page_count);
      expect(report.skipped.every((s) => s.titles.length > 0)).toBe(true);
    });
  }

  it.skipIf(!books)("CompTIA: chia theo mục con thật của sách, không cắt máy móc", async () => {
    const { plan } = await build("comptia-tech");
    const titles = lessonsOf(plan).map((l) => l.source_title);
    expect(titles).toEqual(expect.arrayContaining(["Motherboards", "Processors", "Memory", "Managing Users and Passwords", "Using Data Encryption"]));
    // Chương 6: không còn bài toàn trang ôn tập (Summary/Lab/Review Questions 421–428).
    const ch6 = plan.find((s) => s.source_title.startsWith("Chapter 6"))!;
    expect(ch6.to).toBeLessThan(422);
  });

  it.skipIf(!books)("CCNA: bỏ 'Do I Know This Already?', 'Chapter Review', 'Part Review'; giữ mục con sát trang ôn tập", async () => {
    const { plan, report } = await build("ccna");
    const ch8 = plan.find((s) => s.source_title.startsWith("Chapter 8"))!;
    expect(ch8.lessons.map((l) => l.source_title)[0]).toBe("Virtual LAN Concepts");
    expect(ch8.to).toBe(259); // "Mismatched Native VLAN on a Trunk" (tr.259) nằm chung trang với Chapter Review
    expect(report.skipped.some((s) => s.titles.includes("Part I: Review"))).toBe(true);
  });

  it("roadmap không có bookmark con: dùng tiêu đề dò từ text, mục quá ngắn gộp vào bài trước", async () => {
    const { structureBook } = await import("../src/services/roadmap.service.js");
    const range = { title: "Chương 1", start_page: 1, end_page: 40 };
    const plan = structureBook([range], () => [
      { title: "A", page: 5, children: [] },
      { title: "B (ngắn)", page: 6, children: [] },
      { title: "C", page: 8, children: [] },
    ]);
    const lessons = plan[0].lessons;
    expect(lessons[0].from).toBe(1);
    expect(lessons.map((l) => l.source_title)).not.toContain("B (ngắn)");
    expect(lessons.at(-1)!.to).toBe(40);
    for (const l of lessons) expect(l.to - l.from + 1).toBeLessThanOrEqual(20);
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

describe("grounding (đối chiếu nội dung AI với sách)", () => {
  const pages = [
    { page: 48, text: "Exploring Motherboards\nThe spine of the computer is the system board, otherwise known as the motherboard. On the motherboard you will find the CPU, underlying circuitry, expansion slots, video components, RAM slots, and a vari-\nety of other chips." },
    { page: 49, text: "Random Access Memory (RAM) is the main working memory of the computer. Data in RAM is lost when the power is turned off.\nThe chipset controls the flow of data between the CPU and memory." },
  ];

  it("tìm câu trích nguyên văn, chịu được sửa nhẹ (dấu câu, hoa thường, gạch nối ngắt dòng)", async () => {
    const { quoteLocator } = await import("../src/services/ai/grounding.js");
    const locate = quoteLocator(pages);
    expect(locate("the system board, otherwise known as the motherboard", 49)?.page).toBe(48);
    expect(locate("expansion slots, video components, RAM slots, and a variety of other chips")?.page).toBe(48);
    expect(locate("Data in RAM is lost when the power is turned off.", 49)?.page).toBe(49);
  });

  it("không chấp nhận câu bịa, diễn giải lại hoặc quá ngắn", async () => {
    const { quoteLocator } = await import("../src/services/ai/grounding.js");
    const locate = quoteLocator(pages);
    expect(locate("RAM keeps its data permanently even without power supply")).toBeNull();
    expect(locate("The motherboard is where all the important parts get connected together")).toBeNull();
    expect(locate("the motherboard")).toBeNull();
  });

  it("applyGrounding: loại ý/thuật ngữ/câu hỏi không có bằng chứng, sửa số trang, gắn nhãn dẫn chứng bài giảng", async () => {
    const { applyGrounding } = await import("../src/services/ai/grounding.js");
    const g = applyGrounding({
      pages,
      subtopics: [
        { title: "Motherboards", from: 48, to: 48 },
        { title: "Chipsets", from: 50, to: 50 },
      ],
      lesson_md: "Bo mạch chủ là xương sống [^1]. RAM giữ dữ liệu vĩnh viễn [^2].",
      lesson_quotes: [
        { k: 1, page: 49, quote: "The spine of the computer is the system board, otherwise known as the motherboard" },
        { k: 2, page: 49, quote: "RAM keeps all data permanently after shutdown" },
      ],
      key_points: [
        { point: "RAM mất dữ liệu khi tắt nguồn", page: 48, quote: "Data in RAM is lost when the power is turned off" },
        { point: "Ý bịa", page: 48, quote: "CPUs are cooled by liquid nitrogen in every modern computer" },
      ],
      key_terms: [
        { term: "Motherboard (bo mạch chủ)", definition: "...", page: 48, quote: "otherwise known as the motherboard. On the motherboard you will find the CPU" },
        { term: "Quantum bus", definition: "...", page: 48, quote: "otherwise known as the motherboard. On the motherboard you will find the CPU" },
      ],
      questions: [
        { source_page: 48, source_quote: "The chipset controls the flow of data between the CPU and memory" },
        { source_page: 48, source_quote: null },
      ],
    });
    expect(g.key_points).toEqual([expect.objectContaining({ point: "RAM mất dữ liệu khi tắt nguồn", page: 49, verified: true })]);
    expect(g.key_terms.map((t) => t.term)).toEqual(["Motherboard (bo mạch chủ)"]);
    expect(g.questions).toEqual([expect.objectContaining({ source_page: 49, verified: true })]);
    expect(g.lesson_md).toBe("Bo mạch chủ là xương sống (tr. 48 #1). RAM giữ dữ liệu vĩnh viễn (chưa kiểm chứng).");
    expect(g.grounding.lesson).toEqual({ verified: 1, total: 2 });
    expect(g.grounding.missing.map((m) => m.title)).toEqual(["Chipsets"]);
  });

  it("PDF scan: không đối chiếu được → giữ nguyên, gắn verified = false", async () => {
    const { applyGrounding } = await import("../src/services/ai/grounding.js");
    const g = applyGrounding({ pages: null, subtopics: [], lesson_md: "Ý [^1].", lesson_quotes: [{ k: 1, page: 5, quote: "x" }], key_points: [{ point: "a", page: 5 }] });
    expect(g.grounding.mode).toBe("file");
    expect(g.key_points[0].verified).toBe(false);
    expect(g.lesson_md).toBe("Ý (tr. 5).");
  });

  it.skipIf(!books)("mục con của bài theo mục lục sách (CCNA: Virtual LAN Concepts)", async () => {
    const { subtopicsOf } = await import("../src/services/roadmap.service.js");
    const { tree } = JSON.parse(readFileSync(path.join(__dirname, "fixtures", "outline-ccna.json"), "utf8"));
    const subs = subtopicsOf(tree, { from: 233, to: 238, source_title: "Virtual LAN Concepts" });
    expect(subs.map((s) => s.title)).toContain("VLAN Tagging Concepts");
    expect(subs.every((s) => s.from > 233 && s.to <= 238)).toBe(true);
  });
});

describe("phần ôn tập của sách (đọc bằng code)", () => {
  const quizPage = {
    page: 67,
    text: [
      "Table 1-1 Section-to-Question Mapping",
      "1. Which of the following protocols are examples of TCP/IP transport layer protocols?",
      "(Choose two answers.)",
      "a. Ethernet",
      "b. HTTP",
      "c. UDP",
      "d. TCP",
      "2. The process of a web server adding a TCP header to the contents of a web page, fol-",
      "lowed by adding an IP header, is an example of what?",
      "a. Data encapsulation",
      "b. Same-layer interaction",
      "14 CCNA 200-301 Official Cert Guide, Volume 1",
      "c. OSI model",
      "Foundation Topics",
      "Perspectives on Networking",
      "1. Not a question: a numbered list in the next section",
    ].join("\n"),
  };

  it("đọc câu hỏi + lựa chọn (vắt dòng, gạch nối, bỏ header trang), dừng ở mục kế tiếp", async () => {
    const { parseQuestions } = await import("../src/services/bookReview.service.js");
    const qs = parseQuestions([quizPage], "Foundation Topics");
    expect(qs.map((q) => q.n)).toEqual([1, 2]);
    expect(qs[0].stem).toBe("Which of the following protocols are examples of TCP/IP transport layer protocols? (Choose two answers.)");
    expect(qs[1].stem).toContain("followed by adding an IP header");
    expect(qs[1].options.map((o) => o.text)).toEqual(["Data encapsulation", "Same-layer interaction", "OSI model"]);
  });

  it("bảng đáp án ngắn và phụ lục có giải thích", async () => {
    const { parseAnswerKey, parseExplainedAnswers } = await import("../src/services/bookReview.service.js");
    const key = parseAnswerKey("blah\nAnswers to the “Do I Know This Already?” quiz:\n1 D and F 2 A 3 B, C, and E\nTechnet24");
    expect([...key]).toEqual([[1, ["D", "F"]], [2, ["A"]], [3, ["B", "C", "E"]]]);
    const ex = parseExplainedAnswers("1. C and D. Of the remaining answers, Ethernet defines proto-\ncols.\n2. A. Encapsulation adds a header.");
    expect(ex.get(1)).toEqual({ letters: ["C", "D"], explanation: "Of the remaining answers, Ethernet defines protocols." });
    expect(ex.get(2)?.letters).toEqual(["A"]);
  });

  it("thuật ngữ cần biết", async () => {
    const { parseKeyTerms } = await import("../src/services/bookReview.service.js");
    expect(parseKeyTerms("Key Terms You Should Know\nadjacent-layer interaction, encapsulation, frame,\nprotocol data unit (PDU), segment\nCommand References")).toEqual([
      "adjacent-layer interaction",
      "encapsulation",
      "frame",
      "protocol data unit (PDU)",
      "segment",
    ]);
  });
});
