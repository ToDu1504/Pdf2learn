// Tạo tài khoản + giáo trình mẫu đã "xử lý xong" để dùng thử UI mà không cần Gemini key.
// Chạy: npm run seed:demo   → đăng nhập demo@studyai.local / demo123
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { unlink, writeFile } from "node:fs/promises";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { sequelize } from "../src/config/db.js";
import { pdfPath } from "../src/middlewares/upload.js";
import { Chapter, Document, Flashcard, Question, RoadmapSection, Summary, User } from "../src/models/index.js";

const EMAIL = "demo@studyai.local";

const CHAPTERS = [
  {
    title: "Chương 1: Tổng quan về hệ điều hành",
    pages: [1, 6],
    overview:
      "Hệ điều hành là phần mềm trung gian giữa người dùng và phần cứng. Nó quản lý tài nguyên như CPU, bộ nhớ và thiết bị vào ra. Chương này giới thiệu chức năng, lịch sử phát triển và các kiểu hệ điều hành phổ biến.",
    points: [
      ["Hệ điều hành đóng vai trò cấp phát và quản lý tài nguyên phần cứng", 1],
      ["Nhân (kernel) chạy ở chế độ đặc quyền, chương trình người dùng chạy ở chế độ thường", 2],
      ["Lời gọi hệ thống là cách chương trình yêu cầu dịch vụ từ nhân", 3],
      ["Hệ điều hành đa chương trình giúp tận dụng CPU khi có tiến trình chờ vào ra", 4],
      ["Hệ thống thời gian thực phải đáp ứng trong giới hạn thời gian nghiêm ngặt", 5],
    ],
    terms: [
      ["Kernel", "Phần lõi của hệ điều hành, luôn nằm trong bộ nhớ và chạy ở chế độ đặc quyền", 2],
      ["System call", "Giao diện để chương trình người dùng yêu cầu dịch vụ của nhân", 3],
      ["Đa chương trình", "Kỹ thuật giữ nhiều chương trình trong bộ nhớ để CPU luôn có việc", 4],
    ],
  },
  {
    title: "Chương 2: Tiến trình và luồng",
    pages: [7, 12],
    overview:
      "Tiến trình là chương trình đang thực thi, có không gian địa chỉ và trạng thái riêng. Luồng là đơn vị thực thi nhỏ hơn, chia sẻ tài nguyên của tiến trình. Chương này trình bày vòng đời tiến trình, khối điều khiển tiến trình và mô hình đa luồng.",
    points: [
      ["Tiến trình có các trạng thái mới, sẵn sàng, đang chạy, chờ và kết thúc", 7],
      ["Khối điều khiển tiến trình (PCB) lưu mọi thông tin để tạm dừng và chạy tiếp tiến trình", 8],
      ["Chuyển ngữ cảnh tốn chi phí vì phải lưu và nạp lại trạng thái CPU", 9],
      ["Các luồng trong cùng tiến trình chia sẻ bộ nhớ nên giao tiếp nhanh hơn", 10],
      ["Lập lịch Round Robin cấp cho mỗi tiến trình một lượng thời gian cố định", 11],
    ],
    terms: [
      ["PCB", "Cấu trúc dữ liệu lưu trạng thái, thanh ghi, thông tin bộ nhớ của tiến trình", 8],
      ["Context switch", "Việc lưu trạng thái tiến trình hiện tại và nạp trạng thái tiến trình khác", 9],
      ["Round Robin", "Thuật toán lập lịch xoay vòng với lượng tử thời gian cố định", 11],
    ],
  },
];

type Q = [type: "mcq" | "true_false", difficulty: "easy" | "medium" | "hard", content: string, options: string[], answer: string, explanation: string, page: number, topic: string];
const QUESTIONS: Q[][] = [
  [
    ["mcq", "easy", "Thành phần nào của hệ điều hành luôn chạy ở chế độ đặc quyền?", ["Trình soạn thảo", "Kernel", "Trình duyệt", "Shell người dùng"], "Kernel", "Kernel là lõi hệ điều hành, chạy ở chế độ đặc quyền để truy cập trực tiếp phần cứng. Các phương án khác là chương trình người dùng.", 2, "Kernel"],
    ["mcq", "medium", "Chương trình người dùng yêu cầu dịch vụ của nhân bằng cách nào?", ["Gọi hàm thư viện đồ họa", "Ghi trực tiếp vào thanh ghi phần cứng", "Lời gọi hệ thống", "Khởi động lại máy"], "Lời gọi hệ thống", "System call là giao diện chính thức giữa chương trình người dùng và nhân.", 3, "System call"],
    ["true_false", "easy", "Hệ điều hành đa chương trình giúp CPU không bị rảnh khi một tiến trình chờ vào ra.", ["Đúng", "Sai"], "Đúng", "Khi một tiến trình chờ I/O, CPU chuyển sang tiến trình khác trong bộ nhớ.", 4, "Đa chương trình"],
    ["mcq", "hard", "Hệ thống nào bắt buộc phải phản hồi trong giới hạn thời gian nghiêm ngặt?", ["Hệ thống xử lý theo lô", "Hệ thống thời gian thực", "Hệ thống phân chia thời gian", "Hệ thống đơn nhiệm"], "Hệ thống thời gian thực", "Hệ thống thời gian thực coi việc trễ hạn là lỗi, khác với hệ thống lô hay phân chia thời gian.", 5, "Thời gian thực"],
  ],
  [
    ["mcq", "easy", "Trạng thái nào KHÔNG thuộc vòng đời tiến trình?", ["Sẵn sàng", "Đang chạy", "Đang biên dịch", "Chờ"], "Đang biên dịch", "Vòng đời gồm mới, sẵn sàng, đang chạy, chờ, kết thúc; biên dịch xảy ra trước khi có tiến trình.", 7, "Trạng thái tiến trình"],
    ["mcq", "medium", "PCB dùng để làm gì?", ["Lưu mã nguồn chương trình", "Lưu thông tin để tạm dừng và chạy tiếp tiến trình", "Quản lý file trên đĩa", "Điều khiển màn hình"], "Lưu thông tin để tạm dừng và chạy tiếp tiến trình", "PCB chứa trạng thái, thanh ghi, thông tin bộ nhớ để hệ điều hành chuyển ngữ cảnh.", 8, "PCB"],
    ["true_false", "medium", "Các luồng trong cùng một tiến trình có không gian địa chỉ riêng biệt.", ["Đúng", "Sai"], "Sai", "Các luồng chia sẻ không gian địa chỉ của tiến trình, chỉ có ngăn xếp và thanh ghi riêng.", 10, "Luồng"],
    ["mcq", "hard", "Nếu lượng tử thời gian Round Robin quá nhỏ, điều gì xảy ra?", ["Thuật toán trở thành FCFS", "Chi phí chuyển ngữ cảnh tăng mạnh", "Tiến trình không bao giờ chạy", "Bộ nhớ bị tràn"], "Chi phí chuyển ngữ cảnh tăng mạnh", "Lượng tử nhỏ khiến CPU chuyển ngữ cảnh liên tục; lượng tử quá lớn thì RR giống FCFS.", 11, "Round Robin"],
  ],
];

async function makePdf(pageCount: number) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= pageCount; i++) {
    const page = pdf.addPage([595, 842]);
    page.drawText(`StudyAI demo - page ${i}`, { x: 60, y: 760, size: 22, font });
    page.drawText("Sample textbook content for UI testing.", { x: 60, y: 720, size: 12, font });
  }
  return pdf.save();
}

async function main() {
  await sequelize.authenticate();
  const [user] = await User.findOrCreate({
    where: { email: EMAIL },
    defaults: { email: EMAIL, full_name: "Người dùng demo", password_hash: await bcrypt.hash("demo123", 10) },
  });
  const old = await Document.findAll({ where: { user_id: user.id, title: "Giáo trình Hệ điều hành (demo)" } });
  for (const d of old) {
    await d.destroy();
    await unlink(pdfPath(d.file_path)).catch(() => {});
  }

  const file = `${randomUUID()}.pdf`;
  const bytes = await makePdf(12);
  await writeFile(pdfPath(file), bytes);
  const doc = await Document.create({
    user_id: user.id,
    title: "Giáo trình Hệ điều hành (demo)",
    file_path: file,
    file_size: bytes.length,
    page_count: 12,
    status: "done",
    current_step: "done",
    progress: 100,
  });

  for (const [i, c] of CHAPTERS.entries()) {
    const section = await RoadmapSection.create({ document_id: doc.id, order_index: i, title: c.title.replace(/^Chương d+: /, ""), description: c.overview.split(". ")[0] + "." });
    const chapter = await Chapter.create({
      document_id: doc.id,
      section_id: section.id,
      description: c.overview.split(". ")[0] + ".",
      est_minutes: 25,
      order_index: i,
      title: c.title,
      start_page: c.pages[0],
      end_page: c.pages[1],
      status: "done",
    });
    await Summary.create({
      chapter_id: chapter.id,
      overview: c.overview,
      lesson_md: [
        "### Mục tiêu bài học",
        c.overview,
        "### Nội dung chính",
        ...c.points.map(([point, page]) => `- ${point} (tr. ${page})`),
        "### Khái niệm cần nhớ",
        "| Khái niệm | Ý nghĩa |",
        "|---|---|",
        ...c.terms.map(([term, def, page]) => `| **${term}** | ${def} (tr. ${page}) |`),
        "### Ghi nhớ",
        ...c.points.slice(0, 3).map(([point]) => `- ${point}`),
      ].join("\n"),
      key_points: c.points.map(([point, page]) => ({ point: String(point), page: Number(page) })),
      key_terms: c.terms.map(([term, definition, page]) => ({ term: String(term), definition: String(definition), page: Number(page) })),
    });
    await Question.bulkCreate(
      QUESTIONS[i].map(([type, difficulty, content, options, correct_answer, explanation, source_page, topic]) => ({
        chapter_id: chapter.id, type, difficulty, content, options, correct_answer, explanation, source_page, topic,
      })),
    );
    await Flashcard.bulkCreate(
      c.terms.map(([term, definition, page]) => ({ chapter_id: chapter.id, user_id: user.id, front: String(term), back: `${definition} (tr. ${page})` })),
    );
  }
  console.log(`Demo sẵn sàng: ${EMAIL} / demo123 (document id ${doc.id})`);
  await sequelize.close();
}

await main();
