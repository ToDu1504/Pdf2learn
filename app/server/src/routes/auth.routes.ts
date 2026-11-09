import { Router } from "express";
import { User } from "../models/index.js";
import { auth } from "../middlewares/auth.js";
import { HttpError } from "../utils/HttpError.js";

/** App desktop không có đăng nhập: chỉ còn /auth/me trả về người dùng cục bộ (giao diện dùng để chào tên). */
export const authRoutes = Router();

authRoutes.get("/me", auth, async (req, res) => {
  const user = await User.findByPk(req.userId);
  if (!user) throw new HttpError(404, "Không tìm thấy người dùng");
  res.json({ id: user.id, email: user.email, full_name: user.full_name });
});
