import { Router } from "express";
import { existsSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { z } from "zod";
import { sequelize } from "../config/db.js";
import { Chapter, Document, RoadmapSection } from "../models/index.js";
import { auth } from "../middlewares/auth.js";
import { isPdf, pdfPath, uploadPdf } from "../middlewares/upload.js";
import { HttpError } from "../utils/HttpError.js";
import { findOwnedDocument } from "../services/access.js";
import { enqueueDocument, rebuildRoadmap } from "../jobs/processDocument.js";
import { isAnalyzing } from "../services/chapterAnalysis.service.js";
import { MAX_TRANSLATE_PAGES, translatePages } from "../services/translate.service.js";
import {
  cancelFullTranslation,
  chunkFile,
  chunkOf,
  fullStatus,
  fullTranslatedFile,
  isPdfTranslatorInstalled,
  requestChunk,
  startFullTranslation,
} from "../services/translate/pdfTranslate.service.js";
import { progressBus, progressChannel, snapshot, type ProgressEvent } from "../jobs/progressBus.js";

export const documentRoutes = Router();
documentRoutes.use(auth);

documentRoutes.post("/", uploadPdf, async (req, res) => {
  const file = req.file;
  if (!file) throw new HttpError(400, "Thiếu file PDF");
  if (!(await isPdf(file.path))) {
    await unlink(file.path);
    throw new HttpError(400, "File không phải PDF hợp lệ");
  }
  // Multer giải mã tên file theo latin1, đổi lại sang utf8 để giữ dấu tiếng Việt.
  const originalName = Buffer.from(file.originalname, "latin1").toString("utf8");
  const title = (req.body.title as string | undefined)?.trim() || originalName.replace(/\.pdf$/i, "");
  const doc = await Document.create({
    user_id: req.userId,
    title: title.slice(0, 250),
    file_path: file.filename,
    file_size: file.size,
  });
  enqueueDocument(doc.id);
  res.status(201).json(doc);
});

documentRoutes.get("/", async (req, res) => {
  const docs = await Document.findAll({ where: { user_id: req.userId }, order: [["created_at", "DESC"]], attributes: { exclude: ["roadmap_report"] } });
  const counts = (await Chapter.findAll({
    attributes: ["document_id", [sequelize.fn("COUNT", sequelize.col("id")), "n"], [sequelize.fn("COUNT", sequelize.col("completed_at")), "completed"]],
    where: { document_id: docs.map((d) => d.id) },
    group: ["document_id"],
    raw: true,
  })) as unknown as { document_id: number; n: number; completed: number }[];
  const byDoc = new Map(counts.map((c) => [c.document_id, { n: Number(c.n), completed: Number(c.completed) }]));
  res.json(docs.map((d) => ({ ...d.toJSON(), chapter_count: byDoc.get(d.id)?.n ?? 0, completed_count: byDoc.get(d.id)?.completed ?? 0, file_hash: undefined })));
});

documentRoutes.get("/:id", async (req, res) => {
  const doc = await findOwnedDocument(req.params.id, req.userId);
  const chapters = await Chapter.findAll({
    where: { document_id: doc.id },
    order: [["order_index", "ASC"]],
    attributes: ["id", "order_index", "title", "source_title", "start_page", "end_page", "status", "section_id", "description", "importance", "est_minutes", "completed_at"],
  });
  const sections = await RoadmapSection.findAll({ where: { document_id: doc.id }, order: [["order_index", "ASC"]] });
  res.json({
    ...doc.toJSON(),
    file_hash: undefined,
    sections,
    chapters: chapters.map((c) => ({ ...c.toJSON(), analyzing: isAnalyzing(c.id) })),
  });
});

const titleBody = z.object({ title: z.string().trim().min(1, "Tiêu đề không được để trống").max(250) });

/** Đổi tên tài liệu. */
documentRoutes.patch("/:id", async (req, res) => {
  const doc = await findOwnedDocument(req.params.id, req.userId);
  const { title } = titleBody.parse(req.body);
  await doc.update({ title });
  res.json({ id: doc.id, title: doc.title });
});

/** Đổi tên chặng trong lộ trình. */
documentRoutes.patch("/:id/sections/:sectionId", async (req, res) => {
  const doc = await findOwnedDocument(req.params.id, req.userId);
  const { title } = titleBody.parse(req.body);
  const section = await RoadmapSection.findOne({ where: { id: Number(req.params.sectionId), document_id: doc.id } });
  if (!section) throw new HttpError(404, "Không tìm thấy chặng");
  await section.update({ title });
  res.json({ id: section.id, title: section.title });
});

/** SSE tiến độ. Gửi trạng thái hiện tại ngay khi kết nối để không lỡ sự kiện đã phát trước đó. */
documentRoutes.get("/:id/progress", async (req, res) => {
  const doc = await findOwnedDocument(req.params.id, req.userId);
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" });
  res.flushHeaders();
  const send = (data: ProgressEvent) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    if (data.status === "done" || data.status === "failed") res.end();
  };
  const channel = progressChannel(doc.id);
  const ping = setInterval(() => res.write(": ping\n\n"), 25_000);
  progressBus.on(channel, send);
  req.on("close", () => {
    clearInterval(ping);
    progressBus.off(channel, send);
  });
  send(snapshot(doc));
});

documentRoutes.get("/:id/file", async (req, res) => {
  const doc = await findOwnedDocument(req.params.id, req.userId);
  res.type("application/pdf").sendFile(pdfPath(doc.file_path));
});

const chaptersBody = z.object({
  chapters: z
    .array(z.object({ title: z.string().trim().min(1).max(250), start_page: z.number().int().min(1), end_page: z.number().int().min(1) }))
    .min(1),
});

/** Sửa ranh giới chương khi tách sai. Chương đổi ranh giới sẽ mất kết quả AI cũ và được xử lý lại. */
documentRoutes.patch("/:id/chapters", async (req, res) => {
  const doc = await findOwnedDocument(req.params.id, req.userId);
  const { chapters } = chaptersBody.parse(req.body);
  const max = doc.page_count ?? Infinity;
  const sorted = [...chapters].sort((a, b) => a.start_page - b.start_page);
  sorted.forEach((c, i) => {
    if (c.end_page < c.start_page || c.end_page > max) throw new HttpError(400, `Chương "${c.title}" có khoảng trang không hợp lệ`);
    if (i > 0 && c.start_page <= sorted[i - 1].end_page) throw new HttpError(400, "Các chương bị chồng trang lên nhau");
  });

  const old = await Chapter.findAll({ where: { document_id: doc.id } });
  const key = (c: { start_page: number; end_page: number }) => `${c.start_page}-${c.end_page}`;
  const oldByRange = new Map(old.map((c) => [key(c), c]));

  await sequelize.transaction(async (transaction) => {
    const keep = new Set<number>();
    for (const [i, c] of sorted.entries()) {
      const existing = oldByRange.get(key(c));
      if (existing) {
        keep.add(existing.id);
        await existing.update({ title: c.title, order_index: i }, { transaction });
      } else {
        await Chapter.create({ ...c, document_id: doc.id, order_index: i }, { transaction });
      }
    }
    // Xóa chương cũ (cascade xóa tóm tắt, câu hỏi, flashcard của chương đó).
    await Chapter.destroy({ where: { id: old.filter((c) => !keep.has(c.id)).map((c) => c.id) }, transaction });
  });

  if (await Chapter.count({ where: { document_id: doc.id, status: ["pending", "failed"] } })) {
    await doc.update({ status: "queued", progress: 15, error_message: null });
    enqueueDocument(doc.id);
  }
  res.json(await Chapter.findAll({ where: { document_id: doc.id }, order: [["order_index", "ASC"]] }));
});

/**
 * Bản dịch tiếng Việt của các trang [from, to] trong PDF gốc (tối đa MAX_TRANSLATE_PAGES trang / lần).
 * Nội dung trích dẫn trải nhiều trang → dịch cả khoảng trong 1 lượt AI; trang đã dịch lấy từ cache.
 */
documentRoutes.get("/:id/translation", async (req, res) => {
  const doc = await findOwnedDocument(req.params.id, req.userId);
  const q = z.object({ from: z.coerce.number().int().min(1), to: z.coerce.number().int().min(1).optional() }).parse(req.query);
  const max = doc.page_count ?? q.from;
  const from = Math.min(q.from, max);
  const to = Math.min(Math.max(q.to ?? from, from), max, from + MAX_TRANSLATE_PAGES - 1);
  res.json({ from, to, pages: await translatePages(doc, from, to, req.userId) });
});

/**
 * Bản dịch PDF giữ bố cục (VI-Translate), theo cụm trang. Gọi lặp lại để theo dõi tiến độ.
 * available = false → chưa cài engine, client dùng bản dịch chữ ở /translation.
 */
documentRoutes.get("/:id/translation/pdf", async (req, res) => {
  const doc = await findOwnedDocument(req.params.id, req.userId);
  if (!isPdfTranslatorInstalled()) return void res.json({ available: false });
  const q = z.object({ page: z.coerce.number().int().min(1), retry: z.coerce.boolean().optional() }).parse(req.query);
  const page = Math.min(q.page, doc.page_count ?? q.page);
  res.json({ available: true, ...requestChunk(doc, page, req.userId, q.retry) });
});

documentRoutes.get("/:id/translation/pdf/:chunk", async (req, res) => {
  const doc = await findOwnedDocument(req.params.id, req.userId);
  const chunk = z.coerce.number().int().min(0).parse(req.params.chunk);
  if (chunk > chunkOf(doc.page_count ?? 1)) throw new HttpError(404, "Không có cụm trang này");
  const file = chunkFile(doc, chunk);
  if (!existsSync(file)) throw new HttpError(404, "Cụm trang này chưa được dịch");
  res.type("application/pdf").sendFile(file);
});

/** Dịch toàn bộ PDF ở nền (theo cụm, qua Google trên trình duyệt). */
documentRoutes.get("/:id/translation/full", async (req, res) => {
  const doc = await findOwnedDocument(req.params.id, req.userId);
  if (!isPdfTranslatorInstalled()) return res.json({ available: false });
  res.json({ available: true, ...fullStatus(doc) });
});

documentRoutes.post("/:id/translation/full", async (req, res) => {
  const doc = await findOwnedDocument(req.params.id, req.userId);
  if (!isPdfTranslatorInstalled()) throw new HttpError(409, "Server chưa cài VI-Translate (xem README)");
  res.status(202).json({ available: true, ...startFullTranslation(doc, req.userId) });
});

documentRoutes.delete("/:id/translation/full", async (req, res) => {
  const doc = await findOwnedDocument(req.params.id, req.userId);
  res.json({ available: true, ...cancelFullTranslation(doc) });
});

/** Tải bản dịch toàn bộ (ghép các cụm). */
documentRoutes.get("/:id/translation/full/file", async (req, res) => {
  const doc = await findOwnedDocument(req.params.id, req.userId);
  const file = await fullTranslatedFile(doc);
  if (!file) throw new HttpError(409, "Chưa dịch xong toàn bộ tài liệu");
  res.download(file, `${doc.title.replace(/[\\/:*?"<>|]+/g, " ").trim() || "tai-lieu"} - tiếng Việt.pdf`);
});

/** Lập lại roadmap từ mục lục sách. Bài giữ nguyên khoảng trang thì giữ bài giảng và tiến độ. */
documentRoutes.post("/:id/roadmap/rebuild", async (req, res) => {
  const doc = await findOwnedDocument(req.params.id, req.userId);
  if (doc.status === "processing" || doc.status === "queued") throw new HttpError(409, "Tài liệu đang được xử lý");
  await rebuildRoadmap(doc);
  res.status(202).json({ status: "queued" });
});

documentRoutes.post("/:id/retry", async (req, res) => {
  const doc = await findOwnedDocument(req.params.id, req.userId);
  if (doc.status === "processing" || doc.status === "queued") throw new HttpError(409, "Tài liệu đang được xử lý");
  await Chapter.update({ status: "pending" }, { where: { document_id: doc.id, status: "failed" } });
  await doc.update({ status: "queued", error_message: null });
  enqueueDocument(doc.id);
  res.json(doc);
});

documentRoutes.delete("/:id", async (req, res) => {
  const doc = await findOwnedDocument(req.params.id, req.userId);
  await doc.destroy();
  await unlink(pdfPath(doc.file_path)).catch(() => {});
  res.status(204).end();
});
