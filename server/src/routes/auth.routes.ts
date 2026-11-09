import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { User } from "../models/index.js";
import { auth, signToken } from "../middlewares/auth.js";
import { HttpError } from "../utils/HttpError.js";

export const authRoutes = Router();

const registerBody = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(6),
  full_name: z.string().trim().min(1),
});
const loginBody = z.object({ email: z.string().email().toLowerCase(), password: z.string() });

const publicUser = (u: User) => ({ id: u.id, email: u.email, full_name: u.full_name });

authRoutes.post("/register", async (req, res) => {
  const body = registerBody.parse(req.body);
  if (await User.findOne({ where: { email: body.email } })) throw new HttpError(409, "Email đã được sử dụng");
  const user = await User.create({
    email: body.email,
    full_name: body.full_name,
    password_hash: await bcrypt.hash(body.password, 10),
  });
  res.status(201).json({ token: signToken(user.id), user: publicUser(user) });
});

authRoutes.post("/login", async (req, res) => {
  const body = loginBody.parse(req.body);
  const user = await User.findOne({ where: { email: body.email } });
  if (!user || !(await bcrypt.compare(body.password, user.password_hash)))
    throw new HttpError(401, "Email hoặc mật khẩu không đúng");
  res.json({ token: signToken(user.id), user: publicUser(user) });
});

authRoutes.get("/me", auth, async (req, res) => {
  const user = await User.findByPk(req.userId);
  if (!user) throw new HttpError(404, "Không tìm thấy người dùng");
  res.json(publicUser(user));
});
