import multer from "multer";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { open } from "node:fs/promises";
import path from "node:path";
import { env } from "../config/env.js";
import { HttpError } from "../utils/HttpError.js";

export const PDF_DIR = path.resolve(env.UPLOAD_DIR, "pdf");
mkdirSync(PDF_DIR, { recursive: true });

export const pdfPath = (fileName: string) => path.join(PDF_DIR, path.basename(fileName));

export const uploadPdf = multer({
  storage: multer.diskStorage({
    destination: PDF_DIR,
    filename: (_req, _file, cb) => cb(null, `${randomUUID()}.pdf`),
  }),
  limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024 },
  fileFilter: (_req, file, cb) =>
    file.mimetype === "application/pdf" ? cb(null, true) : cb(new HttpError(400, "Chỉ chấp nhận file PDF")),
}).single("file");

/** Kiểm tra magic bytes, không tin mimetype do client gửi. */
export async function isPdf(filePath: string) {
  const fh = await open(filePath, "r");
  try {
    const buf = Buffer.alloc(5);
    await fh.read(buf, 0, 5, 0);
    return buf.toString("latin1") === "%PDF-";
  } finally {
    await fh.close();
  }
}
