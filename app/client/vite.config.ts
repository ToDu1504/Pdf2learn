import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Chạy thử giao diện app: cổng 5174, gọi server của app ở cổng 5100 (bản web dùng 5173 / 5000).
  server: { port: 5174, proxy: { "/api": "http://127.0.0.1:5100" } },
});
