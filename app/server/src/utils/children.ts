import { execFileSync, type ChildProcess } from "node:child_process";

/**
 * Sổ theo dõi tiến trình con (Python của engine dịch, và Chrome mà engine mở). Khi app thoát phải kết thúc cả cây
 * tiến trình, nếu không chúng chạy sót (giữ cổng, khóa hồ sơ trình duyệt, tốn CPU).
 */
const children = new Set<ChildProcess>();

export function track<T extends ChildProcess>(child: T): T {
  children.add(child);
  child.once("exit", () => children.delete(child));
  return child;
}

/** Kết thúc cả cây tiến trình (Windows: taskkill /T kéo theo Chrome do Python mở). */
export function killTree(pid: number) {
  try {
    if (process.platform === "win32") execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    else process.kill(-pid, "SIGKILL");
  } catch {
    /* đã thoát */
  }
}

export function killAllChildren() {
  for (const c of children) if (c.pid && c.exitCode === null) killTree(c.pid);
  children.clear();
}
