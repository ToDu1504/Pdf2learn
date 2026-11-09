import { Chapter, Document } from "../models/index.js";
import { HttpError } from "../utils/HttpError.js";

// Mọi route có :id phải lấy dữ liệu qua đây để chặn truy cập tài liệu của người khác (IDOR).

export async function findOwnedDocument(id: string | number, userId: number) {
  const doc = await Document.findOne({ where: { id, user_id: userId } });
  if (!doc) throw new HttpError(404, "Không tìm thấy tài liệu");
  return doc;
}

export async function findOwnedChapter(id: string | number, userId: number) {
  const chapter = await Chapter.findByPk(id);
  if (!chapter) throw new HttpError(404, "Không tìm thấy chương");
  const doc = await findOwnedDocument(chapter.document_id, userId);
  return { chapter, doc };
}
