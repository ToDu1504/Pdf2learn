# Kế hoạch chuyển Pdf2Learn thành ứng dụng desktop (Windows)

Ngày lập: 10/11/2026 · Trạng thái: đã chốt, đang làm

## Tiến độ

Cập nhật sau mỗi giai đoạn. Chi tiết từng giai đoạn ở mục 11.

| # | Giai đoạn | Trạng thái | Commit |
|---|---|---|---|
| 1 | SQLite cho server của app | ✅ Xong (10/11): 30 test, upload → lộ trình → bài học, thống kê, xóa dây chuyền đều chạy trên SQLite | `5825c4b` |
| 2 | Chuyển dữ liệu từ MySQL sang SQLite | ✅ Xong (10/11): tài khoản tokhanhvu4@gmail.com — 1 tài liệu, 771 trang, 12 chặng, 58 bài + bài giảng, 287 câu hỏi, 210 flashcard, 62 lượt dùng AI; số dòng khớp từng bảng, khóa ngoại hợp lệ, PDF + bản dịch đã chép. Lệnh: `npx tsx scripts/migrate-from-mysql.ts --email <email> --replace` | (commit này) |
| 3 | Bỏ đăng nhập, Express phục vụ giao diện | ✅ Xong (10/11): giao diện không còn trang giới thiệu/đăng nhập/đăng xuất, mở thẳng `/app`; server app phục vụ giao diện đã build và chỉ nghe trên 127.0.0.1:5100; chạy thử trang chủ, lộ trình, bài học + tô sáng PDF, flashcard, thống kê, cài đặt — không lỗi | (commit này) |
| 4 | Electron: cửa sổ, khay hệ thống, dọn tiến trình | ✅ Xong (10/11): Electron 37 (Node 22.17); server chạy bằng Node của Electron, cổng ngẫu nhiên 127.0.0.1; đóng cửa sổ → khay; Thoát → tắt server + cả cây tiến trình; Electron chết đột ngột → server tự tắt sau ~1 giây; 1 phiên bản; không ghi gì ra ổ C (userData/cache/logs/temp → `data/electron`, `data/cache/tmp`) | (commit này) |
| 5 | Màn hình lần đầu chạy + Cài đặt (API key mã hóa) | ✅ Xong (10/11): màn hình chào 2 bước (nơi lưu dữ liệu, Gemini key); key kiểm tra với Google (lời gọi xem model, không tốn lượt) rồi mã hóa bằng safeStorage vào `data/config.json`; đổi key/model khi đang chạy; Cài đặt có mục AI và Dữ liệu (mở thư mục, đổi thư mục kèm chép dữ liệu + khởi động lại). Đã thử trên thư mục trống: key sai báo lỗi, key đúng vào app, mở lại app không phải nhập lại | (commit này) |
| 6 | Gói dịch tải khi cần | ⏳ Chưa làm | |
| 7 | Đóng gói `.exe`, cài/gỡ | ⏳ Chưa làm | |

**Ghi chú phát sinh**

- Gemini key nằm trong `app/data/config.json` dạng mã hóa (chỉ giải mã được trên tài khoản Windows này). Không còn `app/server/.env`.
- Dữ liệu đã chuyển nằm ở `app/data/` (gitignored). Chạy lại script với `--replace` sẽ xóa dữ liệu app và chép lại từ MySQL.
- Chạy app desktop khi phát triển: `cd app && npm run dev` (build giao diện rồi mở Electron) hoặc `npm start` (không build lại). Terminal của VS Code đặt sẵn `ELECTRON_RUN_AS_NODE=1` nên phải chạy qua `desktop/run.cjs` (script `start`/`dev` đã làm), không gọi thẳng `electron .`.
- Biến chạy thử: `PDF2LEARN_NO_AUTO=1` (không soạn/dịch nền), `PDF2LEARN_QUIT_AFTER=<ms>` (tự gọi quy trình Thoát).
- Electron tải bản cài vào `.cache/electron` (đặt `ELECTRON_CACHE`/`electron_config_cache` khi `npm install`), không vào ổ C.
- Chạy thử không cần Electron: `cd app/client && npm run build`, rồi `cd app/server && npx tsx src/app.ts` → mở http://127.0.0.1:5100. Phát triển giao diện: `cd app/client && npx vite` → http://localhost:5174 (gọi server app ở 5100). Bản web vẫn ở 5000/5173.

## 0. Quyết định đã chốt (10/11/2026)

1. **Mọi thứ của app nằm trong thư mục `app/`** ở gốc dự án: bản sao server, bản sao giao diện, phần Electron. Dữ liệu mặc định ở `app/data/` (gitignored); khi cài bằng `.exe` thì ở `<thư mục cài>\data`.
2. **Đóng cửa sổ = thu xuống khay hệ thống**, việc soạn trước và dịch trước vẫn chạy. Thoát hẳn bằng menu ở khay.
3. **Bản web (`server/`, `client/`) giữ nguyên, không sửa.** App là một nhánh riêng trong `app/`: bỏ hẳn đăng nhập, không cần cờ chạy hai chế độ.
4. **Không có tài khoản.** Chỉ chuyển dữ liệu của người dùng chính (tài liệu CompTIA và tiến độ); không chuyển tài khoản demo.
5. **Trước mắt dùng cá nhân**, chưa ký số; giữ sạch giấy phép (AGPL của VI-Translate) để sau này chia sẻ được.

## 1. Mục tiêu

Biến Pdf2Learn từ một web app phải tự bật MySQL, chạy `npm run dev` rồi mở trình duyệt thành **một ứng dụng Windows cài đặt bằng file `.exe` và mở bằng một cú bấm**.

Yêu cầu:

- **Không cần cài hay mở MySQL/Laragon.** Dữ liệu nằm trong một file SQLite.
- **Không cần đăng nhập.** Máy nào cài thì máy đó dùng.
- **Mọi dữ liệu, cache và bản dịch nằm ở ổ D** (thư mục do người dùng chọn), không ghi ra ổ C.
- **Gói dịch VI-Translate tải khi cần** (một cú bấm), không gói sẵn trong bộ cài.
- **Giữ nguyên mọi tính năng hiện có:** lộ trình bám mục lục sách, kiểm chứng với PDF, câu hỏi của sách, quiz, flashcard, gia sư AI, dịch PDF, chuẩn bị trước ở nền.
- **Không mất dữ liệu đang có:** tài liệu, bài đã soạn và tiến độ được chuyển từ MySQL sang.
- **Bản web giữ nguyên** trong `server/` và `client/`; app là bản tách riêng trong `app/`.

Chưa làm trong đợt này: AI chạy local (Ollama), app điện thoại, tự cập nhật phiên bản.

## 2. Kiến trúc

```
┌─────────────────────────── Pdf2Learn.exe (Electron) ───────────────────────────┐
│                                                                                 │
│  Tiến trình chính (main)                 Cửa sổ (renderer)                      │
│  ─────────────────────────                ─────────────────                     │
│  • chọn / mở thư mục dữ liệu             • giao diện React hiện tại             │
│  • chạy server Express (cổng ngẫu nhiên    (build sẵn, Express phục vụ)         │
│    trên 127.0.0.1)                ◄────► • gọi /api/v1/... như bây giờ          │
│  • quản lý tiến trình con (Python dịch,                                         │
│    Chrome của engine) và tắt hết khi thoát                                      │
│  • lưu Gemini API key (mã hóa bằng safeStorage)                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
                      │ đọc/ghi
                      ▼
   Thư mục dữ liệu (mặc định app\data, khi cài: <thư mục cài>\data)
     ├─ pdf2learn.db          ← SQLite: tài liệu, bài học, câu hỏi, flashcard, tiến độ
     ├─ uploads\pdf\          ← file PDF gốc
     ├─ uploads\translated\   ← PDF đã dịch theo cụm
     ├─ translator\           ← gói dịch (Python + VI-Translate + mô hình), tải khi cần
     ├─ cache\                ← cache của engine, hồ sơ Chrome riêng
     └─ config.json           ← cài đặt app (model Gemini, đường dẫn…)
```

**Vì sao chọn Electron:** backend hiện là Node/Express, nên Electron chạy được nguyên server đó bên trong app mà không phải viết lại. Giao diện React giữ nguyên. Tauri cho bộ cài nhỏ hơn nhưng phải chạy Node như một chương trình phụ và viết thêm phần Rust, tốn công hơn mà không được gì cho bài toán này.

**Giao diện gọi API thế nào:** Express vừa phục vụ file giao diện đã build, vừa phục vụ `/api/v1`, cùng một địa chỉ `http://127.0.0.1:<cổng>`. Vì vậy code React gọi `/api/v1/...` như cũ, không phải sửa. Server chỉ nghe trên 127.0.0.1, máy khác trong mạng không truy cập được.

## 3. Những gì giữ nguyên và những gì thay đổi

| Phần | Giữ nguyên | Thay đổi |
|---|---|---|
| Giao diện React | Toàn bộ các trang, component | Bỏ trang đăng nhập/đăng ký và trang giới thiệu (landing); thêm màn hình lần đầu chạy (chọn thư mục dữ liệu, nhập API key) |
| Server Express | Toàn bộ routes, services, pipeline, kiểm chứng, dịch | Chạy bên trong Electron; đường dẫn lấy từ thư mục dữ liệu thay vì `.env` |
| Cơ sở dữ liệu | Model Sequelize | MySQL → SQLite; sửa vài câu SQL viết tay (mục 4) |
| Đăng nhập | — | Bỏ JWT/bcrypt; một người dùng cục bộ cố định |
| Cấu hình | Biến cấu hình như cũ | `.env` → `config.json` + màn hình Cài đặt; API key mã hóa |
| Dịch PDF | Engine, cách gọi, bản vá `sitecustomize.py` | Python lấy từ gói dịch tải về thay vì `vi-translate/.venv` |
| Sửa PDF hỏng | Script `repair_pdf.py` | Chạy bằng Python của gói dịch thay vì `uv run` |

## 4. Chuyển MySQL sang SQLite

Sequelize hỗ trợ SQLite, nên phần lớn code không đổi. Các điểm phải xử lý:

| Chỗ | Vấn đề | Cách sửa |
|---|---|---|
| 11 migration MySQL | Có `ENUM`, `JSON`, `MEDIUMTEXT`, thêm/xóa cột theo kiểu MySQL | Gộp thành **1 migration nền cho SQLite** (lược đồ hiện tại). Các migration sau này chạy bằng `umzug` ngay khi app khởi động, vì app không có `sequelize-cli`. |
| `stats.routes.ts` /ai-usage | `DATE_FORMAT(...)`, `NOW() - INTERVAL 30 DAY` | Viết lại bằng `strftime`/`date('now','-30 day')`, hoặc tính trong JS |
| `stats.routes.ts`, `quizzes.routes.ts`, `tutor.agent.ts` | SQL viết tay `SUM(x = 0)`, `HAVING`, `ORDER BY` biểu thức | Chạy được trên SQLite; chỉ cần test lại |
| Cột JSON | MariaDB trả về chuỗi | Helper `json()` hiện tại đã tự `JSON.parse`, dùng được cho SQLite |
| `ENUM` | SQLite không có kiểu ENUM | Sequelize lưu thành TEXT; giá trị vẫn được Zod/TypeScript kiểm soát |
| `sequelize.random()` | | Sequelize tự đổi sang `RANDOM()` |
| Ghi đồng thời | SQLite chỉ cho một luồng ghi tại một thời điểm | Bật chế độ WAL; app chỉ có một người dùng nên đủ |

Thư viện `sqlite3` là module native: phải build lại cho đúng phiên bản Electron (`@electron/rebuild`). `electron-builder` làm việc này tự động khi đóng gói.

**Chuyển dữ liệu cũ:** viết script `migrate-from-mysql` đọc từng bảng từ MySQL rồi ghi vào `pdf2learn.db`, giữ nguyên id, và chép `server/uploads/` sang thư mục dữ liệu. Chỉ chạy một lần. Kiểm tra: số dòng mỗi bảng khớp, mở được tài liệu CompTIA, bài đã soạn và tiến độ còn nguyên.

## 5. Bỏ đăng nhập

- Lần đầu chạy, app tạo sẵn một người dùng cục bộ (id 1).
- Middleware `auth` không đọc token nữa; luôn gán `req.userId = 1`.
- Các hàm `findOwnedDocument`/`findOwnedChapter` giữ nguyên, để sau này muốn quay lại chế độ nhiều người dùng vẫn được.
- Bỏ các trang `/login`, `/register`, `/` (landing); app mở thẳng vào trang chủ.
- SSE và các lệnh tải file hiện gửi `?token=`/header; trong chế độ desktop thì bỏ qua phần này.
- Bỏ hẳn trong bản sao `app/`; bản web giữ nguyên đăng nhập.

## 6. Thư mục dữ liệu và cấu hình

**Lần đầu mở app**, màn hình chào hỏi 2 bước:

1. **Thư mục dữ liệu.** Mặc định là thư mục `data` cạnh `Pdf2Learn.exe` (khi phát triển: `app\data`); có thể chọn chỗ khác. Đường dẫn được ghi vào một file nhỏ cạnh `Pdf2Learn.exe`, không ghi vào AppData trên ổ C.
2. **Nhập Gemini API key.** Có nút kiểm tra key. Key được mã hóa bằng `safeStorage` của Electron rồi mới lưu.

**Cài đặt trong app:**

- API key, model chính, các model dự phòng.
- Thư mục dữ liệu: xem và mở bằng Explorer. Đổi thư mục kèm chép dữ liệu thì để bản sau.
- Các mục đang có: giao diện, tự soạn trước, tự dịch trước, trình duyệt dùng để dịch.
- Gói dịch: trạng thái, cài, gỡ.

**Không ghi ra ổ C:**

- Electron mặc định để dữ liệu và cache ở `%APPDATA%`. Gọi `app.setPath('userData' | 'sessionData' | 'logs' | 'crashDumps', <thư mục dữ liệu>)` ngay khi khởi động để chuyển hết sang thư mục dữ liệu.
- Biến môi trường TEMP của các tiến trình con trỏ vào `<thư mục dữ liệu>\cache\tmp`.
- Engine dịch dùng `<thư mục dữ liệu>\cache` làm USERPROFILE/HOME, như hàm `pyEnv()` đang làm.
- Bộ cài NSIS cho chọn thư mục cài đặt (mặc định đề xuất `D:\Programs\Pdf2Learn`).

## 7. Gói dịch VI-Translate (tải khi cần)

**Khi nào tải:** lần đầu người dùng mở tab "Bản dịch" hoặc bật "Tự dịch trước", app hỏi:

> Cần tải gói dịch (~500MB, một lần). Tải ngay?

**Nội dung gói**, cài vào `<thư mục dữ liệu>\translator\`:

- Python 3.12 chạy độc lập (python-build-standalone, không cài vào hệ thống).
- Mã nguồn VI-Translate, ghim đúng một commit đã thử.
- Thư viện: `requirements.txt` + `websocket-client` + `pikepdf` (cho `repair_pdf.py`).
- Mô hình nhận bố cục trang.

**Cách tạo gói:** script `build-translator-pack` chạy trên máy phát triển, ra một file `.zip`. Gói được đăng lên mục Releases của repo GitHub; app tải về, kiểm tra mã băm sha256, rồi giải nén. Mỗi bước có tiến độ hiển thị; tải hỏng thì tải lại được.

**Thay đổi trong code:** `pdfTranslate.service.ts` lấy đường dẫn Python và script từ thư mục gói dịch. Không có gói dịch thì tab Bản dịch dùng Gemini dịch chữ, như hiện tại.

**Giấy phép:** VI-Translate là AGPL-3.0. App gọi engine như một chương trình riêng nên phần còn lại của app không bị ràng buộc. Cần làm:

- Kèm file giấy phép AGPL trong gói dịch.
- Ghi đường dẫn tới mã nguồn và commit đã dùng trong màn hình "Giới thiệu".
- Bản vá `sitecustomize.py` đã công khai trong repo.

## 8. Quản lý tiến trình con

Hôm nay khi tắt dự án vẫn còn sót 21 tiến trình (server cũ, Python, Chrome của engine). App desktop phải dọn sạch:

- Main process theo dõi mọi tiến trình con (Python dịch, Chrome của engine) qua một registry.
- Khi thoát app (đóng cửa sổ, tắt từ khay hệ thống, Windows shutdown): dừng hàng đợi, kết thúc cả cây tiến trình (`taskkill /T /F`), đóng SQLite đúng cách.
- Khi khởi động: dọn các tiến trình mồ côi còn ghi nhận từ lần chạy trước (file PID trong thư mục dữ liệu).
- Chỉ cho chạy **một phiên bản app** (`requestSingleInstanceLock`). Mở lần hai thì đưa cửa sổ đang có lên trước.

**Chạy nền:** việc tự soạn và tự dịch trước cần app đang mở. Khi đóng cửa sổ, app có thể thu xuống khay hệ thống để tiếp tục làm nền. Đây là tùy chọn trong Cài đặt, mặc định là thoát hẳn.

## 9. Đóng gói và phát hành

- `electron-builder`, đích NSIS (`Pdf2Learn-Setup-x.y.z.exe`), cho chọn thư mục cài đặt.
- Thành phần trong bộ cài:
  - Electron;
  - server đã build sang JavaScript bằng `tsc`, không cần `tsx` khi chạy;
  - giao diện đã build;
  - `sqlite3` native;
  - `pdfjs-dist`;
  - các script Python nhỏ (`pdf_chunk.py`, `pdf_merge.py`, `repair_pdf.py`, `pyhooks`).
- Dung lượng dự kiến: bộ cài ~120–160MB; gói dịch tải riêng ~500MB.
- Chưa ký số (code signing) nên Windows SmartScreen sẽ cảnh báo lần đầu. Chấp nhận được khi dùng cá nhân; phát hành rộng thì cần chứng chỉ.
- Phiên bản ghi trong `package.json`; tự cập nhật để làm sau.

## 10. Cấu trúc thư mục dự kiến

```
Pdf2Learn/
├─ server/, client/        bản web: GIỮ NGUYÊN
└─ app/                    MỌI THỨ CỦA APP DESKTOP
   ├─ server/              bản sao server: SQLite, không đăng nhập, cấu hình từ thư mục dữ liệu
   ├─ client/              bản sao giao diện: bỏ đăng nhập/landing, thêm màn hình lần đầu chạy
   ├─ desktop/             Electron: main.ts, dataDir.ts, translatorPack.ts, preload.ts, tray
   ├─ scripts/             migrate-from-mysql.ts, build-translator-pack.ps1
   ├─ data/                dữ liệu khi chạy thử (gitignored): pdf2learn.db, uploads, translator, cache
   └─ package.json         lệnh dev/build/dist cho cả app
```

## 11. Các giai đoạn

| # | Việc | Kết quả kiểm tra được | Ước tính |
|---|---|---|---|
| 1 | **SQLite**: migration nền, sửa SQL viết tay, cấu hình chọn MySQL/SQLite, chạy toàn bộ test trên SQLite | 30 unit test + chạy thử giao diện đều qua trên SQLite | 1 buổi |
| 2 | **Chuyển dữ liệu**: script MySQL → SQLite, chép uploads | Mở được tài liệu CompTIA với 58 bài đã soạn, quiz, flashcard, tiến độ còn nguyên | ½ buổi |
| 3 | **Server của app**: bỏ đăng nhập, cấu hình từ thư mục dữ liệu, Express phục vụ giao diện | Chạy server app → mở thẳng trang chủ, mọi trang hoạt động | ½ buổi |
| 4 | **Electron**: cửa sổ, chạy server bên trong, thư mục dữ liệu, setPath, một phiên bản, dọn tiến trình khi thoát | Mở/đóng app 3 lần: không sót tiến trình, ổ C không tăng | 1 buổi |
| 5 | **Màn hình lần đầu chạy + Cài đặt** (API key mã hóa, model, thư mục) | Cài trên máy "sạch" (xóa dữ liệu) → làm theo màn hình → tải PDF lên và học được | ½ buổi |
| 6 | **Gói dịch**: script tạo gói, tải/kiểm tra/giải nén trong app, đổi đường dẫn Python | Máy không có `vi-translate/` → bấm tải gói → dịch được một cụm trang | 1 buổi |
| 7 | **Đóng gói** NSIS, thử cài/gỡ, cập nhật README | Cài từ `.exe`, chạy, gỡ cài sạch sẽ (dữ liệu ở ổ D được giữ) | ½ buổi |

**Tổng: khoảng 5 buổi.** App nằm riêng trong `app/` nên bản web không bị ảnh hưởng; làm xong giai đoạn nào commit giai đoạn đó.

## 12. Rủi ro và cách xử lý

| Rủi ro | Ảnh hưởng | Cách xử lý |
|---|---|---|
| `sqlite3` native không build được cho Electron | Chặn giai đoạn 4 | Dùng `@electron/rebuild`; phương án dự phòng là `better-sqlite3` kèm adapter tự viết, hoặc chạy server bằng Node đi kèm thay vì bên trong Electron |
| Khác biệt SQL giữa MySQL và SQLite gây lỗi ngầm | Thống kê, quiz điểm yếu sai | Viết test cho từng câu SQL viết tay; so kết quả MySQL và SQLite trên cùng dữ liệu |
| Gói dịch lớn, tải lỗi giữa chừng | Không dịch được | Tải tiếp được khi bị ngắt, kiểm tra sha256, nút "tải lại" |
| Windows Defender/SmartScreen chặn app chưa ký | Khó cài lần đầu | Hướng dẫn "More info → Run anyway"; ký số khi phát hành rộng |
| Chrome của engine bị kẹt khi thoát app | Sót tiến trình, khóa hồ sơ trình duyệt | Kết thúc cả cây tiến trình, xóa file khóa hồ sơ khi khởi động |
| Ghi đồng thời nhiều vào SQLite (soạn nền + quiz) | Lỗi "database is locked" | WAL + `busy_timeout`; các thao tác ghi đều ngắn |
