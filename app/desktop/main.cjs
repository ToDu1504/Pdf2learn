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
const { app, BrowserWindow, Menu, Tray, nativeImage, shell, dialog } = require("electron");
const { fork, execFileSync } = require("node:child_process");
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
let trayHintShown = false;
const PID_FILE = path.join(DATA_DIR, "server.pid");

const log = (...a) => console.log("[desktop]", ...a);

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
  const serverDir = path.join(APP_DIR, "server");
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
  server.on("exit", (code) => {
    fs.rmSync(PID_FILE, { force: true });
    if (!quitting) {
      dialog.showErrorBox("Pdf2Learn", `Máy chủ của app đã dừng (mã ${code}). Xem nhật ký: ${path.join(ELECTRON_DIR, "server.log")}`);
      quit();
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
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
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
  // Đóng cửa sổ = thu xuống khay; việc soạn/dịch nền vẫn chạy.
  win.on("close", (e) => {
    if (quitting) return;
    e.preventDefault();
    win?.hide();
    if (!trayHintShown && tray) {
      trayHintShown = true;
      tray.displayBalloon({
        iconType: "info",
        title: "Pdf2Learn vẫn đang chạy",
        content: "App thu xuống khay để tiếp tục soạn bài và dịch ở nền. Bấm biểu tượng để mở lại, chuột phải → Thoát để tắt hẳn.",
      });
    }
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
    dialog.showErrorBox("Pdf2Learn", `Không khởi động được: ${err.message}`);
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
