import type { Difficulty, QuestionType } from "../../models/index.js";

export const tocPrompt = (pageCount: number) => `
Đây là các trang đầu của một giáo trình có tổng cộng ${pageCount} trang PDF (nếu là text, mỗi trang có nhãn [Trang N] = số trang PDF).
Tìm MỤC LỤC và trả về danh sách CHƯƠNG cấp cao nhất (không lấy mục con):
- title: tên chương, giữ nguyên như trong mục lục
- start_page: số trang bắt đầu GHI TRONG MỤC LỤC (số in trên giấy)
- page_offset: số trang PDF trừ số trang in. Ước lượng bằng cách so số in ở chân/đầu trang với số trang PDF (nhãn [Trang N], hoặc vị trí trong file đính kèm với trang đầu là 1). Nếu không xác định được thì trả 0.
Nếu không có mục lục, trả chapters là mảng rỗng.`;

/**
 * Quy tắc bằng chứng dùng chung: mọi ý phải kèm câu trích NGUYÊN VĂN để code đối chiếu với text trang
 * (services/ai/grounding.ts). Ý không trích được sẽ bị loại.
 */
export const EVIDENCE_RULES = `
BẰNG CHỨNG (bắt buộc, sẽ được máy đối chiếu với sách):
- Mỗi ý chính (key_points), thuật ngữ (key_terms), câu hỏi (questions: source_quote) phải có quote = một đoạn
  NGUYÊN VĂN 8–30 từ liên tiếp COPY Y HỆT từ nội dung được cung cấp (giữ ngôn ngữ gốc, không dịch, không sửa,
  không ghép các đoạn rời). page = số trang chứa đoạn trích đó.
- Ý nào không tìm được đoạn nguyên văn chứng minh thì KHÔNG đưa vào. Không dùng kiến thức ngoài nội dung được cung cấp.
- term giữ đúng thuật ngữ như trong sách (có thể thêm nghĩa tiếng Việt trong ngoặc).`;

const LESSON_RULES = `
  Dẫn nguồn trong lesson: sau mỗi ý quan trọng đặt dấu [^k] (k = 1, 2, 3...) và thêm phần tử {k, page, quote}
  vào lesson_quotes, quote là đoạn NGUYÊN VĂN 8–30 từ trong sách chứng minh ý đó. KHÔNG ghi "(tr. N)" trong lesson.
  Mỗi phần ### phải có ít nhất 1 dấu [^k]. Chỉ giảng những gì có trong nội dung được cung cấp.`;

/** Danh sách mục con trong mục lục sách mà bài giảng phải bao quát. */
export const subtopicRule = (subtopics: { title: string; from: number; to: number }[]) =>
  subtopics.length
    ? `
  Bài giảng PHẢI giải thích đủ các mục sau của sách (theo thứ tự): ${subtopics.map((t) => `"${t.title}" (tr. ${t.from}–${t.to})`).join("; ")}.`
    : "";

export const summaryPrompt = (chapterTitle: string) => `
Bạn là trợ giảng đại học. Dựa DUY NHẤT vào nội dung chương đính kèm (chương "${chapterTitle}"),
tạo bản tóm tắt tiếng Việt gồm:
- overview: 3–5 câu
- key_points: 5–10 ý chính, mỗi ý kèm số trang (page) và quote
- key_terms: khái niệm quan trọng + định nghĩa ngắn gọn + số trang + quote
Quy tắc: không thêm kiến thức ngoài tài liệu; giữ nguyên thuật ngữ chuyên ngành; không dùng markdown (trừ trường lesson nếu được yêu cầu).
${EVIDENCE_RULES}`;

const TYPE_LABEL: Record<QuestionType, string> = {
  mcq: "trắc nghiệm 4 lựa chọn (mcq)",
  true_false: "đúng/sai (true_false, options là [\"Đúng\",\"Sai\"], correct_answer là \"Đúng\" hoặc \"Sai\")",
  short_answer: "tự luận ngắn (short_answer, correct_answer là đáp án tham khảo 2–4 câu, không có options)",
};

export const quizPrompt = (p: {
  count: number;
  types: QuestionType[];
  difficulty: Difficulty | "mixed";
  existing: string[];
}) => `
Dựa DUY NHẤT vào chương đính kèm, tạo ${p.count} câu hỏi ôn tập tiếng Việt.
Loại câu hỏi (chia đều): ${p.types.map((t) => TYPE_LABEL[t]).join("; ")}.
Độ khó: ${p.difficulty === "mixed" ? "trộn easy/medium/hard" : p.difficulty}
- easy: nhớ định nghĩa, khái niệm
- medium: hiểu, so sánh, giải thích
- hard: vận dụng vào tình huống, phân tích
Yêu cầu:
- Trắc nghiệm đúng 4 lựa chọn, 1 đáp án đúng, đáp án nhiễu hợp lý; correct_answer phải trùng KHỚP TỪNG KÝ TỰ với 1 phần tử trong options.
- Không đánh số A/B/C/D trong options.
- explanation giải thích vì sao đúng và vì sao các đáp án khác sai.
- source_page là trang chứa kiến thức; source_quote là đoạn NGUYÊN VĂN 8–30 từ trong sách chứng minh đáp án đúng; topic là chủ đề nhỏ (2–5 từ).
- Chỉ hỏi những gì có trong nội dung; câu không trích được bằng chứng nguyên văn thì bỏ.
${p.existing.length ? `- Không trùng các câu đã có:\n${p.existing.map((q) => `  • ${q}`).join("\n")}` : ""}`;

/** Prompt gộp cho pipeline: 1 lượt gọi ra cả tóm tắt lẫn câu hỏi. */
export const analysisPrompt = (chapterTitle: string, questionCount: number, subtopics: { title: string; from: number; to: number }[] = []) => `
${summaryPrompt(chapterTitle).trim()}

ĐỒNG THỜI:
- lesson: BÀI GIẢNG chi tiết bằng tiếng Việt, định dạng markdown, như giảng viên dạy cho người mới:
  mở đầu 1–2 câu nêu mục tiêu; chia các phần bằng tiêu đề ### ; giải thích từng khái niệm theo thứ tự dễ → khó, có ví dụ minh họa cụ thể;
  dùng gạch đầu dòng, **in đậm** thuật ngữ, bảng so sánh khi phù hợp, khối code nếu tài liệu có lệnh/cấu hình;
  kết thúc bằng mục ### Ghi nhớ (3–5 gạch đầu dòng). Độ dài 400–900 từ.${LESSON_RULES}${subtopicRule(subtopics)}
Và trong trường "questions":
${quizPrompt({ count: questionCount, types: ["mcq", "true_false"], difficulty: "mixed", existing: [] }).trim()}`;

/** Gộp nhiều chương / 1 lượt gọi: tiết kiệm hạn mức request theo ngày. */
export const batchAnalysisPrompt = (
  chapters: { id: number; title: string; subtopics?: { title: string; from: number; to: number }[] }[],
  questionCount: number,
) => `
Bạn là trợ giảng đại học. Phía trên là nội dung của ${chapters.length} chương, mỗi chương mở đầu bằng dòng "=== CHƯƠNG id=..." .
Mỗi "chương" ở đây là 1 BÀI HỌC trong lộ trình. Với MỖI chương, trả về 1 phần tử trong mảng "chapters" (đúng thứ tự, đúng chapter_id), CHỈ dựa vào nội dung của chính chương đó:
- lesson: BÀI GIẢNG chi tiết bằng tiếng Việt, định dạng markdown, như giảng viên dạy cho người mới:
  mở đầu 1–2 câu nêu mục tiêu; chia các phần bằng tiêu đề ### ; giải thích từng khái niệm theo thứ tự dễ → khó, có ví dụ minh họa cụ thể;
  dùng gạch đầu dòng, **in đậm** thuật ngữ, bảng so sánh khi phù hợp, khối code nếu tài liệu có lệnh/cấu hình;
  kết thúc bằng mục ### Ghi nhớ (3–5 gạch đầu dòng). Độ dài 400–900 từ.${LESSON_RULES}
- overview: 3–5 câu tiếng Việt
- key_points: 5–10 ý chính, mỗi ý kèm page (thêm page_end nếu ý trải dài nhiều trang) và quote
- key_terms: khái niệm quan trọng + định nghĩa ngắn gọn + page + quote
- questions: ${questionCount} câu hỏi ôn tập tiếng Việt, chia đều trắc nghiệm 4 lựa chọn (mcq) và đúng/sai (true_false, options là ["Đúng","Sai"], correct_answer là "Đúng" hoặc "Sai"), trộn độ khó easy/medium/hard;
  correct_answer phải trùng KHỚP TỪNG KÝ TỰ với 1 phần tử trong options; không đánh số A/B/C/D; explanation giải thích vì sao đúng và vì sao các đáp án khác sai; source_page là trang chứa kiến thức; source_quote là đoạn nguyên văn chứng minh đáp án; topic là chủ đề nhỏ (2–5 từ).
Quy tắc: không thêm kiến thức ngoài tài liệu; giữ nguyên thuật ngữ chuyên ngành; chỉ trường lesson dùng markdown.
${EVIDENCE_RULES}
Số trang (page, source_page) là số N trong nhãn [Trang N] đứng trước đoạn chứa kiến thức đó.
Danh sách chương: ${chapters.map((c) => `${c.id} = "${c.title}"`).join("; ")}
${chapters
  .filter((c) => c.subtopics?.length)
  .map((c) => `Chương id=${c.id} PHẢI giải thích đủ các mục của sách: ${c.subtopics!.map((t) => `"${t.title}" (tr. ${t.from}–${t.to})`).join("; ")}.`)
  .join("\n")}`;

/** Bổ sung bài giảng cho các mục con của sách mà bài giảng hiện tại chưa nói tới. */
export const supplementPrompt = (lessonTitle: string, missing: { title: string; from: number; to: number }[]) => `
Bài giảng "${lessonTitle}" còn thiếu các mục sau của sách: ${missing.map((t) => `"${t.title}" (tr. ${t.from}–${t.to})`).join("; ")}.
Dựa DUY NHẤT vào nội dung được cung cấp, viết phần bổ sung bằng tiếng Việt (markdown), mỗi mục một tiêu đề ### đúng tên mục
(dịch sang tiếng Việt, giữ thuật ngữ), giải thích dễ hiểu, có ví dụ nếu sách có. Độ dài 150–400 từ mỗi mục.${LESSON_RULES}`;

export const gradePrompt = (question: string, reference: string, answer: string) => `
Câu hỏi: ${question}
Đáp án tham khảo: ${reference}
Câu trả lời của người học: ${answer}
Chấm 0–10: đúng ý chính (6đ), đầy đủ (3đ), diễn đạt (1đ).
Trả JSON: { score, feedback, missing_points[] }. Feedback ngắn, tiếng Việt, mang tính khích lệ.`;

export const mindmapPrompt = (title: string, summaryJson: string) => `
Tạo sơ đồ tư duy Mermaid (cú pháp "mindmap") cho chương "${title}" từ tóm tắt sau:
${summaryJson}
Quy tắc:
- Dòng đầu là "mindmap", dòng 2 là "  root((${title.replace(/[()"]/g, "")}))".
- Tối đa 3 cấp, mỗi nhánh tối đa 6 nút, mỗi nút ≤ 6 từ.
- Thụt lề bằng 2 dấu cách cho mỗi cấp. Không dùng các ký tự ( ) [ ] { } " trong nội dung nút.
- Trả về trong trường "mermaid", không bọc code fence.`;

export const readChapterPrompt = (question: string) => `
Tìm trong nội dung chương đính kèm các đoạn liên quan để trả lời câu hỏi: "${question}".
Trả về tối đa 5 đoạn: text = tóm lược trung thành bằng tiếng Việt; quote = đoạn NGUYÊN VĂN 8–30 từ copy y hệt từ chương
(giữ ngôn ngữ gốc) làm bằng chứng; page = trang chứa quote. Đoạn không có quote nguyên văn sẽ bị loại.
Nếu chương không có thông tin liên quan, trả found = false.`;

export const tutorSystemPrompt = (documentTitle: string, chapterList: string) => `
Bạn là gia sư AI cho giáo trình "${documentTitle}".
Danh sách chương (id: tên):
${chapterList}

Quy tắc:
- Chỉ trả lời dựa trên nội dung giáo trình, lấy qua các tool được cung cấp. Dùng read_chapter khi cần chi tiết.
- Luôn trích dẫn số trang dạng (tr. X). Số trang tool trả về đã là số trang trong giáo trình gốc.
- Nếu giáo trình không có thông tin, nói rõ là không có, không tự bịa.
- Giải thích dễ hiểu, có ví dụ; dùng markdown gọn gàng.
- Khi người học muốn luyện tập, gọi create_quiz; câu hỏi sẽ hiển thị trong khung chat, bạn không cần chép lại đáp án.`;
