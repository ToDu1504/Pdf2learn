import { Router } from "express";
import rateLimit from "express-rate-limit";
import type { Content } from "@google/genai";
import { z } from "zod";
import { TutorMessage, TutorSession, type ToolCallLog } from "../models/index.js";
import { auth } from "../middlewares/auth.js";
import { HttpError } from "../utils/HttpError.js";
import { findOwnedDocument } from "../services/access.js";
import { runTutor, type TutorEvent } from "../services/ai/tutor.agent.js";

export const tutorRoutes = Router();
tutorRoutes.use(auth);

const HISTORY_LIMIT = 20;

async function ownSession(id: string, userId: number) {
  const session = await TutorSession.findOne({ where: { id, user_id: userId } });
  if (!session) throw new HttpError(404, "Không tìm thấy phiên chat");
  return session;
}

tutorRoutes.get("/sessions", async (req, res) => {
  const doc = await findOwnedDocument(String(req.query.documentId), req.userId);
  res.json(await TutorSession.findAll({ where: { user_id: req.userId, document_id: doc.id }, order: [["id", "DESC"]] }));
});

tutorRoutes.post("/sessions", async (req, res) => {
  const { documentId } = z.object({ documentId: z.number().int() }).parse(req.body);
  const doc = await findOwnedDocument(documentId, req.userId);
  if (doc.status !== "done") throw new HttpError(409, "Tài liệu chưa xử lý xong");
  const session = await TutorSession.create({ user_id: req.userId, document_id: doc.id, title: "Cuộc trò chuyện mới" });
  res.status(201).json(session);
});

tutorRoutes.get("/sessions/:id", async (req, res) => {
  const session = await ownSession(req.params.id, req.userId);
  const messages = await TutorMessage.findAll({ where: { session_id: session.id }, order: [["id", "ASC"]] });
  res.json({ ...session.toJSON(), messages });
});

tutorRoutes.delete("/sessions/:id", async (req, res) => {
  const session = await ownSession(req.params.id, req.userId);
  await session.destroy();
  res.status(204).end();
});

const limiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  keyGenerator: (req) => String(req.userId),
  message: { error: "Bạn đã gửi quá 30 tin nhắn trong 1 giờ, nghỉ một chút nhé." },
  standardHeaders: "draft-8",
  legacyHeaders: false,
});

/** Gửi tin nhắn. Phản hồi là luồng SSE: text / tool / quiz / done / error. */
tutorRoutes.post("/sessions/:id/messages", limiter, async (req, res) => {
  const { content } = z.object({ content: z.string().trim().min(1).max(4000) }).parse(req.body);
  const session = await ownSession(String(req.params.id), req.userId);
  const doc = await findOwnedDocument(session.document_id, req.userId);

  const past = await TutorMessage.findAll({
    where: { session_id: session.id, role: ["user", "model"] },
    order: [["id", "DESC"]],
    limit: HISTORY_LIMIT,
  });
  const history: Content[] = past
    .reverse()
    .map((m) => ({ role: m.role, parts: [{ text: m.content }] }));
  history.push({ role: "user", parts: [{ text: content }] });

  await TutorMessage.create({ session_id: session.id, role: "user", content });
  if (session.title === "Cuộc trò chuyện mới") await session.update({ title: content.slice(0, 80) });

  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" });
  res.flushHeaders();
  let closed = false;
  req.on("close", () => (closed = true));
  const send = (e: TutorEvent | { type: "done"; messageId: number } | { type: "error"; message: string }) => {
    if (!closed) res.write(`data: ${JSON.stringify(e)}\n\n`);
  };

  try {
    const { answer, toolLogs } = await runTutor({ userId: req.userId, doc, emit: send }, history);
    const saved = await TutorMessage.create({
      session_id: session.id,
      role: "model",
      content: answer,
      tool_calls: toolLogs.length ? (toolLogs as ToolCallLog[]) : null,
    });
    send({ type: "done", messageId: saved.id });
  } catch (err) {
    console.error("[tutor]", err);
    send({ type: "error", message: (err as Error).message || "Gia sư AI gặp lỗi" });
  }
  res.end();
});
