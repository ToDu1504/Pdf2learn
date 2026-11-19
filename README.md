# Pdf2Learn

**Biến giáo trình PDF thành lộ trình học tiếng Việt, ngay trên máy tính của bạn.**

Mở một file PDF (sách tiếng Anh cũng được), Pdf2Learn tự chia chương và bài theo đúng mục lục của sách, rồi soạn bài giảng tiếng Việt, câu hỏi ôn tập, flashcard, và dịch cả cuốn sách sang tiếng Việt mà vẫn giữ nguyên bố cục trang.

## Tải về

**[Tải Pdf2Learn cho Windows](https://github.com/ToDu1504/Pdf2learn/releases/latest)** (file `Pdf2Learn-Setup-<phiên bản>.exe`)

Chạy file cài đặt là dùng được. Không cần cài thêm cơ sở dữ liệu, không cần tài khoản.

## Pdf2Learn làm được gì

- **Lộ trình học bám sát sách.** Mỗi chặng là một chương, mỗi bài là một mục trong mục lục. Bìa, mục lục, phần ôn tập cuối chương không bị tính là bài học.
- **Bài giảng tiếng Việt có dẫn chứng.** Mỗi ý trong bài đều kèm câu trích nguyên văn và được kiểm tra lại với chữ trong PDF. Bấm vào dẫn chứng để mở đúng trang sách, câu gốc được tô sáng.
- **Câu hỏi của chính cuốn sách.** Đọc câu hỏi ôn tập, đáp án và lời giải in trong sách để bạn làm thử như thi thật.
- **Ôn tập.** Kiểm tra nhanh sau mỗi bài, quiz nhiều chế độ, flashcard lặp lại ngắt quãng (xuất được sang Anki).
- **Gia sư AI.** Hỏi bất cứ điều gì về giáo trình, câu trả lời có ghi số trang.
- **Dịch cả PDF sang tiếng Việt, giữ bố cục.** Xem song song bản gốc và bản dịch, hoặc tải về một file PDF tiếng Việt hoàn chỉnh.
- **Tự chuẩn bị ở nền.** Trong lúc bạn học bài này, app soạn sẵn các bài tiếp theo.

## Bắt đầu

1. Cài và mở app. Lần đầu, app hỏi nơi lưu dữ liệu và **Gemini API key**.
   Lấy key miễn phí tại [aistudio.google.com/apikey](https://aistudio.google.com/apikey). Key được mã hóa và chỉ lưu trên máy bạn.
2. Thêm một file PDF. Vài giây sau lộ trình học hiện ra.
3. Mở một bài để đọc bài giảng, học xong làm "Kiểm tra nhanh". Đạt từ 70% là hoàn thành bài.
4. Muốn đọc bản dịch: vào **Cài đặt → Gói dịch** để tải gói dịch (khoảng 365MB, tải một lần).

## Lưu ý

- **Yêu cầu:** Windows 10/11, có kết nối Internet.
- **Hạn mức Gemini miễn phí** khoảng 20 lượt mỗi ngày cho mỗi model. App gộp nhiều bài vào một lượt và tự chuyển model khi hết lượt; nếu hết hẳn thì các bài còn lại sẽ được soạn vào hôm sau.
- **Dữ liệu của bạn ở trên máy bạn.** Gỡ cài đặt không xóa thư mục dữ liệu.
- **PDF có bookmark (mục lục điện tử)** cho lộ trình chính xác nhất. PDF dạng ảnh scan vẫn học được nhưng không đối chiếu tự động với sách.

## Dành cho nhà phát triển

Mã nguồn app desktop nằm trong [app/](app/):

```bash
cd app
npm install
npm run dev     # chạy thử
npm run dist    # tạo file cài đặt .exe
```

## Giấy phép bên thứ ba

Tính năng dịch PDF giữ bố cục dùng [VI-Translate](https://github.com/breslee1707/VI-Translate) (AGPL-3.0).
