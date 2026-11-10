/**
 * Pdf2Learn desktop — tiến trình chính của Electron.
 *
 *  1. Chỉ 1 phiên bản app (mở lần 2 → đưa cửa sổ đang có lên).
 *  2. Thư mục dữ liệu (DB SQLite, PDF, bản dịch, cache) ở ổ người dùng chọn — mặc định app/data khi phát triển,
 *     <thư mục cài>/data khi đã cài. Mọi đường dẫn mặc định của Electron (userData, cache, logs, crashDumps) và TEMP
 *     của tiến trình con được chuyển vào đó: không ghi ra ổ C.
 *  3. Chạy server Express (app/server) thành tiến trình con bằng chính Node của Electron, cổng ngẫu nhiên trên
 *     127.0.0.1; cửa sổ mở giao diện do server phục vụ.
 *  4. Đóng cửa sổ = thu xuống khay (soạn/dịch nền vẫn chạy). Thoát hẳn từ menu khay → tắt server và CẢ CÂY tiến trình
 *     con (Python, Chrome của engine dịch), không để sót.
 */
const { app, BrowserWindow, Menu, Tray, nativeImage, shell, dialog, ipcMain, safeStorage, net: electronNet } = require("electron");
const { Readable, Transform } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { fork, execFileSync, spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");

const APP_DIR = path.resolve(__dirname, "..");
const ASSETS = path.join(__dirname, "assets");
const DEV = !app.isPackaged;

/* ---------------- thư mục dữ liệu (đặt TRƯỚC mọi thứ khác để Electron không ghi ra ổ C) ---------------- */

const exeDir = path.dirname(process.execPath);
// File nhỏ cạnh app ghi đường dẫn thư mục dữ liệu người dùng chọn (bước "lần đầu chạy" ở giai đoạn 5).
const LOCATION_FILE = DEV ? path.join(APP_DIR, "data-location.txt") : path.join(exeDir, "data-location.txt");
const DEFAULT_DATA_DIR = DEV ? path.join(APP_DIR, "data") : path.join(exeDir, "data");
const DATA_DIR = (() => {
  try {
    const saved = fs.readFileSync(LOCATION_FILE, "utf8").trim();
    if (saved) return saved;
  } catch {
    /* chưa chọn: dùng mặc định */
  }
  return DEFAULT_DATA_DIR;
})();
const ELECTRON_DIR = path.join(DATA_DIR, "electron");
const TMP_DIR = path.join(DATA_DIR, "cache", "tmp");
for (const d of [DATA_DIR, ELECTRON_DIR, TMP_DIR]) fs.mkdirSync(d, { recursive: true });
app.setPath("userData", path.join(ELECTRON_DIR, "userData"));
app.setPath("sessionData", path.join(ELECTRON_DIR, "session"));
app.setPath("logs", path.join(ELECTRON_DIR, "logs"));
app.setPath("crashDumps", path.join(ELECTRON_DIR, "crashDumps"));
app.setPath("temp", TMP_DIR);
app.setAppUserModelId("app.pdf2learn.desktop");

/* ---------------- 1 phiên bản ---------------- */

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

/** @type {BrowserWindow | null} */ let win = null;
/** @type {Tray | null} */ let tray = null;
/** @type {import("node:child_process").ChildProcess | null} */ let server = null;
let serverUrl = "";
let quitting = false;
const PID_FILE = path.join(DATA_DIR, "server.pid");

// Nhật ký của tiến trình chính (bản cài không có cửa sổ dòng lệnh): data/electron/desktop.log
const DESKTOP_LOG = path.join(ELECTRON_DIR, "desktop.log");
const log = (...a) => {
  const line = `[${new Date().toISOString()}] ${a.map((x) => (x instanceof Error ? x.stack : String(x))).join(" ")}`;
  console.log("[desktop]", ...a);
  try {
    fs.appendFileSync(DESKTOP_LOG, line + "\n");
  } catch {
    /* bỏ qua */
  }
};

/* ---------------- tiến trình con ---------------- */

function killTree(pid) {
  try {
    if (process.platform === "win32") execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    else process.kill(-pid, "SIGKILL");
  } catch {
    /* đã thoát */
  }
}

/** Server của lần chạy trước còn sót (app bị tắt đột ngột): chỉ kết thúc nếu đúng là tiến trình của app. */
function cleanupStaleServer() {
  let pid;
  try {
    pid = Number(fs.readFileSync(PID_FILE, "utf8"));
  } catch {
    return;
  }
  if (!pid) return;
  try {
    const out = execFileSync("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], { encoding: "utf8", windowsHide: true });
    const image = (out.split(",")[0] ?? "").replace(/"/g, "").toLowerCase();
    if (image === path.basename(process.execPath).toLowerCase() || image === "node.exe") {
      log(`dọn server còn sót từ lần trước (PID ${pid})`);
      killTree(pid);
    }
  } catch {
    /* không có */
  }
  fs.rmSync(PID_FILE, { force: true });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = /** @type {net.AddressInfo} */ (s.address());
      s.close(() => resolve(port));
    });
  });
}

/** Chạy server bằng Node của Electron. Phát triển: chạy thẳng TypeScript qua tsx; bản cài: JS đã build. */
async function startServer() {
  const port = await freePort();
  // Bản cài: server nằm ở resources/server (extraResources, kèm node_modules); khi phát triển: app/server.
  const serverDir = DEV ? path.join(APP_DIR, "server") : path.join(process.resourcesPath, "server");
  const builtEntry = path.join(serverDir, "dist", "app.js");
  const useBuilt = !DEV && fs.existsSync(builtEntry);
  const entry = useBuilt ? builtEntry : path.join(serverDir, "src", "app.ts");
  const execArgv = useBuilt ? [] : ["--import", "tsx"];
  server = fork(entry, [], {
    cwd: serverDir,
    execArgv,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    windowsHide: true,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      NODE_ENV: "production",
      PORT: String(port),
      DATA_DIR,
      CLIENT_DIST: path.join(APP_DIR, "client", "dist"),
      PDF2LEARN_PARENT_PID: String(process.pid),
      TEMP: TMP_DIR,
      TMP: TMP_DIR,
    },
  });
  fs.writeFileSync(PID_FILE, String(server.pid));
  const logFile = fs.createWriteStream(path.join(ELECTRON_DIR, "server.log"), { flags: "a" });
  server.stdout?.on("data", (b) => (logFile.write(b), DEV && process.stdout.write(b)));
  server.stderr?.on("data", (b) => (logFile.write(b), DEV && process.stderr.write(b)));
  log(`chạy server: ${process.execPath} ${[...execArgv, entry].join(" ")} (cwd ${serverDir})`);
  server.on("error", (err) => log("server lỗi khi chạy:", err));
  server.on("exit", (code, signal) => {
    log(`server thoát: mã ${code}${signal ? `, tín hiệu ${signal}` : ""}`);
    fs.rmSync(PID_FILE, { force: true });
    if (!quitting) {
      dialog.showErrorBox("Pdf2Learn", `Máy chủ của app đã dừng (mã ${code}). Xem nhật ký: ${path.join(ELECTRON_DIR, "server.log")}`);
      quit();
    }
  });
  // Engine dịch (Python → server) nhờ app tải Google Dịch trong cửa sổ ẩn; lần lượt từng lượt.
  server.on("message", (m) => {
    if (!m || m.type !== "gt") return;
    googleQueue = googleQueue
      .then(() => googleTranslate(m.params))
      .then(
        (text) => ({ type: "gt-result", id: m.id, text }),
        (err) => ({ type: "gt-result", id: m.id, error: String(err && err.message ? err.message : err) }),
      )
      .then((reply) => {
        try {
          server?.send(reply);
        } catch {
          /* server đã tắt */
        }
      });
  });
  // Server nhờ mã hóa/giải mã Gemini API key bằng safeStorage (gắn với tài khoản Windows).
  server.on("message", (m) => {
    if (!m || m.type !== "secret") return;
    let reply;
    try {
      if (!safeStorage.isEncryptionAvailable()) throw new Error("Máy không hỗ trợ mã hóa safeStorage");
      const value =
        m.op === "encrypt"
          ? safeStorage.encryptString(String(m.value)).toString("base64")
          : safeStorage.decryptString(Buffer.from(String(m.value), "base64"));
      reply = { type: "secret-result", id: m.id, value };
    } catch (err) {
      reply = { type: "secret-result", id: m.id, error: err.message };
    }
    try {
      server?.send(reply);
    } catch {
      /* server đã tắt */
    }
  });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("Máy chủ khởi động quá lâu")), 90_000);
    server.on("message", (m) => {
      if (m && m.type === "ready") {
        clearTimeout(t);
        resolve();
      }
    });
    server.once("exit", (code) => reject(new Error(`Máy chủ dừng khi khởi động (mã ${code})`)));
  });
  serverUrl = `http://127.0.0.1:${port}`;
  log(`server sẵn sàng: ${serverUrl} · dữ liệu: ${DATA_DIR}`);
}

async function stopServer() {
  if (!server || server.exitCode !== null) return;
  const pid = server.pid;
  try {
    server.send("shutdown"); // server tự tắt tiến trình con + đóng SQLite
  } catch {
    /* kênh đã đóng */
  }
  await new Promise((r) => {
    const t = setTimeout(r, 4000);
    server.once("exit", () => (clearTimeout(t), r()));
  });
  if (pid) killTree(pid); // chắc chắn không sót gì (Python, Chrome của engine)
  fs.rmSync(PID_FILE, { force: true });
}

/* ---------------- Google Dịch trong app (thay cho Chrome của engine dịch) ---------------- */

const GOOGLE_ENDPOINT = "https://translate.google.com/m";
const GOOGLE_PARTITION = "persist:google-translate"; // cookie riêng: giải CAPTCHA một lần, nhớ lâu
const VERIFY_TIMEOUT_MS = 10 * 60_000; // như engine gốc (HUMAN_VERIFICATION_TIMEOUT)
const LOAD_TIMEOUT_MS = 60_000; // không có kết quả, không có CAPTCHA → coi là lỗi mạng
// Giống PAGE_STATE_JS / page_verdict của VI-Translate (pdf2zh/google_browser.py).
const PAGE_STATE_JS = `(() => {
  const result = document.querySelector('.result-container, .t0');
  return { url: location.href, result: result ? result.textContent : null, body: result ? '' : (document.body ? document.body.innerText : '') };
})()`;

let googleQueue = Promise.resolve();
/** @type {BrowserWindow | null} */ let googleWin = null;

function pageVerdict(state, params) {
  let url;
  try {
    url = new URL(state.url || "");
  } catch {
    return ["loading", ""];
  }
  const body = String(state.body || "").toLowerCase();
  if ((url.hostname === "www.google.com" || url.hostname === "google.com") && url.pathname.startsWith("/sorry/")) return ["verification", ""];
  if (state.result == null && body.includes("our systems have detected unusual traffic")) return ["verification", ""];
  if (url.hostname !== "translate.google.com" || url.pathname !== "/m") return ["loading", ""];
  if (["q", "sl", "tl"].some((k) => url.searchParams.get(k) !== params[k])) return ["loading", ""];
  if (typeof state.result === "string" && state.result.trim()) return ["result", state.result];
  return ["loading", ""];
}

function googleWindow() {
  if (googleWin && !googleWin.isDestroyed()) return googleWin;
  googleWin = new BrowserWindow({
    width: 760,
    height: 680,
    show: false,
    parent: win ?? undefined,
    title: "Google cần xác minh: giải CAPTCHA để dịch tiếp",
    icon: path.join(ASSETS, "icon-256.png"),
    autoHideMenuBar: true,
    minimizable: false,
    webPreferences: { partition: GOOGLE_PARTITION, contextIsolation: true, sandbox: true, backgroundThrottling: false },
  });
  // Google thấy một Chrome bình thường, không phải "Electron".
  googleWin.webContents.setUserAgent(app.userAgentFallback.replace(/\s(Electron|pdf2learn)\/\S+/gi, ""));
  googleWin.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  googleWin.on("page-title-updated", (e) => e.preventDefault());
  // Đóng cửa sổ xác minh = bỏ qua lượt này (ẩn đi, không hủy cửa sổ để giữ phiên).
  googleWin.on("close", (e) => {
    if (quitting) return;
    e.preventDefault();
    googleWin?.hide();
  });
  googleWin.on("closed", () => (googleWin = null));
  return googleWin;
}

function showVerification(w) {
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore();
    win.show();
    const b = win.getBounds();
    const [ww, wh] = w.getSize();
    w.setPosition(Math.round(b.x + (b.width - ww) / 2), Math.round(b.y + (b.height - wh) / 2));
  }
  w.show();
  w.focus();
  w.flashFrame(true);
}

/** Một lượt dịch: tải trang Google Dịch trong cửa sổ ẩn, đọc kết quả; CAPTCHA → hiện cửa sổ cho người dùng giải. */
async function googleTranslate(params) {
  if (quitting) throw new Error("App đang thoát");
  const w = googleWindow();
  const url = `${GOOGLE_ENDPOINT}?${new URLSearchParams(params)}`;
  w.webContents.loadURL(url).catch(() => {}); // chuyển hướng/hủy tải: trạng thái trang đọc bên dưới
  const started = Date.now();
  let verifying = false;
  for (;;) {
    await new Promise((r) => setTimeout(r, 400));
    if (quitting || w.isDestroyed()) throw new Error("App đang thoát");
    let state = null;
    try {
      state = await w.webContents.executeJavaScript(PAGE_STATE_JS, true);
    } catch {
      /* trang đang chuyển */
    }
    const [verdict, text] = state ? pageVerdict(state, params) : ["loading", ""];
    if (verdict === "result") {
      if (verifying) {
        w.hide();
        log("Google đã xác minh xong, dịch tiếp");
      }
      return text;
    }
    if (verdict === "verification" && !verifying) {
      verifying = true;
      log("Google đòi xác minh: hiện cửa sổ CAPTCHA trong app");
      showVerification(w);
    }
    if (verifying && !w.isVisible()) throw new Error("Đã đóng cửa sổ xác minh Google");
    const limit = verifying ? VERIFY_TIMEOUT_MS : LOAD_TIMEOUT_MS;
    if (Date.now() - started > limit) {
      if (verifying) w.hide();
      throw new Error(verifying ? "Hết thời gian chờ xác minh Google" : "Không tải được Google Dịch");
    }
  }
}

/* ---------------- cửa sổ + khay ---------------- */

function showWindow() {
  if (!win) return createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createWindow() {
  win = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: "Pdf2Learn",
    icon: path.join(ASSETS, "icon-256.png"),
    backgroundColor: "#f6f4ef",
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, "preload.cjs") },
  });
  win.removeMenu();
  win.once("ready-to-show", () => win?.show());
  // Liên kết ra ngoài (vd. trang Google AI Studio) mở bằng trình duyệt, không mở trong app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(serverUrl)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith(serverUrl)) {
      e.preventDefault();
      void shell.openExternal(url);
    }
  });
  // Đóng cửa sổ = thoát hẳn: dừng server, việc soạn/dịch nền và Chrome/Python của engine dịch.
  // Lần mở sau app tự làm tiếp phần còn dang dở.
  win.on("close", (e) => {
    if (quitting) return;
    e.preventDefault();
    win?.hide();
    void quit();
  });
  win.on("closed", () => (win = null));
  void win.loadURL(`${serverUrl}/app`);
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(path.join(ASSETS, "icon-32.png")).resize({ width: 16, height: 16 }));
  tray.setToolTip("Pdf2Learn");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Mở Pdf2Learn", click: showWindow },
      { label: "Mở thư mục dữ liệu", click: () => void shell.openPath(DATA_DIR) },
      { type: "separator" },
      { label: "Thoát", click: quit },
    ]),
  );
  tray.on("click", showWindow);
}

async function quit() {
  if (quitting) return;
  quitting = true;
  log("đang thoát: tắt server và các tiến trình con…");
  await stopServer();
  tray?.destroy();
  app.exit(0);
}

/* ---------------- giao diện gọi tiến trình chính (preload.cjs) ---------------- */

ipcMain.handle("data-dir:get", () => DATA_DIR);
ipcMain.handle("data-dir:open", () => shell.openPath(DATA_DIR));
ipcMain.handle("open-external", (_e, url) => (/^https?:\/\//.test(String(url)) ? shell.openExternal(String(url)) : undefined));

/**
 * Đổi thư mục dữ liệu: chọn thư mục → (nếu thư mục mới chưa có dữ liệu) tắt server, chép DB + PDF + bản dịch + gói
 * dịch sang → ghi đường dẫn mới cạnh app → khởi động lại. Thư mục cũ giữ nguyên (người dùng tự xóa khi muốn).
 */
ipcMain.handle("data-dir:choose", async () => {
  const pick = await dialog.showOpenDialog(win ?? undefined, {
    title: "Chọn thư mục lưu dữ liệu Pdf2Learn",
    defaultPath: DATA_DIR,
    properties: ["openDirectory", "createDirectory"],
  });
  const target = pick.filePaths[0];
  if (pick.canceled || !target || path.resolve(target) === path.resolve(DATA_DIR)) return { changed: false };
  const hasData = fs.existsSync(path.join(target, "pdf2learn.db"));
  const { response } = await dialog.showMessageBox(win ?? undefined, {
    type: "question",
    buttons: hasData ? ["Dùng dữ liệu ở thư mục đó", "Hủy"] : ["Chép dữ liệu sang và khởi động lại", "Hủy"],
    defaultId: 0,
    cancelId: 1,
    title: "Đổi thư mục dữ liệu",
    message: hasData
      ? `Thư mục "${target}" đã có dữ liệu Pdf2Learn. App sẽ khởi động lại và dùng dữ liệu ở đó.`
      : `Dữ liệu hiện tại sẽ được chép sang "${target}", rồi app khởi động lại. Thư mục cũ vẫn được giữ nguyên.`,
  });
  if (response !== 0) return { changed: false };
  quitting = true;
  await stopServer();
  if (!hasData) {
    for (const name of fs.readdirSync(DATA_DIR)) {
      if (name === "electron" || name === "cache" || name === "server.pid") continue; // phiên Electron/cache tạo lại được
      fs.cpSync(path.join(DATA_DIR, name), path.join(target, name), { recursive: true });
    }
  }
  fs.writeFileSync(LOCATION_FILE, target, "utf8");
  tray?.destroy();
  app.relaunch();
  app.exit(0);
  return { changed: true };
});

/* ---------------- gói dịch (VI-Translate + Python độc lập), cài từ file .zip ---------------- */

const TRANSLATOR_DIR = path.join(DATA_DIR, "translator");
const PACK_NAME = "pdf2learn-translator";
// tar.exe của Windows giải nén được .zip (không dùng tar của Git: nó hiểu "D:" là máy từ xa).
const TAR = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe");
let installing = false;

const sendProgress = (p) => win?.webContents.send("translator:progress", p);

function sha256(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash("sha256");
    fs.createReadStream(file).on("data", (d) => h.update(d)).on("end", () => resolve(h.digest("hex"))).on("error", reject);
  });
}

/**
 * Cài gói dịch từ file zip (tạo bằng app/scripts/build-translator-pack.mjs): kiểm tra sha256 nếu có file .sha256 đi kèm,
 * giải nén vào thư mục tạm trong thư mục dữ liệu, kiểm tra có python.exe, rồi thay bản cũ. Server tự nhận ngay.
 */
async function installTranslatorFromZip(zip) {
  if (installing) throw new Error("Đang cài gói dịch");
  installing = true;
  const tmp = path.join(TRANSLATOR_DIR, ".installing");
  try {
    const shaFile = `${zip}.sha256`;
    if (fs.existsSync(shaFile)) {
      sendProgress({ phase: "verify" });
      const expected = fs.readFileSync(shaFile, "utf8").trim().split(/\s+/)[0].toLowerCase();
      if ((await sha256(zip)) !== expected) throw new Error("File gói dịch bị hỏng (sai mã sha256). Hãy tải lại.");
    }
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(tmp, { recursive: true });
    sendProgress({ phase: "extract", files: 0 });
    await new Promise((resolve, reject) => {
      const p = spawn(TAR, ["-xvf", zip, "-C", tmp], { windowsHide: true });
      let files = 0;
      let last = 0;
      const tick = (b) => {
        files += String(b).split("\n").length - 1;
        if (Date.now() - last > 300) {
          last = Date.now();
          sendProgress({ phase: "extract", files });
        }
      };
      p.stdout.on("data", tick);
      p.stderr.on("data", tick);
      p.on("error", reject);
      p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`Giải nén lỗi (mã ${code})`))));
    });
    const extracted = path.join(tmp, PACK_NAME);
    if (!fs.existsSync(path.join(extracted, "python", "python.exe"))) throw new Error("File zip không phải gói dịch của Pdf2Learn");
    sendProgress({ phase: "finish" });
    fs.rmSync(path.join(TRANSLATOR_DIR, PACK_NAME), { recursive: true, force: true });
    fs.renameSync(extracted, path.join(TRANSLATOR_DIR, PACK_NAME));
    sendProgress({ phase: "done" });
    return JSON.parse(fs.readFileSync(path.join(TRANSLATOR_DIR, PACK_NAME, "pack.json"), "utf8"));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    installing = false;
  }
}

ipcMain.handle("translator:install-file", async (_e, zipPath) => {
  let zip = zipPath;
  if (!zip) {
    const pick = await dialog.showOpenDialog(win ?? undefined, {
      title: "Chọn file gói dịch (pdf2learn-translator-*.zip)",
      filters: [{ name: "Gói dịch Pdf2Learn", extensions: ["zip"] }],
      properties: ["openFile"],
    });
    if (pick.canceled || !pick.filePaths[0]) return { installed: false };
    zip = pick.filePaths[0];
  }
  try {
    return { installed: true, pack: await installTranslatorFromZip(zip) };
  } catch (err) {
    sendProgress({ phase: "error", error: err.message });
    return { installed: false, error: err.message };
  }
});

/*
 * Tải gói dịch từ GitHub Releases. File tải dở nằm ở cache/downloads và được tải tiếp (Range) ở lần bấm sau;
 * mã sha256 lấy từ file .sha256 đăng cùng. Đổi nguồn khi chạy thử: PDF2LEARN_TRANSLATOR_URL=<url của file .zip>.
 */
const PACK_VERSION = "1.0.0";
const PACK_URL =
  process.env.PDF2LEARN_TRANSLATOR_URL ||
  `https://github.com/ToDu1504/Pdf2learn/releases/download/translator-v${PACK_VERSION}/${PACK_NAME}-${PACK_VERSION}.zip`;
const DOWNLOAD_DIR = path.join(DATA_DIR, "cache", "downloads");
let downloadAbort = null;

async function downloadTranslator() {
  if (installing || downloadAbort) throw new Error("Đang cài gói dịch");
  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
  const zip = path.join(DOWNLOAD_DIR, path.basename(new URL(PACK_URL).pathname));
  const part = `${zip}.part`;
  downloadAbort = new AbortController();
  const { signal } = downloadAbort;
  try {
    sendProgress({ phase: "download", received: 0, total: 0 });
    const shaRes = await electronNet.fetch(`${PACK_URL}.sha256`, { signal });
    if (!shaRes.ok) throw new Error(`Không lấy được mã kiểm tra của gói dịch (HTTP ${shaRes.status})`);
    fs.writeFileSync(`${zip}.sha256`, await shaRes.text());

    if (fs.existsSync(zip)) fs.renameSync(zip, part); // bản tải trước (có thể hỏng): kiểm tra lại sau khi tải
    let have = fs.existsSync(part) ? fs.statSync(part).size : 0;
    const res = await electronNet.fetch(PACK_URL, { signal, headers: have ? { Range: `bytes=${have}-` } : {} });
    if (res.status === 416) {
      /* đã tải đủ */
    } else if (!res.ok) throw new Error(`Không tải được gói dịch (HTTP ${res.status})`);
    else {
      if (res.status !== 206) have = 0; // server không hỗ trợ tải tiếp → tải lại từ đầu
      const total = have + Number(res.headers.get("content-length") || 0);
      let received = have;
      let last = 0;
      const counter = new Transform({
        transform(chunk, _enc, cb) {
          received += chunk.length;
          if (Date.now() - last > 300) {
            last = Date.now();
            sendProgress({ phase: "download", received, total });
          }
          cb(null, chunk);
        },
      });
      await pipeline(Readable.fromWeb(res.body), counter, fs.createWriteStream(part, { flags: have ? "a" : "w" }));
    }
    fs.renameSync(part, zip);
    try {
      return await installTranslatorFromZip(zip);
    } catch (err) {
      if (/sha256/.test(err.message)) fs.rmSync(zip, { force: true }); // hỏng → lần sau tải lại từ đầu
      throw err;
    }
  } catch (err) {
    if (signal.aborted) throw new Error("Đã dừng tải. Bấm tải lại để tải tiếp.");
    if (/fetch failed|ERR_/i.test(err.message)) throw new Error(`Mất kết nối khi tải gói dịch. Bấm tải lại để tải tiếp. (${err.message})`);
    throw err;
  } finally {
    downloadAbort = null;
  }
}

ipcMain.handle("translator:download", async () => {
  try {
    const pack = await downloadTranslator();
    // Đã cài xong: bỏ file zip cho nhẹ ổ.
    fs.rmSync(DOWNLOAD_DIR, { recursive: true, force: true });
    return { installed: true, pack };
  } catch (err) {
    sendProgress({ phase: "error", error: err.message });
    return { installed: false, error: err.message };
  }
});
ipcMain.handle("translator:cancel", () => {
  downloadAbort?.abort();
});

ipcMain.handle("translator:remove", async () => {
  try {
    fs.rmSync(path.join(TRANSLATOR_DIR, PACK_NAME), { recursive: true, force: true });
    return { removed: true };
  } catch (err) {
    return { removed: false, error: `Không gỡ được (có thể đang dịch dở): ${err.message}` };
  }
});

/* ---------------- vòng đời ---------------- */

app.on("second-instance", showWindow);
app.on("window-all-closed", () => {
  /* không thoát: app sống ở khay */
});
app.on("before-quit", (e) => {
  if (!quitting) {
    e.preventDefault();
    void quit();
  }
});
// Windows tắt máy / đăng xuất.
app.on("session-end", () => void quit());

app.whenReady().then(async () => {
  cleanupStaleServer();
  createTray();
  try {
    await startServer();
  } catch (err) {
    log("không khởi động được:", err);
    dialog.showErrorBox("Pdf2Learn", `Không khởi động được: ${err.message}

Nhật ký: ${DESKTOP_LOG}`);
    quitting = true;
    if (server?.pid) killTree(server.pid);
    app.exit(1);
    return;
  }
  createWindow();
  // Chạy thử tự động: sau N ms gọi đúng quy trình "Thoát" của menu khay (kiểm tra tắt sạch tiến trình).
  const quitAfter = Number(process.env.PDF2LEARN_QUIT_AFTER);
  if (quitAfter) setTimeout(() => void quit(), quitAfter);
});
