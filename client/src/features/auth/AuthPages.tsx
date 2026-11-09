import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { errorMessage, http } from "../../api/client";
import { Button } from "../../components/ui";
import { Logo } from "../../components/Layout";
import { useAuth } from "../../stores/auth";
import type { User } from "../../types";

type Mode = "login" | "register";

function AuthForm({ mode }: { mode: Mode }) {
  const setAuth = useAuth((s) => s.setAuth);
  const token = useAuth((s) => s.token);
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ email: "", password: "", full_name: "" });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (token) return <Navigate to="/app" replace />;

  const validate = () => {
    if (!/^\S+@\S+\.\S+$/.test(form.email)) return "Email không hợp lệ";
    if (form.password.length < 6) return "Mật khẩu tối thiểu 6 ký tự";
    if (mode === "register" && !form.full_name.trim()) return "Nhập họ tên";
    return null;
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const v = validate();
    if (v) return setError(v);
    setLoading(true);
    setError(null);
    try {
      const body = mode === "login" ? { email: form.email, password: form.password } : form;
      const { data } = await http.post<{ token: string; user: User }>(`/auth/${mode}`, body);
      setAuth(data.token, data.user);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from ?? "/app", { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const field = (key: keyof typeof form, label: string, type = "text", autoComplete?: string) => (
    <div>
      <label className="label" htmlFor={key}>
        {label}
      </label>
      <input
        id={key}
        type={type}
        autoComplete={autoComplete}
        className="input"
        value={form[key]}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
      />
    </div>
  );

  return (
    <div className="grid min-h-screen place-items-center bg-slate-50 px-4 dark:bg-black">
      <div className="w-full max-w-sm">
        <Link to="/" className="mb-6 flex justify-center text-xl">
          <Logo />
        </Link>
        <form onSubmit={submit} className="space-y-4 rounded-3xl bg-white p-8 shadow-[0_20px_60px_-20px_rgba(0,0,0,0.15)] dark:bg-slate-900" noValidate>
          <div>
            <h1 className="text-[28px] font-semibold">{mode === "login" ? "Đăng nhập" : "Tạo tài khoản"}</h1>
            <p className="text-sm text-slate-500">{mode === "login" ? "Chào mừng bạn quay lại." : "Bắt đầu ôn tập thông minh hơn"}</p>
          </div>
          {mode === "register" && field("full_name", "Họ tên", "text", "name")}
          {field("email", "Email", "email", "email")}
          {field("password", "Mật khẩu", "password", mode === "login" ? "current-password" : "new-password")}
          {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">{error}</p>}
          <Button type="submit" className="w-full" loading={loading}>
            {mode === "login" ? "Đăng nhập" : "Đăng ký"}
          </Button>
          <p className="text-center text-sm text-slate-500">
            {mode === "login" ? (
              <>
                Chưa có tài khoản?{" "}
                <Link className="font-medium text-brand-600" to="/register">
                  Đăng ký
                </Link>
              </>
            ) : (
              <>
                Đã có tài khoản?{" "}
                <Link className="font-medium text-brand-600" to="/login">
                  Đăng nhập
                </Link>
              </>
            )}
          </p>
        </form>
      </div>
    </div>
  );
}

export const LoginPage = () => <AuthForm mode="login" />;
export const RegisterPage = () => <AuthForm mode="register" />;

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const token = useAuth((s) => s.token);
  const location = useLocation();
  if (!token) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}
