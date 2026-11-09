/**
 * Chạy app ở chế độ phát triển. Terminal của VS Code đặt sẵn ELECTRON_RUN_AS_NODE=1 (khiến Electron chạy như Node
 * thuần, `require("electron").app` = undefined) → gỡ biến này trước khi mở Electron.
 */
const { spawn } = require("node:child_process");
const path = require("node:path");
const electron = require("electron");

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, [path.resolve(__dirname, "..")], { env, stdio: "inherit", windowsHide: false });
child.on("exit", (code) => process.exit(code ?? 0));
