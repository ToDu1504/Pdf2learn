# 📚 StudyAI: Web ôn tập giáo trình PDF bằng AI

> Kế hoạch triển khai **dự án cá nhân**, chạy local, không dùng Docker
> Stack: React + TypeScript · Node.js/Express · MySQL/Sequelize · Gemini API · VieNeu-TTS (đọc tiếng Việt)

---

## Mục lục

1. [Tổng quan](#1-tổng-quan)
2. [Phạm vi tính năng](#2-phạm-vi-tính-năng)
3. [Kiến trúc hệ thống](#3-kiến-trúc-hệ-thống)
4. [Công nghệ sử dụng](#4-công-nghệ-sử-dụng)
5. [Cấu trúc thư mục](#5-cấu-trúc-thư-mục)
6. [Thiết kế cơ sở dữ liệu](#6-thiết-kế-cơ-sở-dữ-liệu)
7. [Thiết kế API](#7-thiết-kế-api)
8. [Xử lý nền không cần Redis](#8-xử-lý-nền-không-cần-redis)
9. [Thiết kế phần AI: Workflow](#9-thiết-kế-phần-ai-workflow)
10. [Thiết kế phần AI: Agent "Gia sư AI"](#10-thiết-kế-phần-ai-agent-gia-sư-ai)
11. [Tính năng đọc (Text-to-Speech) với VieNeu-TTS](#11-tính-năng-đọc-text-to-speech-với-vieneu-tts)
12. [Prompt mẫu](#12-prompt-mẫu)
13. [Thuật toán Flashcard SM-2](#13-thuật-toán-flashcard-sm-2)
14. [Giao diện (các màn hình)](#14-giao-diện-các-màn-hình)
15. [Cài đặt & chạy local](#15-cài-đặt--chạy-local)
16. [Lộ trình triển khai](#16-lộ-trình-triển-khai)
17. [Rủi ro & cách xử lý](#17-rủi-ro--cách-xử-lý)
18. [Checklist hoàn thiện cho portfolio](#18-checklist-hoàn-thiện-cho-portfolio)

---

## 1. Tổng quan

### 1.1 Vấn đề
Giáo trình PDF thường dày hàng trăm trang. Người học khó nắm ý chính và không có bộ câu hỏi để tự kiểm tra kiến thức.

### 1.2 Giải pháp
Upload giáo trình PDF. Hệ thống dùng Gemini để:
- Tách giáo trình thành **từng chương**
- **Tóm tắt** kiến thức trọng tâm từng chương, kèm số trang
- **Sinh câu hỏi ôn tập** (trắc nghiệm, đúng/sai, tự luận) theo độ khó
- **Chấm điểm, giải thích** câu sai, theo dõi điểm yếu
- **Gia sư AI**: chat hỏi đáp dựa trên nội dung giáo trình
- **Đọc to bằng giọng tiếng Việt tự nhiên** (VieNeu-TTS): nghe tóm tắt chương, nghe câu hỏi và giải thích, nghe gia sư AI trả lời, ôn tập rảnh tay

### 1.3 Mục tiêu dự án cá nhân
- Có sản phẩm hoàn chỉnh để đưa vào **portfolio / CV**
- Luyện tích hợp AI thực tế: structured output, function calling, agent
- Giao diện đẹp, mượt, responsive: đây là phần nhà tuyển dụng nhìn thấy đầu tiên
- **Chạy local đơn giản**: Node.js + MySQL (+ Python/uv cho TTS), không cần Docker hay Redis

---

## 2. Phạm vi tính năng

### 2.1 MVP (bắt buộc)
- [ ] Đăng ký / đăng nhập (JWT)
- [ ] Upload PDF (≤ 50MB)
- [ ] Tự động tách chương (bookmark/mục lục PDF → fallback dùng Gemini)
- [ ] Tóm tắt từng chương (ý chính, khái niệm, số trang)
- [ ] Sinh câu hỏi trắc nghiệm + đúng/sai theo chương
- [ ] Làm bài, chấm điểm, giải thích đáp án
- [ ] Hiển thị tiến độ xử lý tài liệu realtime

### 2.2 Mở rộng (nên có)
- [ ] Lịch sử làm bài, thống kê điểm theo chương
- [ ] Phân tích chủ đề yếu → tạo bài ôn riêng
- [ ] Chọn độ khó (Dễ / Trung bình / Khó, theo thang Bloom)
- [ ] Câu tự luận ngắn + AI chấm theo rubric
- [ ] Flashcard với lặp lại ngắt quãng (SM-2)
- [ ] Chế độ thi thử (bấm giờ, trộn nhiều chương)

### 2.3 Nâng cao (điểm nhấn portfolio)
- [ ] **Gia sư AI (Agent)**: chat với giáo trình, dùng Function Calling, stream phản hồi
- [ ] Sơ đồ tư duy từng chương (Mermaid)
- [ ] Click số trang → mở PDF gốc đúng trang đó
- [ ] Xuất flashcard ra Anki (CSV)
- [ ] Dark mode
- [ ] Trang thống kê token AI đã dùng

### 2.4 Tính năng đọc (VieNeu-TTS)
- [ ] **Nghe tóm tắt chương**: trình phát có play/pause, tua câu trước/sau, tốc độ 0.75x–2x
- [ ] **Highlight câu đang đọc** (karaoke) trên tóm tắt
- [ ] **Mini player** nổi, vẫn phát khi chuyển trang
- [ ] Nút 🔊 đọc từng câu hỏi, đáp án, giải thích
- [ ] Gia sư AI **tự đọc câu trả lời** (bật/tắt trong cài đặt)
- [ ] **Chế độ ôn tập rảnh tay**: đọc câu hỏi → chờ vài giây → đọc đáp án + giải thích (dùng cho quiz và flashcard)
- [ ] Chọn giọng đọc (25 giọng có sẵn, giọng Bắc / Trung / Nam)
- [ ] Tải file audio tóm tắt chương để nghe offline
- [ ] (Tùy chọn) **Nhân bản giọng của chính mình** từ đoạn ghi âm 3–8 giây

---

## 3. Kiến trúc hệ thống

```
┌──────────────────┐   HTTP / SSE   ┌──────────────────────────────┐
│  React + TS      │◄──────────────►│  Express API (1 process)     │
│  Vite, Tailwind  │                │  ├─ Auth (JWT)               │
└──────────────────┘                │  ├─ Upload (Multer)          │
                                    │  ├─ REST endpoints           │
                                    │  ├─ Job Runner (xử lý nền)   │──► Gemini API
                                    │  └─ TTS Queue                │
                                    └───┬─────────────┬────────┬───┘
                                        │             │        │ HTTP (localhost:8000)
                                ┌───────▼──────┐ ┌────▼──────┐ ┌▼─────────────────────────┐
                                │ MySQL        │ │ ./uploads │ │ VieNeu-TTS server        │
                                │ (Sequelize)  │ │ PDF + WAV │ │ (Python, OpenAI-compat.) │
                                └──────────────┘ └───────────┘ │ POST /v1/audio/speech    │
                                                               └──────────────────────────┘
```

> **VieNeu-TTS** là project Python nên chạy thành **một process riêng** (không cần Docker): `uv run python -m apps.openai_speech`. Express gọi nó qua HTTP như gọi một API bình thường. Frontend **không gọi trực tiếp** TTS server.

**Nguyên tắc:**
- Chỉ có **1 server Express**. Việc xử lý PDF chạy nền ngay trong process bằng một **hàng đợi đơn giản tự viết** (xem mục 8). Không cần Redis/BullMQ.
- Trạng thái xử lý lưu ở **MySQL**, nên server tắt giữa chừng thì khi bật lại vẫn **xử lý tiếp được**.
- API key Gemini **chỉ nằm ở backend** (`.env`).
- Kết quả AI **lưu vào DB**: mỗi tài liệu chỉ xử lý một lần.

---

## 4. Công nghệ sử dụng

| Tầng | Công nghệ | Ghi chú |
|---|---|---|
| Frontend | React 18 + TypeScript + Vite | |
| UI | TailwindCSS + shadcn/ui | Dark mode sẵn |
| State / Fetch | TanStack Query, Zustand | |
| Render | react-markdown, mermaid, react-pdf | Tóm tắt, sơ đồ, xem PDF gốc |
| Biểu đồ | Recharts | Trang thống kê |
| Backend | Node.js 20+ · Express · TypeScript | |
| ORM | Sequelize + sequelize-cli + MySQL 8 | Migrations & seeders |
| Xử lý nền | Job runner tự viết + EventEmitter | Không cần Redis |
| Realtime | Server-Sent Events (SSE) | Báo tiến độ |
| PDF | `pdfjs-dist`, `pdf-lib` | Đọc bookmark, cắt trang theo chương |
| AI | `@google/genai` (Gemini SDK) | Model dòng Flash cho tiết kiệm |
| Validate | Zod | Validate request + JSON từ AI |
| Auth | JWT + bcrypt | |
| TTS | **VieNeu-TTS v3 Turbo** (Python, `uv`) | Giọng tiếng Việt, 48 kHz, chạy được trên CPU |
| Audio (FE) | `HTMLAudioElement` + Zustand player store | Phát theo hàng đợi câu |
| Audio (BE) | `wav-file-info` / tự đọc header WAV | Lấy thời lượng để highlight |
| Dev tools | `tsx`, `nodemon`, `concurrently`, ESLint, Prettier | |

---

## 5. Cấu trúc thư mục

```
studyai/
├── client/                         # React frontend
│   ├── src/
│   │   ├── api/                    # axios instance + hàm gọi API
│   │   ├── components/             # UI dùng chung
│   │   ├── features/
│   │   │   ├── auth/
│   │   │   ├── documents/          # upload, danh sách, chi tiết
│   │   │   ├── chapters/           # tóm tắt, sơ đồ tư duy
│   │   │   ├── quiz/               # làm bài, kết quả
│   │   │   ├── flashcards/
│   │   │   ├── stats/
│   │   │   ├── tutor/              # chat gia sư AI
│   │   │   └── audio/              # AudioPlayer, MiniPlayer, SpeakButton, playerStore
│   │   ├── hooks/                  # useDocumentProgress (SSE)...
│   │   ├── pages/
│   │   ├── routes/
│   │   └── types/
│   └── vite.config.ts              # proxy /api → localhost:5000
│
├── server/                         # Express backend
│   ├── src/
│   │   ├── config/                 # env, db, gemini
│   │   ├── models/
│   │   ├── routes/
│   │   ├── controllers/
│   │   ├── services/
│   │   │   ├── ai/
│   │   │   │   ├── gemini.client.ts
│   │   │   │   ├── prompts/
│   │   │   │   ├── schemas/
│   │   │   │   ├── summarize.service.ts
│   │   │   │   ├── quiz.service.ts
│   │   │   │   ├── grading.service.ts
│   │   │   │   └── tutor.agent.ts
│   │   │   ├── tts/
│   │   │   │   ├── tts.client.ts       # gọi VieNeu server
│   │   │   │   ├── textNormalizer.ts   # làm sạch text trước khi đọc
│   │   │   │   ├── sentenceSplitter.ts # tách câu
│   │   │   │   ├── ttsQueue.ts         # hàng đợi TTS (1 luồng trên CPU)
│   │   │   │   └── tts.service.ts      # cache + tạo audio
│   │   │   ├── pdf.service.ts
│   │   │   └── srs.service.ts      # SM-2
│   │   ├── jobs/
│   │   │   ├── jobRunner.ts        # hàng đợi đơn giản
│   │   │   ├── progressBus.ts      # EventEmitter cho SSE
│   │   │   └── processDocument.ts  # pipeline xử lý tài liệu
│   │   ├── middlewares/            # auth, error, rateLimit, upload
│   │   ├── utils/                  # withRetry, logger...
│   │   └── app.ts
│   ├── migrations/
│   ├── seeders/
│   ├── uploads/                    # (gitignore)
│   │   ├── pdf/
│   │   └── audio/                  # cache WAV
│   └── .env.example
│
├── tts-service/                    # git clone VieNeu-TTS vào đây (gitignore)
│
├── package.json                    # script chạy cả client + server
└── README.md
```

---

## 6. Thiết kế cơ sở dữ liệu

### 6.1 Sơ đồ quan hệ

```
users 1──n documents 1──n chapters 1──1 summaries
                              ├──n questions
                              └──n flashcards
users 1──n quiz_attempts 1──n attempt_answers n──1 questions
users 1──n tutor_sessions 1──n tutor_messages
users 1──n ai_usage_logs
users 1──1 user_settings
chapters 1──n chapter_audio_segments n──1 tts_audios
```

### 6.2 Chi tiết bảng

**users**
| Cột | Kiểu | Ghi chú |
|---|---|---|
| id | INT PK | |
| email | VARCHAR UNIQUE | |
| password_hash | VARCHAR | |
| full_name | VARCHAR | |
| created_at, updated_at | DATETIME | |

**documents**
| Cột | Kiểu | Ghi chú |
|---|---|---|
| id | INT PK | |
| user_id | FK → users | |
| title | VARCHAR | |
| file_path | VARCHAR | Đường dẫn trong `./uploads` |
| file_size, page_count | INT | |
| status | ENUM('queued','processing','done','failed') | |
| current_step | VARCHAR | 'split', 'summarize'... (để resume) |
| progress | TINYINT | 0–100 |
| error_message | TEXT NULL | |

**chapters**
| Cột | Kiểu | Ghi chú |
|---|---|---|
| id | INT PK | |
| document_id | FK | |
| order_index | INT | |
| title | VARCHAR | |
| start_page, end_page | INT | |
| gemini_file_uri | VARCHAR NULL | File chương đã upload lên Gemini |
| status | ENUM('pending','done','failed') | Chương nào xong rồi thì bỏ qua khi resume |

**summaries**
| Cột | Kiểu | Ghi chú |
|---|---|---|
| id | INT PK | |
| chapter_id | FK UNIQUE | |
| overview | TEXT | |
| key_points | JSON | `[{point, page}]` |
| key_terms | JSON | `[{term, definition, page}]` |
| mindmap_mermaid | TEXT NULL | |

**questions**
| Cột | Kiểu | Ghi chú |
|---|---|---|
| id | INT PK | |
| chapter_id | FK | |
| type | ENUM('mcq','true_false','short_answer') | |
| difficulty | ENUM('easy','medium','hard') | |
| content | TEXT | |
| options | JSON NULL | |
| correct_answer | TEXT | |
| explanation | TEXT | |
| source_page | INT | |
| topic | VARCHAR | Dùng để phân tích điểm yếu |

**quiz_attempts**
| Cột | Kiểu | Ghi chú |
|---|---|---|
| id | INT PK | |
| user_id, document_id | FK | |
| mode | ENUM('chapter','mixed','weak','exam') | |
| total_questions, correct_count | INT | |
| score | DECIMAL(5,2) | |
| started_at, finished_at | DATETIME | |

**attempt_answers**
| Cột | Kiểu | Ghi chú |
|---|---|---|
| id | INT PK | |
| attempt_id, question_id | FK | |
| user_answer | TEXT | |
| is_correct | BOOLEAN | |
| ai_score | DECIMAL NULL | Câu tự luận |
| ai_feedback | TEXT NULL | |

**flashcards**
| Cột | Kiểu | Ghi chú |
|---|---|---|
| id | INT PK | |
| chapter_id, user_id | FK | |
| front, back | TEXT | |
| ease_factor | FLOAT | Mặc định 2.5 |
| interval_days, repetitions | INT | |
| next_review_at | DATETIME | |

**tutor_sessions / tutor_messages**
| Cột | Kiểu | Ghi chú |
|---|---|---|
| id | INT PK | |
| session_id | FK | (sessions: user_id, document_id, title) |
| role | ENUM('user','model','tool') | |
| content | TEXT | |
| tool_calls | JSON NULL | Log tool agent đã gọi |

**ai_usage_logs**
| Cột | Kiểu | Ghi chú |
|---|---|---|
| id | INT PK | |
| user_id | FK | |
| feature | VARCHAR | split / summarize / quiz / grade / tutor |
| input_tokens, output_tokens | INT | Lấy từ `usageMetadata` |
| created_at | DATETIME | |

**tts_audios**: cache audio, dùng chung cho mọi nơi cần đọc
| Cột | Kiểu | Ghi chú |
|---|---|---|
| id | INT PK | |
| hash | CHAR(64) UNIQUE | `sha256(model + voice + normalizedText)` |
| voice | VARCHAR | Tên giọng, ví dụ "Mai Anh" |
| text | TEXT | Text đã chuẩn hóa |
| file_path | VARCHAR | `uploads/audio/<hash>.wav` |
| duration_ms | INT | Dùng để hiển thị thời lượng |
| status | ENUM('pending','done','failed') | |
| created_at | DATETIME | |

**chapter_audio_segments**: tóm tắt chương = danh sách câu
| Cột | Kiểu | Ghi chú |
|---|---|---|
| id | INT PK | |
| chapter_id | FK | |
| voice | VARCHAR | |
| order_index | INT | Thứ tự câu |
| display_text | TEXT | Câu gốc hiển thị (để highlight) |
| tts_audio_id | FK → tts_audios | |

**user_settings**
| Cột | Kiểu | Ghi chú |
|---|---|---|
| user_id | FK PK | |
| tts_voice | VARCHAR | Mặc định "Hải Đăng" |
| tts_rate | FLOAT | Tốc độ phát 0.75–2.0 |
| auto_read_tutor | BOOLEAN | Gia sư AI tự đọc câu trả lời |
| theme | ENUM('light','dark','system') | |

---

## 7. Thiết kế API

Prefix: `/api/v1` · Auth: `Authorization: Bearer <token>`

### Auth
| Method | Endpoint | Mô tả |
|---|---|---|
| POST | `/auth/register` | Đăng ký |
| POST | `/auth/login` | Đăng nhập, trả JWT |
| GET | `/auth/me` | Thông tin người dùng |

### Documents
| Method | Endpoint | Mô tả |
|---|---|---|
| POST | `/documents` | Upload PDF, đưa vào hàng đợi xử lý |
| GET | `/documents` | Danh sách tài liệu |
| GET | `/documents/:id` | Chi tiết + danh sách chương |
| GET | `/documents/:id/progress` | **SSE**: tiến độ xử lý |
| GET | `/documents/:id/file` | Trả file PDF gốc (cho react-pdf) |
| PATCH | `/documents/:id/chapters` | Sửa ranh giới chương nếu AI tách sai |
| POST | `/documents/:id/retry` | Xử lý lại khi lỗi |
| DELETE | `/documents/:id` | Xóa tài liệu + file |

### Chapters
| Method | Endpoint | Mô tả |
|---|---|---|
| GET | `/chapters/:id` | Tóm tắt, khái niệm, sơ đồ |
| POST | `/chapters/:id/questions/generate` | Sinh thêm câu hỏi `{type, difficulty, count}` |
| POST | `/chapters/:id/mindmap` | Sinh sơ đồ tư duy (gọi khi cần) |

### Quiz & thống kê
| Method | Endpoint | Mô tả |
|---|---|---|
| POST | `/quizzes` | Tạo lượt làm bài `{documentId, mode, chapterIds?, count, difficulty?}` |
| POST | `/quizzes/:id/submit` | Nộp bài, trả kết quả + giải thích |
| GET | `/quizzes/history` | Lịch sử làm bài |
| GET | `/stats/overview` | Điểm TB, số bài, thẻ cần ôn |
| GET | `/stats/weak-topics?documentId=` | Chủ đề hay sai |
| GET | `/stats/ai-usage` | Token đã dùng theo ngày / tính năng |

### Flashcards
| Method | Endpoint | Mô tả |
|---|---|---|
| GET | `/flashcards/due` | Thẻ cần ôn hôm nay |
| POST | `/flashcards/:id/review` | `{quality: 0-5}` |
| GET | `/flashcards/export?documentId=` | Xuất CSV cho Anki |

### Tutor (Agent)
| Method | Endpoint | Mô tả |
|---|---|---|
| POST | `/tutor/sessions` | Tạo phiên chat cho 1 tài liệu |
| POST | `/tutor/sessions/:id/messages` | Gửi tin nhắn (stream phản hồi qua SSE) |
| GET | `/tutor/sessions/:id` | Lịch sử chat |

### TTS (đọc)
| Method | Endpoint | Mô tả |
|---|---|---|
| GET | `/tts/status` | TTS server có đang chạy không (FE ẩn/hiện nút 🔊) |
| GET | `/tts/voices` | Danh sách giọng (proxy `GET /v1/voices`) |
| POST | `/tts/speak` | `{text, voice?}` → tách câu, trả `[{text, audioUrl}]` (đọc câu hỏi, giải thích, câu trả lời gia sư) |
| GET | `/tts/audio/:hash` | Trả file WAV (hỗ trợ Range để tua) |
| POST | `/chapters/:id/audio` | `{voice?}` → chuẩn bị audio tóm tắt chương, trả danh sách câu + trạng thái |
| GET | `/chapters/:id/audio?voice=` | Danh sách câu đã có audio (FE poll hoặc SSE) |
| GET | `/chapters/:id/audio/download` | Ghép các câu thành 1 file WAV để tải về |
| POST | `/tts/voices/clone` | (Tùy chọn) Upload clip 3–8s giọng của mình |

### Cài đặt người dùng
| Method | Endpoint | Mô tả |
|---|---|---|
| GET | `/users/me/settings` | Lấy cài đặt |
| PATCH | `/users/me/settings` | `{tts_voice, tts_rate, auto_read_tutor, theme}` |

---

## 8. Xử lý nền không cần Redis

Một giáo trình 300 trang có thể mất vài phút để xử lý, nên **không được bắt request upload chờ**. Thay cho BullMQ + Redis, ta dùng 3 thành phần đơn giản:

### 8.1 Job runner: hàng đợi chạy lần lượt từng tài liệu

```ts
// jobs/jobRunner.ts
type Job = () => Promise<void>;

class JobRunner {
  private queue: Job[] = [];
  private running = false;

  add(job: Job) {
    this.queue.push(job);
    this.next();
  }

  private async next() {
    if (this.running) return;
    const job = this.queue.shift();
    if (!job) return;
    this.running = true;
    try { await job(); }
    catch (err) { console.error("[job] failed:", err); }
    finally { this.running = false; this.next(); }
  }
}

export const jobRunner = new JobRunner(); // concurrency = 1, an toàn với rate limit
```

### 8.2 Progress bus: đẩy tiến độ cho SSE

```ts
// jobs/progressBus.ts
import { EventEmitter } from "events";
export const progressBus = new EventEmitter();

export async function setProgress(doc: Document, progress: number, step: string) {
  await doc.update({ progress, current_step: step });
  progressBus.emit(`doc:${doc.id}`, { progress, step, status: doc.status });
}

// controller SSE
router.get("/documents/:id/progress", auth, (req, res) => {
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  const listener = (data: unknown) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  progressBus.on(`doc:${req.params.id}`, listener);
  req.on("close", () => progressBus.off(`doc:${req.params.id}`, listener));
});
```

> EventSource của trình duyệt không gửi được header `Authorization`. Có 2 cách: truyền token qua query (`?token=`) hoặc dùng thư viện `@microsoft/fetch-event-source`.

### 8.3 Resume khi server khởi động lại

```ts
// app.ts — sau khi kết nối DB
const pending = await Document.findAll({ where: { status: ["queued", "processing"] } });
pending.forEach((doc) => jobRunner.add(() => processDocument(doc.id)));
```

`processDocument` kiểm tra `chapters.status`, **chương nào `done` rồi thì bỏ qua**, nên không tốn lại token.

### 8.4 Retry khi Gemini lỗi

```ts
// utils/withRetry.ts
export async function withRetry<T>(fn: () => Promise<T>, retries = 3, delay = 2000): Promise<T> {
  try { return await fn(); }
  catch (err: any) {
    const retryable = [429, 500, 503].includes(err?.status);
    if (!retryable || retries === 0) throw err;
    await new Promise((r) => setTimeout(r, delay));
    return withRetry(fn, retries - 1, delay * 2); // exponential backoff
  }
}
```

---

## 9. Thiết kế phần AI: Workflow

> Các bước xử lý tài liệu chạy theo **luồng cố định do code điều khiển**. AI không tự quyết bước tiếp theo.

### 9.1 Pipeline `processDocument`

```
[queued] → 1. Đọc metadata PDF → 2. Tách chương → 3. Cắt PDF + upload lên Gemini File API
        → 4. Với mỗi chương: Tóm tắt → Sinh câu hỏi → Sinh flashcard
        → [done]
```

| Bước | Cách làm | Progress |
|---|---|---|
| 1 | Đọc số trang, bookmark (outline) bằng `pdfjs-dist` | 5% |
| 2 | Có bookmark → dùng luôn. Không có → gửi ~15 trang đầu cho Gemini, yêu cầu JSON `[{title, start_page, end_page}]` | 15% |
| 3 | Cắt từng chương bằng `pdf-lib`, upload lên File API, lưu `gemini_file_uri` | 25% |
| 4 | Lặp từng chương (structured output), xong chương nào thì đánh dấu `done` | 25% → 100% |

### 9.2 Nguyên tắc gọi AI
- **Structured Output**: `responseMimeType: "application/json"` + `responseSchema`, sau đó validate lại bằng Zod.
- **Bọc mọi lời gọi trong `withRetry`**.
- **Chạy tuần tự** (job runner concurrency = 1) để không vượt rate limit gói miễn phí.
- **Ghi token** từ `response.usageMetadata` vào `ai_usage_logs`.
- **Grounding**: prompt yêu cầu *chỉ dùng nội dung tài liệu* và *bắt buộc ghi số trang*.
- File trên Gemini File API chỉ tồn tại có thời hạn. Nếu chương cần dùng lại sau này (sinh thêm câu hỏi, gia sư AI) mà file đã hết hạn thì **upload lại từ file local**.

### 9.3 Ví dụ code

```ts
// services/ai/gemini.client.ts
import { GoogleGenAI } from "@google/genai";
export const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
export const MODEL = process.env.GEMINI_MODEL!;

// services/ai/summarize.service.ts
export async function summarizeChapter(fileUri: string, chapterTitle: string) {
  const res = await withRetry(() =>
    ai.models.generateContent({
      model: MODEL,
      contents: [{
        role: "user",
        parts: [
          { fileData: { fileUri, mimeType: "application/pdf" } },
          { text: buildSummaryPrompt(chapterTitle) },
        ],
      }],
      config: { responseMimeType: "application/json", responseSchema: summarySchema, temperature: 0.3 },
    })
  );
  return { data: SummaryZod.parse(JSON.parse(res.text!)), usage: res.usageMetadata };
}
```

### 9.4 JSON Schema câu hỏi

```ts
export const quizSchema = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type:           { type: "string", enum: ["mcq", "true_false"] },
          difficulty:     { type: "string", enum: ["easy", "medium", "hard"] },
          content:        { type: "string" },
          options:        { type: "array", items: { type: "string" } },
          correct_answer: { type: "string" },
          explanation:    { type: "string" },
          source_page:    { type: "integer" },
          topic:          { type: "string" },
        },
        required: ["type", "difficulty", "content", "correct_answer", "explanation", "source_page", "topic"],
      },
    },
  },
  required: ["questions"],
};
```

---

## 10. Thiết kế phần AI: Agent "Gia sư AI"

> Đây là phần **duy nhất** dùng Agent: người học hỏi tự do, AI **tự chọn tool** để lấy thông tin rồi trả lời.

### 10.1 Danh sách tool (Function Calling)

| Tool | Tham số | Chức năng | Loại |
|---|---|---|---|
| `list_chapters` | — | Danh sách chương | Đọc |
| `get_chapter_summary` | `chapterId` | Tóm tắt chương | Đọc |
| `read_chapter` | `chapterId, question` | Gửi file chương cho Gemini, trả đoạn liên quan + số trang | Đọc |
| `get_weak_topics` | — | Chủ đề người học hay sai | Đọc |
| `create_quiz` | `chapterId, difficulty, count` | Tạo bài ôn nhanh trong chat | Tạo |

> MVP của agent: `read_chapter` gửi luôn file chương cho Gemini. Nếu muốn nâng cấp sau này: tạo **embeddings** cho từng đoạn và tìm theo độ tương đồng (RAG) để nhanh và rẻ hơn.

### 10.2 Vòng lặp agent

```
1. Nhận câu hỏi + lịch sử chat
2. Gọi Gemini kèm danh sách tool
3. Gemini trả functionCall → backend chạy tool (gắn userId/documentId từ server)
   → gửi kết quả lại → lặp lại (tối đa 5 vòng)
4. Gemini trả text → stream về client
```

### 10.3 Ràng buộc an toàn
- Tối đa **5 vòng** gọi tool mỗi câu hỏi.
- Không có tool xóa/sửa dữ liệu.
- `userId`, `documentId` **do server gắn**, không lấy từ tham số AI.
- Chỉ trả lời trong phạm vi giáo trình; không có thông tin thì nói rõ.
- Giới hạn tin nhắn (ví dụ 30 tin/giờ) bằng `express-rate-limit`.

### 10.4 Code khung

```ts
// services/ai/tutor.agent.ts
const MAX_STEPS = 5;

export async function runTutor(ctx: { userId: number; documentId: number }, history: Content[]) {
  for (let step = 0; step < MAX_STEPS; step++) {
    const res = await ai.models.generateContent({
      model: MODEL,
      contents: history,
      config: { systemInstruction: TUTOR_SYSTEM_PROMPT, tools: [{ functionDeclarations: toolDeclarations }] },
    });

    const calls = res.functionCalls;
    if (!calls?.length) return res.text;

    history.push(res.candidates![0].content!);
    for (const call of calls) {
      const output = await toolHandlers[call.name!](call.args, ctx);
      history.push({ role: "user", parts: [{ functionResponse: { name: call.name, response: { output } } }] });
    }
  }
  return "Câu hỏi hơi phức tạp, bạn thử hỏi cụ thể hơn nhé.";
}
```

---

## 11. Tính năng đọc (Text-to-Speech) với VieNeu-TTS

> Repo: https://github.com/pnnbao97/VieNeu-TTS · Code: Apache-2.0
> Model dùng: **VieNeu-TTS v3 Turbo** (`pnnbao-ump/VieNeu-TTS-v3-Turbo`): tiếng Việt, 48 kHz, 25 giọng có sẵn, hỗ trợ nhân bản giọng và streaming, **chạy được trên CPU** (ONNX, không cần PyTorch).

### 11.1 Vì sao chọn VieNeu-TTS
- Giọng tiếng Việt tự nhiên hơn nhiều so với Web Speech API của trình duyệt (vốn thường không có giọng `vi-VN` tốt).
- **Chạy local, miễn phí**, không tốn quota Gemini.
- Có sẵn **server API tương thích OpenAI** (`POST /v1/audio/speech`), nên Express chỉ cần gọi HTTP, không phải viết Python.
- Có giọng **Bắc / Trung / Nam**, phù hợp sở thích người nghe.

### 11.2 Hiệu năng trên máy không có GPU rời
Máy dùng Ryzen 7 5700U + card tích hợp, nên VieNeu sẽ chạy **CPU / ONNX**.

| Thông số (benchmark README, Core i5 thế hệ 12) | Giá trị |
|---|---|
| Turbo fp32 (mặc định CPU) | RTF ≈ 0.55–0.62 (10 giây audio mất ~6 giây tạo) |
| Turbo int8 | Nhanh hơn, **nhưng cần CPU có VNNI**. Ryzen 5700U (Zen 2) **không có** → giữ **fp32** để tránh audio bị méo |
| Streaming CPU | Âm thanh đầu tiên sau ~260–400 ms (fp32) |
| Số luồng đồng thời trên CPU | **1** (vượt quá thì server trả 429) |

> RTF (real-time factor) < 1 nghĩa là tạo nhanh hơn thời lượng audio. Số liệu trên máy bạn có thể chậm hơn, **phải đo thử ở Giai đoạn 0**.

**Hệ quả thiết kế:**
1. Tạo audio **theo từng câu** và phát câu đầu ngay khi xong, không chờ cả chương.
2. **Hàng đợi TTS 1 luồng** ở Express, không gửi song song.
3. **Cache** mọi audio đã tạo theo hash, nghe lại không tốn CPU.
4. Ưu tiên request "đang nghe" lên trước request tạo sẵn (prefetch).

### 11.3 Luồng xử lý

```
Text (tóm tắt / câu hỏi / câu trả lời gia sư)
  → textNormalizer   (bỏ markdown, (tr. 12), ký hiệu, mở rộng viết tắt)
  → sentenceSplitter (tách câu, mỗi đoạn ≤ ~200 ký tự)
  → với mỗi câu: hash = sha256(model + voice + text)
        ├─ đã có trong tts_audios → dùng lại
        └─ chưa có → đưa vào ttsQueue → gọi VieNeu → lưu uploads/audio/<hash>.wav
  → FE nhận danh sách [{text, audioUrl, status}] → phát lần lượt + highlight câu
```

### 11.4 Gọi VieNeu server từ Express

```ts
// services/tts/tts.client.ts
const TTS_URL = process.env.TTS_URL!;          // http://localhost:8000/v1
const TTS_MODEL = process.env.TTS_MODEL!;      // vieneu-v3-turbo

export async function synthesize(text: string, voice: string): Promise<Buffer> {
  const res = await fetch(`${TTS_URL}/audio/speech`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer local" },
    body: JSON.stringify({ model: TTS_MODEL, voice, input: text, response_format: "wav" }),
  });
  if (!res.ok) {
    const err: any = new Error(`TTS ${res.status}`);
    err.status = res.status;                     // 429 → withRetry sẽ thử lại
    throw err;
  }
  return Buffer.from(await res.arrayBuffer());
}

export async function listVoices() {
  const res = await fetch(`${TTS_URL}/voices`);
  return res.json();
}

export async function isTtsOnline() {
  try { return (await fetch(TTS_URL.replace(/\/v1$/, "/health"))).ok; }
  catch { return false; }
}
```

### 11.5 Hàng đợi TTS có ưu tiên

```ts
// services/tts/ttsQueue.ts
type Task = { priority: number; run: () => Promise<void> };

class TtsQueue {
  private tasks: Task[] = [];
  private busy = false;

  add(run: () => Promise<void>, priority = 0) {   // 1 = người dùng đang nghe, 0 = tạo sẵn
    this.tasks.push({ priority, run });
    this.tasks.sort((a, b) => b.priority - a.priority);
    this.next();
  }

  private async next() {
    if (this.busy || !this.tasks.length) return;
    this.busy = true;
    const task = this.tasks.shift()!;
    try { await task.run(); } catch (e) { console.error("[tts]", e); }
    finally { this.busy = false; this.next(); }
  }
}
export const ttsQueue = new TtsQueue();
```

### 11.6 Chuẩn hóa text trước khi đọc

```ts
// services/tts/textNormalizer.ts
const ABBR: Record<string, string> = {
  "VD": "ví dụ", "CSDL": "cơ sở dữ liệu", "HĐH": "hệ điều hành",
  "&": " và ", "%": " phần trăm",
};

export function normalizeForSpeech(md: string): string {
  let t = md
    .replace(/```[\s\S]*?```/g, " Đoạn mã, xem trên màn hình. ")   // bỏ code block
    .replace(/\$[^$]+\$/g, " công thức trên màn hình ")              // bỏ công thức LaTeX
    .replace(/\(tr\.\s*\d+(\s*[-–]\s*\d+)?\)/gi, "")                // bỏ trích dẫn (tr. 12)
    .replace(/\[(.*?)\]\(.*?\)/g, "$1")                              // link → chỉ giữ chữ
    .replace(/[#*_`>|]/g, " ")                                       // ký hiệu markdown
    .replace(/\s+/g, " ").trim();
  for (const [k, v] of Object.entries(ABBR)) t = t.replaceAll(k, v);
  return t;
}
```

> Danh sách viết tắt nên **mở rộng dần theo giáo trình thực tế** (nên thay bằng regex có ranh giới từ để không thay nhầm giữa chữ). Cũng cần thử xem VieNeu đọc số, ngày tháng, thuật ngữ tiếng Anh có ổn không trước khi tự viết thêm quy tắc.

### 11.7 Tách câu

```ts
// services/tts/sentenceSplitter.ts
export function splitSentences(text: string, maxLen = 200): string[] {
  const raw = text.match(/[^.!?;:\n]+[.!?;:]?/g) ?? [];
  const out: string[] = [];
  for (let s of raw.map((x) => x.trim()).filter(Boolean)) {
    while (s.length > maxLen) {                     // câu quá dài → cắt ở dấu phẩy gần nhất
      const cut = s.lastIndexOf(",", maxLen);
      const i = cut > 50 ? cut + 1 : maxLen;
      out.push(s.slice(0, i).trim());
      s = s.slice(i).trim();
    }
    if (s.length < 15 && out.length) out[out.length - 1] += " " + s;  // gộp câu quá ngắn
    else if (s) out.push(s);
  }
  return out;
}
```

### 11.8 Các chế độ đọc trong ứng dụng

| Chế độ | Nơi dùng | Cách hoạt động |
|---|---|---|
| **Nghe tóm tắt chương** | Trang tóm tắt | `POST /chapters/:id/audio` → phát lần lượt từng câu, highlight câu đang đọc, tải về được |
| **Đọc nhanh 1 đoạn** | Nút 🔊 cạnh câu hỏi, giải thích, khái niệm | `POST /tts/speak` → phát ngay |
| **Gia sư tự đọc** | Chat gia sư AI | Khi Gemini stream text, gom đủ 1 câu thì gửi `/tts/speak`, phát nối tiếp |
| **Ôn tập rảnh tay** | Quiz / Flashcard | Đọc câu hỏi + các lựa chọn → đếm ngược 5–10 giây → đọc đáp án đúng + giải thích → câu tiếp theo |

### 11.9 Trình phát ở Frontend

```ts
// features/audio/playerStore.ts (Zustand)
type Segment = { text: string; audioUrl?: string; status: "pending" | "done" | "failed" };

interface PlayerState {
  segments: Segment[];
  index: number;          // câu đang đọc → dùng để highlight
  playing: boolean;
  rate: number;           // 0.75 – 2.0
  load(segments: Segment[]): void;
  play(): void; pause(): void; next(): void; prev(): void;
  setRate(r: number): void;
}
```

- Dùng **một `HTMLAudioElement` duy nhất**: hết câu (`onended`) thì sang câu tiếp. Nếu câu tiếp còn `pending` thì hiện trạng thái "đang tạo giọng đọc..." và chờ.
- Tốc độ: `audio.playbackRate = rate` (trình duyệt mặc định giữ cao độ giọng qua `preservesPitch`), **không cần tạo lại audio**.
- **MiniPlayer** đặt ở layout gốc, nên vẫn phát khi chuyển trang.
- **Media Session API**: hiện nút điều khiển trên màn hình khóa / phím media.
- Phím tắt: `Space` play/pause, `←/→` câu trước/sau.
- Nếu `/tts/status` báo offline thì **ẩn nút 🔊** và hiện gợi ý "Bật TTS server để dùng tính năng đọc".

### 11.10 Nhân bản giọng (tùy chọn)
- VieNeu hỗ trợ clone từ clip **3–8 giây** (server có `POST /v1/voices`), tự lọc nhiễu.
- Chỉ cho phép **nhân bản giọng của chính người dùng**: hiện checkbox xác nhận trước khi upload, không cho clone giọng người khác.
- Giọng đã clone chỉ hiện trong tài khoản đó.

### 11.11 Lưu ý
- Model **v4** của VieNeu là bản đóng (chỉ có qua API của họ). Dự án này dùng **v3 Turbo** mã nguồn mở.
- Code VieNeu theo Apache-2.0. Kiểm tra thêm license của model weights trên trang Hugging Face nếu sau này muốn công khai sản phẩm.
- Thẻ cảm xúc như `[cười]` vẫn đang thử nghiệm, **không dùng** cho nội dung học tập.
- Mỗi giờ audio WAV 48 kHz 16-bit mono khoảng 330 MB, nên thêm **giới hạn dung lượng cache** (ví dụ xóa file ít dùng nhất khi vượt 2 GB).
- **Phương án dự phòng:** nếu Turbo quá chậm trên máy bạn, thử **v3 Nano** (`Vieneu(mode="v3nano")`: nhanh hơn, 24 kHz, chất lượng thấp hơn) bằng cách viết một server FastAPI nhỏ bọc SDK `vieneu`, giữ nguyên endpoint `/v1/audio/speech` để Express không phải sửa.

---

## 12. Prompt mẫu

### 12.1 Tóm tắt chương
```
Bạn là trợ giảng đại học. Dựa DUY NHẤT vào tài liệu PDF đính kèm (chương "{chapterTitle}"),
tạo bản tóm tắt tiếng Việt gồm:
- overview: 3–5 câu
- key_points: 5–10 ý chính, mỗi ý kèm số trang (page)
- key_terms: khái niệm quan trọng + định nghĩa + số trang
Quy tắc: không thêm kiến thức ngoài tài liệu; giữ nguyên thuật ngữ chuyên ngành.
```

### 12.2 Sinh câu hỏi
```
Dựa DUY NHẤT vào chương đính kèm, tạo {count} câu hỏi loại {type}, độ khó {difficulty}:
- easy: nhớ định nghĩa, khái niệm
- medium: hiểu, so sánh, giải thích
- hard: vận dụng vào tình huống, phân tích
Yêu cầu:
- Trắc nghiệm đúng 4 lựa chọn, 1 đáp án đúng, đáp án nhiễu hợp lý.
- explanation giải thích vì sao đúng và vì sao các đáp án khác sai.
- source_page là trang chứa kiến thức; topic là chủ đề nhỏ.
- Không trùng các câu: {existingQuestions}
```

### 12.3 Chấm tự luận
```
Câu hỏi: {question}
Đáp án tham khảo: {reference}
Câu trả lời của người học: {answer}
Chấm 0–10: đúng ý chính (6đ), đầy đủ (3đ), diễn đạt (1đ).
Trả JSON: { score, feedback, missing_points[] }. Feedback ngắn, mang tính khích lệ.
```

### 12.4 System prompt Gia sư AI
```
Bạn là gia sư AI cho giáo trình "{documentTitle}".
- Chỉ trả lời dựa trên nội dung giáo trình, lấy qua các tool được cung cấp.
- Luôn trích dẫn số trang dạng (tr. X).
- Nếu giáo trình không có thông tin, nói rõ là không có, không tự bịa.
- Giải thích dễ hiểu, có ví dụ; khi phù hợp, gợi ý người học làm quiz.
```

---

## 13. Thuật toán Flashcard SM-2

```ts
export function sm2(card: Card, quality: number) {
  if (quality < 3) {
    card.repetitions = 0;
    card.interval_days = 1;
  } else {
    card.repetitions += 1;
    if (card.repetitions === 1) card.interval_days = 1;
    else if (card.repetitions === 2) card.interval_days = 6;
    else card.interval_days = Math.round(card.interval_days * card.ease_factor);
  }
  card.ease_factor = Math.max(1.3,
    card.ease_factor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)));
  card.next_review_at = addDays(new Date(), card.interval_days);
  return card;
}
```

UI: 4 nút **Quên (1) · Khó (3) · Tốt (4) · Dễ (5)**

---

## 14. Giao diện (các màn hình)

| # | Màn hình | Thành phần chính |
|---|---|---|
| 1 | Landing page | Giới thiệu, GIF demo, nút bắt đầu |
| 2 | Đăng nhập / Đăng ký | Form + validate |
| 3 | Dashboard | Tài liệu gần đây, thẻ cần ôn hôm nay, điểm TB |
| 4 | Upload | Kéo-thả PDF, thanh tiến độ realtime theo từng bước |
| 5 | Chi tiết tài liệu | Sidebar chương; tab Tóm tắt / Sơ đồ / Câu hỏi |
| 6 | Tóm tắt chương | Layout chia đôi: tóm tắt ↔ PDF gốc; click số trang để nhảy trang; nút **▶ Nghe chương**, highlight câu đang đọc |
| 7 | Làm quiz | Từng câu, thanh tiến trình, đồng hồ (chế độ thi) |
| 8 | Kết quả | Điểm, đúng/sai, giải thích, nút "Ôn lại câu sai" |
| 9 | Flashcard | Hiệu ứng lật thẻ, phím tắt 1–4 |
| 10 | Thống kê | Biểu đồ điểm theo chương, chủ đề yếu, token AI |
| 11 | Gia sư AI | Chat stream, trích dẫn trang, quiz nhúng trong chat, nút bật/tắt tự đọc |
| 12 | Trình phát audio | MiniPlayer nổi: play/pause, câu trước/sau, tốc độ, chọn giọng, thanh tiến trình |
| 13 | Ôn tập rảnh tay | Màn hình tối giản, chữ lớn, đếm ngược, điều khiển bằng phím/tai nghe |
| 14 | Cài đặt | Giọng đọc mặc định (nghe thử từng giọng), tốc độ, tự đọc gia sư, theme, (tùy chọn) clone giọng |

**Lưu ý UX:** skeleton loading, empty state, toast lỗi, responsive mobile, dark mode, hiển thị rõ khi AI đang "suy nghĩ".

---

## 15. Cài đặt & chạy local

### 15.1 Yêu cầu
- Node.js 20+
- MySQL 8 (MySQL Installer, XAMPP hoặc Laragon đều được)
- Gemini API key (lấy miễn phí tại Google AI Studio)
- **Python + [uv](https://docs.astral.sh/uv/)** cho VieNeu-TTS (uv tự cài đúng phiên bản Python)
- Dung lượng trống vài GB cho model TTS + cache audio

### 15.2 Biến môi trường `server/.env`

```env
PORT=5000
CLIENT_URL=http://localhost:5173

DB_HOST=localhost
DB_PORT=3306
DB_NAME=studyai
DB_USER=root
DB_PASSWORD=

JWT_SECRET=change_me
JWT_EXPIRES_IN=7d

GEMINI_API_KEY=your_key_here
GEMINI_MODEL=your_flash_model_name

UPLOAD_DIR=./uploads
MAX_UPLOAD_MB=50

# VieNeu-TTS
TTS_URL=http://localhost:8000/v1
TTS_MODEL=vieneu-v3-turbo
TTS_DEFAULT_VOICE=Hải Đăng
TTS_CACHE_MAX_GB=2
```

### 15.3 Các bước chạy

```bash
# 1. Cài dependencies
npm install            # ở thư mục gốc (cài concurrently)
cd server && npm install
cd ../client && npm install

# 2. Tạo database + chạy migration
cd ../server
npx sequelize-cli db:create
npx sequelize-cli db:migrate
npx sequelize-cli db:seed:all      # (tùy chọn) dữ liệu mẫu

# 3. Cài VieNeu-TTS (bản CPU, không cần PyTorch)
cd ..
powershell -c "irm https://astral.sh/uv/install.ps1 | iex"   # Windows: cài uv (1 lần)
git clone https://github.com/pnnbao97/VieNeu-TTS.git tts-service
cd tts-service
uv sync                                # bản CPU / ONNX
uv run vieneu-web                      # (tùy chọn) thử giọng ở http://127.0.0.1:7860

# 4. Chạy cả TTS + BE + FE bằng 1 lệnh (từ thư mục gốc)
cd ..
npm run dev
```

> Lần chạy đầu VieNeu sẽ **tải model từ Hugging Face**, có thể mất vài phút. Không cần tính năng đọc thì dùng `npm run dev:no-tts`, app vẫn chạy bình thường (nút 🔊 tự ẩn).

### 15.4 Script `package.json` ở thư mục gốc

```json
{
  "scripts": {
    "dev": "concurrently -n tts,server,client -c magenta,blue,green \"npm run tts\" \"npm run dev --prefix server\" \"npm run dev --prefix client\"",
    "dev:no-tts": "concurrently -n server,client -c blue,green \"npm run dev --prefix server\" \"npm run dev --prefix client\"",
    "tts": "cd tts-service && uv run python -m apps.openai_speech"
  },
  "devDependencies": { "concurrently": "^9.0.0" }
}
```

- `server`: `"dev": "nodemon --exec tsx src/app.ts"`
- `client`: Vite proxy `/api` → `http://localhost:5000` để không phải cấu hình CORS khi dev.

### 15.5 `.gitignore` quan trọng
```
node_modules/
.env
server/uploads/
dist/
tts-service/
```

---

## 16. Lộ trình triển khai

> Dự án cá nhân nên không bị deadline ép. Ước lượng **10–11 tuần**, làm bán thời gian.

### Giai đoạn 0: Thử nghiệm AI (Tuần 1)
- [ ] Lấy API key, viết script `test-gemini.ts` gửi 1 PDF thật
- [ ] Thử prompt tóm tắt + sinh câu hỏi → đánh giá chất lượng tiếng Việt
- [ ] Thử structured output với schema ở mục 9.4
- [ ] Cài VieNeu-TTS, chạy `uv run vieneu-web`, **đo tốc độ trên máy mình** (đọc 1 đoạn tóm tắt ~200 chữ mất bao lâu), nghe thử giọng
- [ ] Thử gọi `POST /v1/audio/speech` bằng Postman/curl, kiểm tra cách đọc số, viết tắt, thuật ngữ tiếng Anh
- [ ] Khởi tạo repo, ESLint/Prettier, TypeScript, script `npm run dev`

### Giai đoạn 1: Nền tảng (Tuần 2)
- [ ] Models + migrations
- [ ] Auth: register / login / JWT middleware
- [ ] Upload PDF (Multer) + lưu `documents`
- [ ] FE: layout, routing, auth pages, dashboard, upload

### Giai đoạn 2: Pipeline AI (Tuần 3–5) ⭐ quan trọng nhất
- [ ] Job runner + progress bus + resume khi khởi động
- [ ] Tách chương (bookmark → fallback Gemini) + cho phép sửa ranh giới
- [ ] Tóm tắt chương (structured output + Zod + withRetry)
- [ ] Sinh câu hỏi trắc nghiệm / đúng-sai
- [ ] SSE tiến độ + UI thanh tiến độ
- [ ] FE: trang chi tiết tài liệu, tóm tắt, xem PDF gốc theo trang

### Giai đoạn 3: Ôn tập (Tuần 6–7)
- [ ] Tạo quiz, nộp bài, chấm điểm, giải thích
- [ ] Lịch sử + thống kê + chủ đề yếu
- [ ] Chọn độ khó, chế độ thi thử
- [ ] Câu tự luận + AI chấm

### Giai đoạn 4: Nâng cao (Tuần 8–9)
- [ ] Flashcard + SM-2 + xuất CSV Anki
- [ ] Gia sư AI (agent + function calling + streaming)
- [ ] Sơ đồ tư duy Mermaid
- [ ] Trang thống kê token AI

### Giai đoạn 5: Tính năng đọc VieNeu-TTS (Tuần 10)
- [ ] `tts.client`, `ttsQueue`, `textNormalizer`, `sentenceSplitter`, bảng `tts_audios` + cache
- [ ] API `/tts/*` + `/chapters/:id/audio`
- [ ] FE: `playerStore`, AudioPlayer, MiniPlayer, highlight câu đang đọc, tốc độ, phím tắt
- [ ] Nút 🔊 cho câu hỏi / giải thích / khái niệm
- [ ] Gia sư AI tự đọc câu trả lời
- [ ] Chế độ ôn tập rảnh tay + Media Session API
- [ ] Trang cài đặt: chọn giọng (nghe thử), tốc độ
- [ ] (Tùy chọn) Clone giọng của mình, tải audio chương

### Giai đoạn 6: Hoàn thiện (Tuần 11)
- [ ] Polish UI: dark mode, responsive, loading/empty/error state
- [ ] Viết README đầy đủ (ảnh chụp màn hình, GIF demo, hướng dẫn chạy)
- [ ] Quay video demo ngắn 1–2 phút
- [ ] Dọn code, xóa log thừa, kiểm tra không lộ `.env`

---

## 17. Rủi ro & cách xử lý

| Rủi ro | Ảnh hưởng | Cách xử lý |
|---|---|---|
| Vượt rate limit gói miễn phí | Xử lý chậm / lỗi 429 | Job chạy tuần tự, `withRetry` backoff, cache kết quả vào DB |
| Server tắt giữa lúc xử lý | Tài liệu kẹt "processing" | Lưu trạng thái từng chương trong DB, resume khi khởi động |
| AI bịa nội dung | Sai kiến thức | Prompt grounding, bắt buộc số trang, nút "Báo câu hỏi sai" |
| JSON sai format | Lỗi pipeline | Structured output + Zod + retry |
| PDF không có mục lục | Tách chương sai | Fallback Gemini + UI cho sửa ranh giới chương |
| PDF scan (ảnh) | Không trích được text | Gemini đọc PDF trực tiếp, không phụ thuộc trích text |
| File Gemini hết hạn | Gia sư AI / sinh thêm câu lỗi | Kiểm tra và upload lại từ file local |
| PDF quá lớn | Chậm, tốn token | Giới hạn dung lượng, cắt theo chương trước khi gửi |
| Lộ API key khi push GitHub | Bị lạm dụng key | `.env` trong `.gitignore`, chỉ commit `.env.example` |
| TTS chậm trên CPU | Chờ lâu mới nghe được | Tạo theo câu + phát dần, cache, hàng đợi ưu tiên; dự phòng v3 Nano |
| Dùng int8 trên CPU không có VNNI | Audio méo, rè | Giữ fp32 (mặc định trên CPU) |
| TTS server chưa bật | Lỗi khi bấm nghe | `/tts/status` kiểm tra, FE ẩn nút 🔊, app vẫn chạy bình thường |
| Đọc sai viết tắt, công thức, code | Nghe khó hiểu | `textNormalizer` + từ điển viết tắt, bỏ qua code/công thức |
| TTS và Gemini cùng chạy làm máy nóng/chậm | Trải nghiệm kém | Không tạo audio trước khi tài liệu xử lý xong; chỉ tạo khi người dùng bấm nghe |
| Cache audio phình to | Đầy ổ cứng | Giới hạn `TTS_CACHE_MAX_GB`, xóa file ít dùng nhất |
| Lạm dụng clone giọng | Vấn đề đạo đức | Chỉ clone giọng của chính mình, bắt buộc xác nhận |

---

## 18. Checklist hoàn thiện cho portfolio

- [ ] README có: mô tả, ảnh chụp màn hình, GIF demo, tính năng, công nghệ, cách chạy
- [ ] Sơ đồ kiến trúc + ERD trong README (có thể dùng Mermaid)
- [ ] Mục **"Điểm kỹ thuật nổi bật"**: workflow vs agent, structured output, SSE realtime, SM-2, resume job, **tích hợp TTS tiếng Việt chạy local + trình phát highlight theo câu**
- [ ] Video demo có **âm thanh** để khoe giọng đọc VieNeu; ghi credit VieNeu-TTS trong README
- [ ] Commit rõ ràng theo tính năng (conventional commits)
- [ ] Repo public trên GitHub, kèm topic tags (react, typescript, gemini, ai)
- [ ] Video demo 1–2 phút (YouTube/Drive) gắn link trong README
- [ ] Code TypeScript không còn `any` tràn lan, có xử lý lỗi rõ ràng

---

*Bản kế hoạch sẽ được cập nhật trong quá trình phát triển.*
