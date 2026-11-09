import axios, { AxiosError } from "axios";
import { fetchEventSource } from "@microsoft/fetch-event-source";
import { useAuth } from "../stores/auth";

export const http = axios.create({ baseURL: "/api/v1" });

http.interceptors.request.use((config) => {
  const token = useAuth.getState().token;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

http.interceptors.response.use(
  (r) => r,
  (err: AxiosError) => {
    if (err.response?.status === 401 && useAuth.getState().token) {
      useAuth.getState().logout();
      window.location.assign("/login");
    }
    return Promise.reject(err);
  },
);

export function errorMessage(err: unknown, fallback = "Đã có lỗi xảy ra"): string {
  if (err instanceof AxiosError) {
    const data = err.response?.data as { error?: string } | undefined;
    if (data?.error) return data.error;
    if (!err.response) return "Không kết nối được máy chủ";
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

export const authHeader = (): Record<string, string> => {
  const token = useAuth.getState().token;
  return token ? { Authorization: `Bearer ${token}` } : {};
};

/** POST trả về luồng SSE (gia sư AI). EventSource gốc không POST/không gửi header được nên dùng fetch-event-source. */
export async function postStream<E>(path: string, body: unknown, onEvent: (e: E) => void, signal?: AbortSignal) {
  await fetchEventSource(`/api/v1${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeader() },
    body: JSON.stringify(body),
    signal,
    openWhenHidden: true,
    async onopen(res) {
      if (res.ok) return;
      let msg = `Lỗi ${res.status}`;
      try {
        msg = ((await res.json()) as { error?: string }).error ?? msg;
      } catch {
        /* không phải JSON */
      }
      throw new Error(msg);
    },
    onmessage(ev) {
      if (ev.data) onEvent(JSON.parse(ev.data) as E);
    },
    onerror(err) {
      throw err; // không tự kết nối lại: mỗi tin nhắn chỉ gửi 1 lần
    },
  });
}

/** Tải file cần token (CSV, WAV) rồi kích hoạt lưu. */
export async function download(path: string, fallbackName: string) {
  const res = await http.get(path, { responseType: "blob" });
  const cd = (res.headers["content-disposition"] as string | undefined) ?? "";
  const name = /filename="?([^";]+)"?/.exec(cd)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(res.data as Blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
