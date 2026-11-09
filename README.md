# 📚 Pdf2Learn: Ôn tập giáo trình PDF bằng AI

Upload giáo trình PDF → AI **tách chương, tóm tắt kèm số trang, sinh câu hỏi**, chấm điểm, theo dõi điểm yếu, **gia sư AI** hỏi đáp theo giáo trình, và **bản dịch tiếng Việt giữ nguyên bố cục PDF** ([VI-Translate](https://github.com/breslee1707/VI-Translate)).

React 19 · TypeScript · Express 5 · MySQL/MariaDB + Sequelize · Gemini API · VI-Translate (Python)

## Tính năng

| Nhóm | Chi tiết |
|---|---|
| Xử lý tài liệu | Upload PDF ≤ 50MB, tách chương theo bookmark → mục lục (Gemini) → chia đều; tiến độ realtime (SSE); xử lý tiếp khi server khởi động lại; sửa ranh giới chương |
| Tóm tắt | Tổng quan, ý chính, khái niệm, **mỗi ý kèm số trang**, bấm để mở đúng trang PDF gốc; sơ đồ tư duy Mermaid |
| Quiz | Trắc nghiệm, đúng/sai, tự luận (AI chấm theo rubric); 4 chế độ: theo chương, trộn, **ôn điểm yếu**, thi thử bấm giờ; giải thích từng câu |
| Flashcard | Lặp lại ngắt quãng **SM-2**, phím tắt, xuất CSV cho Anki |
| Gia sư AI | Agent dùng **function calling** (5 tool), stream phản hồi, trích dẫn trang, tạo quiz ngay trong chat |
| Bản dịch | Tab **Bản dịch** trong khung xem PDF: PDF tiếng Việt giữ nguyên hình, bảng, bố cục; dịch theo cụm 10 trang khi mở, lưu lại để mở lần sau |
| Khác | Thống kê điểm/chủ đề yếu/token AI, dark mode, responsive |

## Điểm kỹ thuật nổi bật

- **Workflow vs Agent**: pipeline xử lý PDF do code điều khiển (dễ đoán, rẻ); chỉ gia sư là agent tự chọn tool, có giới hạn vòng lặp và server tự gắn `userId/documentId`.
- **Structured output + Zod**: mọi lời gọi Gemini có `responseSchema`, validate lại bằng Zod, câu hỏi lỗi bị loại riêng lẻ thay vì hỏng cả lô.
- **Hàng đợi nền không cần Redis**: job runner trong process + EventEmitter → SSE; trạng thái từng chương trong DB nên chạy tiếp được sau khi restart.
- **Đúng số trang**: Gemini chỉ thấy file chương đã cắt, số trang được quy đổi về PDF gốc.
- **Dịch PDF giữ bố cục**: VI-Translate tách đoạn và dựng lại PDF, dịch bằng Google qua trình duyệt có sẵn (dự phòng Gemini), dịch sẵn cụm trang kế tiếp; cache theo hash file.

## Chạy local

Yêu cầu: Node.js 20+, MySQL 8 hoặc MariaDB (XAMPP/Laragon), Gemini API key, (tùy chọn) Python + [uv](https://docs.astral.sh/uv/) cho bản dịch PDF.

```bash
npm run install:all
cp server/.env.example server/.env        # điền GEMINI_API_KEY, GEMINI_MODEL, DB_*
cd server && npm run db:create && npm run db:migrate
npm run seed:demo                          # (tùy chọn) tài khoản demo@studyai.local / demo123
cd .. && npm run dev                       # http://localhost:5173
```

### Bật bản dịch PDF (VI-Translate)

```bash
git clone https://github.com/breslee1707/VI-Translate vi-translate
cd vi-translate && uv venv --python 3.12 .venv
uv pip install --python .venv/Scripts/python.exe -r requirements.txt websocket-client==1.9.0
```

Chưa cài thì tab Bản dịch dùng Gemini dịch chữ của trang.

## Kiểm thử

```bash
cd server && npm test        # SM-2, quy đổi số trang, schema AI, hạn mức, tách chương, roadmap
cd server && npm run test:gemini -- giao-trinh.pdf   # thử Gemini với 1 PDF thật
```

## Cấu trúc

```
client/src/  api · components · features/{auth,documents,chapters,quiz,flashcards,stats,tutor,roadmap,settings} · pages · hooks · stores
server/src/  config · models · routes · services/{ai,translate} · jobs · middlewares · utils
server/migrations · server/scripts (seed-demo, test-gemini) · server/tests
```

## Credits

Dịch PDF giữ bố cục: [VI-Translate](https://github.com/breslee1707/VI-Translate) (AGPL-3.0), cài riêng, không đóng gói trong repo này.
