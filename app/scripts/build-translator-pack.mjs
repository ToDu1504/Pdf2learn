/**
 * Đóng gói "gói dịch" cho app desktop (dịch PDF giữ bố cục bằng VI-Translate), chạy trên máy phát triển:
 *
 *   cd app && node scripts/build-translator-pack.mjs
 *
 * Kết quả: app/dist/pdf2learn-translator-<phiên bản>.zip (+ .sha256). Bên trong:
 *   python/        Python 3.12 độc lập (bản build của uv) + thư viện của VI-Translate trong Lib/site-packages
 *   vi-translate/  mã nguồn VI-Translate (git archive đúng commit đang dùng) + LICENSE AGPL-3.0
 *   home/          thư mục "home" của engine, có sẵn mô hình nhận bố cục trang (khỏi tải lúc chạy)
 *   pack.json      phiên bản, commit VI-Translate, phiên bản Python
 * Mọi file tạm nằm trong .cache/ của dự án (không ghi ra ổ C).
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, createReadStream, existsSync, mkdirSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = path.resolve(APP, "..");
const VT = path.join(ROOT, "vi-translate");
const VERSION = "1.0.0";
const WORK = path.join(ROOT, ".cache", "translator-pack");
const STAGE = path.join(WORK, "pdf2learn-translator");
const OUT = path.join(APP, "dist", `pdf2learn-translator-${VERSION}.zip`);

// tar.exe của Windows (bsdtar): giải nén/tạo zip; KHÔNG dùng tar của Git (hiểu "D:" là máy từ xa).
const TAR = path.join(process.env.SystemRoot ?? "C:\Windows", "System32", "tar.exe");
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: "utf8", windowsHide: true, ...opts }).trim();
const step = (m) => console.log(`\n▶ ${m}`);
const size = (p) => {
  let n = 0;
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else n += statSync(f).size;
    }
  };
  statSync(p).isDirectory() ? walk(p) : (n = statSync(p).size);
  return `${(n / 1024 / 1024).toFixed(0)}MB`;
};

// 1. Python độc lập: lấy đúng bản Python mà venv của vi-translate dùng (ghi trong pyvenv.cfg).
const cfg = Object.fromEntries(
  sh("cmd", ["/c", "type", path.join(VT, ".venv", "pyvenv.cfg")])
    .split(/\r?\n/)
    .map((l) => l.split(" = ").map((s) => s.trim())),
);
let pythonHome = cfg.home;
if (!existsSync(path.join(pythonHome, "python.exe"))) {
  // uv tạo liên kết "cpython-3.12-..." trỏ tới bản cụ thể "cpython-3.12.x-..."
  const base = path.dirname(pythonHome);
  pythonHome = path.join(base, readdirSync(base).find((d) => /^cpython-3\.12\.\d+-windows/.test(d)));
}
// uv để "cpython-3.12-…" là junction trỏ tới bản thật: lấy đường dẫn thật, nếu không cpSync chỉ chép cái junction.
pythonHome = realpathSync(pythonHome);
const pyVersion = sh(path.join(pythonHome, "python.exe"), ["-c", "import sys;print(sys.version.split()[0])"]);
const commit = sh("git", ["-C", VT, "rev-parse", "HEAD"]);
console.log(`Python ${pyVersion} (${pythonHome}) · VI-Translate ${commit.slice(0, 10)}`);

rmSync(WORK, { recursive: true, force: true });
mkdirSync(STAGE, { recursive: true });

step("Chép Python độc lập");
const skipPy = (src) => !/[\\/](__pycache__|test|tests|idlelib|tkinter|turtledemo)([\\/]|$)/i.test(src.slice(pythonHome.length));
cpSync(pythonHome, path.join(STAGE, "python"), { recursive: true, dereference: true, filter: skipPy });

step("Chép thư viện của VI-Translate vào Lib/site-packages");
const site = path.join(VT, ".venv", "Lib", "site-packages");
const skipSite = (src) => {
  const rel = src.slice(site.length);
  return !/[\\/]__pycache__([\\/]|$)/.test(rel) && !/^[\\/]_virtualenv\.(py|pth)$/.test(rel);
};
cpSync(site, path.join(STAGE, "python", "Lib", "site-packages"), { recursive: true, dereference: true, filter: skipSite });
console.log(`python/: ${size(path.join(STAGE, "python"))}`);

step("Mã nguồn VI-Translate (git archive)");
const tarFile = path.join(WORK, "vi-translate.tar");
sh("git", ["-C", VT, "archive", "--format=tar", "-o", tarFile, "HEAD"]);
mkdirSync(path.join(STAGE, "vi-translate"));
sh(TAR, ["-xf", tarFile, "-C", path.join(STAGE, "vi-translate")]);
rmSync(tarFile);
for (const heavy of ["android", "research", "agent-knowledge", "docs", "tests"]) rmSync(path.join(STAGE, "vi-translate", heavy), { recursive: true, force: true });

step("Mô hình nhận bố cục trang");
const models = path.join(VT, ".home", ".cache", "babeldoc", "models");
cpSync(models, path.join(STAGE, "home", ".cache", "babeldoc", "models"), { recursive: true, dereference: true });
console.log(`home/: ${size(path.join(STAGE, "home"))}`);

writeFileSync(
  path.join(STAGE, "pack.json"),
  JSON.stringify({ name: "pdf2learn-translator", version: VERSION, python: pyVersion, vi_translate_commit: commit, built_at: new Date().toISOString() }, null, 2),
);
writeFileSync(
  path.join(STAGE, "README.txt"),
  [
    "Gói dịch của Pdf2Learn: dịch PDF sang tiếng Việt, giữ nguyên bố cục.",
    "",
    "Gồm VI-Translate (https://github.com/breslee1707/VI-Translate, AGPL-3.0, xem vi-translate/LICENSE),",
    `commit ${commit}, chạy bằng Python ${pyVersion} độc lập và các thư viện mã nguồn mở đi kèm.`,
    "Pdf2Learn gọi VI-Translate như một chương trình riêng. Bản vá lúc chạy (sitecustomize.py) công khai tại",
    "https://github.com/ToDu1504/Pdf2learn (app/server/scripts/pyhooks).",
  ].join("\r\n"),
);

step("Kiểm tra gói chạy được độc lập");
const py = path.join(STAGE, "python", "python.exe");
console.log(sh(py, ["-I", "-c", "import fitz, onnxruntime, pikepdf, babeldoc, websocket; print('import OK: fitz', fitz.VersionBind)"], { cwd: path.join(STAGE, "vi-translate") }));

step("Nén");
mkdirSync(path.dirname(OUT), { recursive: true });
rmSync(OUT, { force: true });
// Tạo zip bằng Python của chính gói (zipfile chuẩn). tar.exe của Windows tạo zip thiếu file mà không báo lỗi.
sh(py, ["-I", "-c", "import shutil,sys; shutil.make_archive(sys.argv[1], 'zip', sys.argv[2], 'pdf2learn-translator')", OUT.replace(/\.zip$/, ""), WORK]);
const count = sh(py, ["-I", "-c", "import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); print(len(z.infolist()), sum(i.file_size for i in z.infolist())//1048576)", OUT]);
console.log(`zip: ${count.split(" ")[0]} file, ${count.split(" ")[1]}MB khi giải nén`);
const hash = createHash("sha256");
await new Promise((res, rej) => createReadStream(OUT).on("data", (d) => hash.update(d)).on("end", res).on("error", rej));
const sha = hash.digest("hex");
writeFileSync(`${OUT}.sha256`, `${sha}  ${path.basename(OUT)}\n`);
console.log(`\n✔ ${OUT} (${size(OUT)})\n  sha256 ${sha}`);
rmSync(WORK, { recursive: true, force: true });
