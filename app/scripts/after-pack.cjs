/**
 * electron-builder bỏ mọi thư mục node_modules ngoài dependency của package gốc (kể cả trong extraResources).
 * Server của app có node_modules riêng (build/server/node_modules, cài bởi stage.mjs) → chép vào sau khi đóng gói,
 * trước khi tạo bộ cài.
 */
const fs = require("node:fs");
const path = require("node:path");

exports.default = async function afterPack(context) {
  const src = path.join(__dirname, "..", "build", "server", "node_modules");
  const dest = path.join(context.appOutDir, "resources", "server", "node_modules");
  fs.cpSync(src, dest, { recursive: true });
  console.log(`  • đã chép node_modules của server (${fs.readdirSync(dest).length} gói) → ${dest}`);
};
