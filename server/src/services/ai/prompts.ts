import type { Difficulty, QuestionType } from "../../models/index.js";

export const tocPrompt = (pageCount: number) => `
Đây là các trang đầu của một giáo trình có tổng cộng ${pageCount} trang PDF (nếu là text, mỗi trang có nhãn [Trang N] = số trang PDF).
Tìm MỤC LỤC và trả về danh sách CHƯƠNG cấp cao nhất (không lấy mục con):
- title: tên chương, giữ nguyên như trong mục lục
- start_page: số trang bắt đầu GHI TRONG MỤC LỤC (số in trên giấy)
- page_offset: số trang PDF trừ số trang in. Ước lượng bằng cách so số in ở chân/đầu trang với số trang PDF (nhãn [Trang N], hoặc vị trí trong file đính kèm với trang đầu là 1). Nếu không xác định được thì trả 0.
Nếu không có mục lục, trả chapters là mảng rỗng.`;

export const summaryPrompt = (chapterTitle: string) => `
Bạn là trợ giảng đại học. Dựa DUY NHẤT vào nội dung chương đính kèm (chương "${chapterTitle}"),
tạo bản tóm tắt tiếng Việt gồm:
- overview: 3–5 câu
- key_points: 5–10 ý chính, mỗi ý kèm số trang (page)
- key_terms: khái niệm quan trọng + định nghĩa ngắn gọn + số trang
Quy tắc: không thêm kiến thức ngoài tài liệu; giữ nguyên thuật ngữ chuyên ngành; không dùng markdown (trừ trường lesson nếu được yêu cầu).`;

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
- source_page là trang chứa kiến thức; topic là chủ đề nhỏ (2–5 từ).
${p.existing.length ? `- Không trùng các câu đã có:\n${p.existing.map((q) => `  • ${q}`).join("\n")}` : ""}`;

/** Prompt gộp cho pipeline: 1 lượt gọi ra cả tóm tắt lẫn câu hỏi. */
export const analysisPrompt = (chapterTitle: string, questionCount: number) => `
${summaryPrompt(chapterTitle).trim()}

ĐỒNG THỜI:
- lesson: BÀI GIẢNG chi tiết bằng tiếng Việt, định dạng markdown, như giảng viên dạy cho người mới:
  mở đầu 1–2 câu nêu mục tiêu; chia các phần bằng tiêu đề ### ; giải thích từng khái niệm theo thứ tự dễ → khó, có ví dụ minh họa cụ thể;
  dùng gạch đầu dòng, **in đậm** thuật ngữ, bảng so sánh khi phù hợp, khối code nếu tài liệu có lệnh/cấu hình;
  ghi nguồn dạng (tr. N), hoặc (tr. N–M) nếu ý trải dài nhiều trang, sau ý quan trọng; kết thúc bằng mục ### Ghi nhớ (3–5 gạch đầu dòng). Độ dài 400–900 từ.
Và trong trường "questions":
${quizPrompt({ count: questionCount, types: ["mcq", "true_false"], difficulty: "mixed", existing: [] }).trim()}`;

/** Gộp nhiều chương / 1 lượt gọi: tiết kiệm hạn mức request theo ngày. */
export const batchAnalysisPrompt = (chapters: { id: number; title: string }[], questionCount: number) => `
Bạn là trợ giảng đại học. Phía trên là nội dung của ${chapters.length} chương, mỗi chương mở đầu bằng dòng "=== CHƯƠNG id=..." .
Mỗi "chương" ở đây là 1 BÀI HỌC trong lộ trình. Với MỖI chương, trả về 1 phần tử trong mảng "chapters" (đúng thứ tự, đúng chapter_id), CHỈ dựa vào nội dung của chính chương đó:
- lesson: BÀI GIẢNG chi tiết bằng tiếng Việt, định dạng markdown, như giảng viên dạy cho người mới:
  mở đầu 1–2 câu nêu mục tiêu; chia các phần bằng tiêu đề ### ; giải thích từng khái niệm theo thứ tự dễ → khó, có ví dụ minh họa cụ thể;
  dùng gạch đầu dòng, **in đậm** thuật ngữ, bảng so sánh khi phù hợp, khối code nếu tài liệu có lệnh/cấu hình;
  ghi nguồn dạng (tr. N), hoặc (tr. N–M) nếu ý trải dài nhiều trang, sau ý quan trọng; kết thúc bằng mục ### Ghi nhớ (3–5 gạch đầu dòng). Độ dài 400–900 từ.
- overview: 3–5 câu tiếng Việt
- key_points: 5–10 ý chính, mỗi ý kèm page (thêm page_end nếu ý trải dài nhiều trang)
- key_terms: khái niệm quan trọng + định nghĩa ngắn gọn + page
- questions: ${questionCount} câu hỏi ôn tập tiếng Việt, chia đều trắc nghiệm 4 lựa chọn (mcq) và đúng/sai (true_false, options là ["Đúng","Sai"], correct_answer là "Đúng" hoặc "Sai"), trộn độ khó easy/medium/hard;
  correct_answer phải trùng KHỚP TỪNG KÝ TỰ với 1 phần tử trong options; không đánh số A/B/C/D; explanation giải thích vì sao đúng và vì sao các đáp án khác sai; source_page là trang chứa kiến thức; topic là chủ đề nhỏ (2–5 từ).
Quy tắc: không thêm kiến thức ngoài tài liệu; giữ nguyên thuật ngữ chuyên ngành; chỉ trường lesson dùng markdown.
Số trang (page, source_page) là số N trong nhãn [Trang N] đứng trước đoạn chứa kiến thức đó.
Danh sách chương: ${chapters.map((c) => `${c.id} = "${c.title}"`).join("; ")}`;

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
Trả về tối đa 5 đoạn trích (tóm lược trung thành, tiếng Việt), mỗi đoạn kèm số trang.
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
