# 📚 Pdf2Learn: Ôn tập giáo trình PDF bằng AI

Upload giáo trình PDF → AI **tách chương, tóm tắt kèm số trang, sinh câu hỏi**, chấm điểm, theo dõi điểm yếu, **gia sư AI** hỏi đáp theo giáo trình, và **đọc to bằng giọng tiếng Việt** (VieNeu-TTS chạy local).

React 19 · TypeScript · Express 5 · MySQL/MariaDB + Sequelize · Gemini API · VieNeu-TTS

## Tính năng

| Nhóm | Chi tiết |
|---|---|
| Xử lý tài liệu | Upload PDF ≤ 50MB, tách chương theo bookmark → mục lục (Gemini) → chia đều; tiến độ realtime (SSE); xử lý tiếp khi server khởi động lại; sửa ranh giới chương |
| Tóm tắt | Tổng quan, ý chính, khái niệm, **mỗi ý kèm số trang**, bấm để mở đúng trang PDF gốc; sơ đồ tư duy Mermaid |
| Quiz | Trắc nghiệm, đúng/sai, tự luận (AI chấm theo rubric); 4 chế độ: theo chương, trộn, **ôn điểm yếu**, thi thử bấm giờ; giải thích từng câu |
| Flashcard | Lặp lại ngắt quãng **SM-2**, phím tắt, xuất CSV cho Anki |
| Gia sư AI | Agent dùng **function calling** (5 tool), stream phản hồi, trích dẫn trang, tạo quiz ngay trong chat |
| Đọc (TTS) | Nghe tóm tắt chương, **highlight câu đang đọc**, mini player khi chuyển trang, tốc độ 0.75–2x, nút 🔊 khắp nơi, gia sư tự đọc, **ôn tập rảnh tay**, tải audio chương |
| Khác | Thống kê điểm/chủ đề yếu/token AI, dark mode, responsive |

## Điểm kỹ thuật nổi bật

- **Workflow vs Agent**: pipeline xử lý PDF do code điều khiển (dễ đoán, rẻ); chỉ gia sư là agent tự chọn tool, có giới hạn vòng lặp và server tự gắn `userId/documentId`.
- **Structured output + Zod**: mọi lời gọi Gemini có `responseSchema`, validate lại bằng Zod, câu hỏi lỗi bị loại riêng lẻ thay vì hỏng cả lô.
- **Hàng đợi nền không cần Redis**: job runner trong process + EventEmitter → SSE; trạng thái từng chương trong DB nên chạy tiếp được sau khi restart.
- **Đúng số trang**: Gemini chỉ thấy file chương đã cắt, số trang được quy đổi về PDF gốc.
- **TTS tối ưu cho CPU**: tạo theo câu, cache theo hash, hàng đợi 1 luồng có ưu tiên (câu đang nghe > tạo sẵn), endpoint audio *long-poll* nên câu đầu phát được ngay.

## Chạy local

Yêu cầu: Node.js 20+, MySQL 8 hoặc MariaDB (XAMPP/Laragon), Gemini API key, (tùy chọn) Python + [uv](https://docs.astral.sh/uv/) cho TTS.

```bash
npm run install:all
cp server/.env.example server/.env        # điền GEMINI_API_KEY, GEMINI_MODEL, DB_*
cd server && npm run db:create && npm run db:migrate
npm run seed:demo                          # (tùy chọn) tài khoản demo@studyai.local / demo123
cd .. && npm run dev:no-tts                # http://localhost:5173
```

### Bật tính năng đọc (VieNeu-TTS)

```bash
git clone https://github.com/pnnbao97/VieNeu-TTS.git tts-service
cd tts-service && uv sync && cd ..
npm run dev                                # chạy TTS + server + client
```

Lần đầu VieNeu tải model từ Hugging Face. Trên CPU không có VNNI (vd. Ryzen Zen 2) giữ bản **fp32**. Khi TTS chưa bật, app vẫn chạy bình thường và tự ẩn các nút 🔊.

## Kiểm thử

```bash
cd server && npm test        # SM-2, tách câu, chuẩn hóa text, quy đổi số trang, WAV, schema AI, hàng đợi TTS
cd server && npm run test:gemini -- giao-trinh.pdf   # thử Gemini với 1 PDF thật
```

## Cấu trúc

```
client/src/  api · components · features/{auth,documents,chapters,quiz,flashcards,stats,tutor,audio,settings} · pages · hooks · stores
server/src/  config · models · routes · services/{ai,tts} · jobs · middlewares · utils
server/migrations · server/scripts (seed-demo, test-gemini) · server/tests
```

## Credits

Giọng đọc: [VieNeu-TTS](https://github.com/pnnbao97/VieNeu-TTS) (Apache-2.0; kiểm tra license model weights trên Hugging Face trước khi công khai sản phẩm).
