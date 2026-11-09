import { EventEmitter } from "node:events";
import type { Document } from "../models/index.js";

export type ProgressEvent = {
  status: Document["status"];
  progress: number;
  step: string | null;
  error?: string | null;
};

export const progressBus = new EventEmitter();
progressBus.setMaxListeners(100);

export const progressChannel = (docId: number) => `doc:${docId}`;

export function snapshot(doc: Document): ProgressEvent {
  return { status: doc.status, progress: doc.progress, step: doc.current_step, error: doc.error_message };
}

export async function setProgress(doc: Document, patch: Partial<Pick<Document, "status" | "progress" | "current_step" | "error_message" | "page_count">>) {
  await doc.update(patch);
  progressBus.emit(progressChannel(doc.id), snapshot(doc));
}
