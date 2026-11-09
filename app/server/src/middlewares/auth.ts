import type { RequestHandler } from "express";
import { User } from "../models/index.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId: number;
    }
  }
}

/**
 * App desktop: không có đăng nhập. Máy nào cài thì máy đó dùng — mọi yêu cầu thuộc về 1 người dùng cục bộ.
 * Giữ cột user_id trong DB và các hàm kiểm tra sở hữu (findOwned*) như bản web để dễ đồng bộ code.
 */
export const LOCAL_USER_ID = 1;

/** Tạo người dùng cục bộ nếu chưa có (gọi khi khởi động, sau migration). */
export async function ensureLocalUser() {
  await User.findOrCreate({
    where: { id: LOCAL_USER_ID },
    defaults: { id: LOCAL_USER_ID, email: "local@pdf2learn.app", password_hash: "-", full_name: "Bạn" },
  });
}

export const auth: RequestHandler = (req, _res, next) => {
  req.userId = LOCAL_USER_ID;
  next();
};
