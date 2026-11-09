import { useEffect } from "react";
import { useSettings } from "../api/queries";
import type { Settings } from "../types";

export function applyTheme(theme: Settings["theme"]) {
  const dark = theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  try {
    localStorage.setItem("studyai-theme", theme);
  } catch {
    /* private mode */
  }
}

/** Đồng bộ theme từ cài đặt người dùng; theo hệ điều hành khi chọn "system". */
export function useThemeSync() {
  const { data } = useSettings();
  const theme = data?.theme;
  useEffect(() => {
    if (!theme) return;
    applyTheme(theme);
    if (theme !== "system") return;
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const on = () => applyTheme("system");
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [theme]);
}
