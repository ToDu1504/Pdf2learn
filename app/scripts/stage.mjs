/**
 * Chuẩn bị thư mục app/build/ để electron-builder đóng gói (chỉ những thứ cần để chạy):
 *
 *   build/package.json        tên, phiên bản, main = desktop/main.cjs (không có dependency ở gốc)
 *   build/desktop/            main.cjs, preload.cjs, assets
 *   build/client/dist/        giao diện đã build
 *   build/server/dist/        server đã biên dịch sang JS
 *   build/server/scripts/     script Python (cắt/ghép PDF, sửa PDF hỏng) + bản vá sitecustomize
 *   build/server/node_modules thư viện chạy (npm ci --omit=dev)
 *
 * Chạy: cd app && node scripts/stage.mjs   (npm run dist gọi sẵn)
 */
import { execSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUILD = path.join(APP, "build");
const NPM_CACHE = path.resolve(APP, "..", ".cache", "npm"); // cache npm trên ổ D, không ở ổ C
const run = (cmd, cwd) => {
  console.log(`$ ${cmd}`);
  execSync(cmd, { cwd, stdio: "inherit" });
};

const pkg = JSON.parse(readFileSync(path.join(APP, "package.json"), "utf8"));

run("npm run build", path.join(APP, "client"));
rmSync(path.join(APP, "server", "dist"), { recursive: true, force: true });
run("npx tsc -p tsconfig.build.json", path.join(APP, "server"));

rmSync(BUILD, { recursive: true, force: true });
mkdirSync(BUILD, { recursive: true });
writeFileSync(
  path.join(BUILD, "package.json"),
  JSON.stringify({ name: pkg.name, productName: pkg.productName, version: pkg.version, description: pkg.description, author: "Pdf2Learn", main: "desktop/main.cjs" }, null, 2),
);
for (const f of ["main.cjs", "preload.cjs"]) cpSync(path.join(APP, "desktop", f), path.join(BUILD, "desktop", f));
cpSync(path.join(APP, "desktop", "assets"), path.join(BUILD, "desktop", "assets"), { recursive: true });
cpSync(path.join(APP, "client", "dist"), path.join(BUILD, "client", "dist"), { recursive: true });
cpSync(path.join(APP, "server", "dist"), path.join(BUILD, "server", "dist"), { recursive: true });
cpSync(path.join(APP, "server", "scripts"), path.join(BUILD, "server", "scripts"), {
  recursive: true,
  filter: (src) => !/\.ts$/.test(src) && !/__pycache__/.test(src), // chỉ script Python + pyhooks (script .ts là công cụ phát triển)
});
for (const f of ["package.json", "package-lock.json"]) cpSync(path.join(APP, "server", f), path.join(BUILD, "server", f));
run(`npm ci --omit=dev --no-audit --no-fund --cache "${NPM_CACHE}"`, path.join(BUILD, "server"));
console.log(`\n✔ ${BUILD}`);
