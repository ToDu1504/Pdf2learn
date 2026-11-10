// Thử tìm hình minh họa: npx tsx scripts/try-figures.ts <file.pdf> <từ trang> <tới trang>
import { readFile } from "node:fs/promises";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { pageFigures } from "../src/services/figures.service.js";

const [file, from = "1", to = "50"] = process.argv.slice(2);
const pdf = await getDocument({ data: new Uint8Array(await readFile(file)), useSystemFonts: true, verbosity: 0 }).promise;
let n = 0;
const t = Date.now();
for (let p = Number(from); p <= Math.min(Number(to), pdf.numPages); p++) {
  const figs = await pageFigures(await pdf.getPage(p));
  for (const f of figs) {
    n++;
    console.log(`tr. ${p}: x=${f.x} y=${f.y} w=${f.w} h=${f.h}  ${f.caption ?? "(không chú thích)"}`);
  }
}
console.log(`${n} hình, ${Date.now() - t} ms`);
process.exit(0);
