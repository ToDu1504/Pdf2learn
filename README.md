# Pdf2Learn

Biến giáo trình PDF thành một lộ trình học: chia chương và bài theo đúng mục lục của sách, soạn bài giảng tiếng Việt có dẫn chứng đối chiếu với PDF, câu hỏi ôn tập, flashcard, gia sư AI, và bản dịch tiếng Việt giữ nguyên bố cục trang.

Ứng dụng chạy trên máy của bạn (local), dùng Gemini API cho phần AI.

## Tính năng

- **Lộ trình bám sát sách.** Mỗi chặng là một chương, mỗi bài là một mục trong mục lục (bookmark) của PDF. Phần bìa, mục lục và ôn tập cuối chương không bị tính là bài học. Khung "Đối chiếu với sách" liệt kê mọi đoạn trang không thành bài, kèm lý do.
- **Bài giảng có kiểm chứng.** AI phải kèm câu trích nguyên văn cho từng ý, và code đối chiếu câu trích với chữ trong PDF. Ý nào không tìm thấy trong sách thì bị loại hoặc gắn nhãn "chưa kiểm chứng". Bấm vào một dẫn chứng sẽ mở đúng trang PDF và tô sáng câu gốc. App cũng cảnh báo khi bài giảng bỏ sót mục nào của sách.
- **Câu hỏi của sách.** Đọc câu hỏi ôn tập in trong sách, đáp án và lời giải ở phụ lục (ví dụ "Do I Know This Already?" của Cisco Press, Review Questions của Sybex), cùng thuật ngữ cần nắm và bài lab. Phần này đọc bằng code, không tốn lượt AI.
- **Ôn tập.** Kiểm tra nhanh sau mỗi bài, quiz với 4 chế độ (theo chương, trộn, ôn điểm yếu, thi thử), flashcard lặp lại ngắt quãng (SM-2) và xuất CSV cho Anki.
- **Gia sư AI.** Hỏi đáp theo giáo trình, trích dẫn số trang, tạo quiz ngay trong khung chat.
- **Bản dịch tiếng Việt giữ bố cục.** Xem bản dịch theo từng cụm 10 trang, hoặc dịch toàn bộ PDF ở nền rồi tải về một file. Dịch bằng Google Dịch trên trình duyệt nên không tốn lượt AI, nhờ [VI-Translate](https://github.com/breslee1707/VI-Translate).
- **Vòng học hằng ngày.** Khối "Hôm nay" gồm bài học tiếp theo và số thẻ đến hạn ôn; trang thống kê điểm số và chủ đề yếu.

## Yêu cầu

- Node.js 20 trở lên
- MySQL 8 hoặc MariaDB 10.4 trở lên (ví dụ Laragon, XAMPP)
- [Gemini API key](https://aistudio.google.com/apikey)
- Tùy chọn, để có bản dịch PDF giữ bố cục: Python 3.12, [uv](https://docs.astral.sh/uv/) và Google Chrome (hoặc Edge, Brave, Cốc Cốc, Firefox)

## Cài đặt

```bash
git clone https://github.com/ToDu1504/Pdf2learn.git
cd Pdf2learn
npm run install:all
cp server/.env.example server/.env
```

Mở `server/.env` và điền ít nhất:

| Biến | Ý nghĩa |
|---|---|
| `GEMINI_API_KEY` | Khóa Gemini API |
| `GEMINI_MODEL` | Model chính, ví dụ `gemini-3.8-flash` |
| `GEMINI_FALLBACK_MODELS` | Các model dùng tiếp khi model chính hết hạn mức trong ngày |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | Kết nối MySQL/MariaDB |
| `JWT_SECRET` | Chuỗi bí mật bất kỳ, đủ dài |

Tạo cơ sở dữ liệu rồi chạy:

```bash
cd server
npm run db:create
npm run db:migrate
npm run seed:demo      # tùy chọn: tài khoản demo@studyai.local / demo123 có sẵn 1 tài liệu mẫu
cd ..
npm run dev            # mở http://localhost:5173
```

### Bật bản dịch PDF giữ bố cục (tùy chọn)

Clone VI-Translate vào thư mục `vi-translate/` ở gốc dự án (thư mục này đã nằm trong `.gitignore`):

```bash
git clone https://github.com/breslee1707/VI-Translate vi-translate
cd vi-translate
uv venv --python 3.12 .venv
uv pip install --python .venv/Scripts/python.exe -r requirements.txt websocket-client==1.9.0
```

Trên macOS/Linux, thay `.venv/Scripts/python.exe` bằng `.venv/bin/python`. Muốn dùng trình duyệt khác Chrome thì đặt `TRANSLATE_BROWSER` trong `server/.env`.

Nếu không cài VI-Translate, tab "Bản dịch" vẫn dùng được nhưng chỉ dịch chữ của trang bằng Gemini.

## Sử dụng

1. Đăng ký tài khoản, tải PDF lên ở trang chủ. Vài giây sau lộ trình học hiện ra.
2. Mở một bài: AI soạn bài giảng ngay lúc đó, kèm luôn vài bài kế tiếp trong cùng một lượt gọi.
3. Học xong thì làm "Kiểm tra nhanh". Đạt từ 70% trở lên thì bài được đánh dấu hoàn thành và flashcard của bài vào lịch ôn.
4. Cuối mỗi chặng, bấm "Câu hỏi của sách" để làm câu hỏi ôn tập in trong sách, chấm theo đáp án của sách.
5. Dịch PDF: mở tab "Bản dịch" trong khung xem PDF, hoặc vào menu "…" của tài liệu → "Dịch toàn bộ PDF".

## Lưu ý

- **Hạn mức Gemini.** Gói miễn phí chỉ có khoảng 20 lượt gọi mỗi ngày cho mỗi model. App gộp nhiều bài vào một lượt, chép lại kết quả cho file PDF trùng nhau, và tự chuyển sang model dự phòng khi model đang dùng hết lượt. Hết lượt ở mọi model thì các bài chưa soạn sẽ chờ tới hôm sau.
- **CAPTCHA của Google.** Khi dịch nhiều, Google có thể đòi xác minh. Cửa sổ trình duyệt sẽ bật lên: hãy giải CAPTCHA và để cửa sổ mở.
- **PDF dạng ảnh scan.** App vẫn soạn được bài, nhưng không đối chiếu tự động được với sách. Lộ trình bám sát nhất khi PDF có bookmark.

## Phát triển

```bash
cd server && npm test            # unit test (vitest)
cd server && npm run typecheck
cd client && npm run build
```

Kiến trúc, quy ước và các quyết định thiết kế được ghi trong [CLAUDE.md](CLAUDE.md). Một vài test đối chiếu lộ trình với mục lục của sách thật cần file trong `server/tests/fixtures/`. Các file này không có trong repo vì là sách có bản quyền; thiếu file thì những test đó tự bỏ qua.

## Giấy phép bên thứ ba

Dịch PDF giữ bố cục dùng [VI-Translate](https://github.com/breslee1707/VI-Translate) (AGPL-3.0). Công cụ này được cài riêng và không đóng gói trong repo.
