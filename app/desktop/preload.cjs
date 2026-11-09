/**
 * Cầu nối an toàn giữa giao diện (không có quyền Node) và tiến trình chính của Electron.
 * Giao diện kiểm tra `window.pdf2learn` để biết đang chạy trong app desktop.
 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("pdf2learn", {
  isDesktop: true,
  /** Đường dẫn thư mục dữ liệu đang dùng. */
  dataDir: () => ipcRenderer.invoke("data-dir:get"),
  /** Mở thư mục dữ liệu bằng Explorer. */
  openDataDir: () => ipcRenderer.invoke("data-dir:open"),
  /** Chọn thư mục dữ liệu mới (chép dữ liệu hiện có sang, rồi khởi động lại app). */
  chooseDataDir: () => ipcRenderer.invoke("data-dir:choose"),
  /** Cài gói dịch từ file .zip (không truyền đường dẫn → hộp thoại chọn file). */
  installTranslator: (zipPath) => ipcRenderer.invoke("translator:install-file", zipPath),
  /** Gỡ gói dịch. */
  removeTranslator: () => ipcRenderer.invoke("translator:remove"),
  /** Theo dõi tiến độ cài gói dịch; trả về hàm hủy theo dõi. */
  onTranslatorProgress: (cb) => {
    const h = (_e, p) => cb(p);
    ipcRenderer.on("translator:progress", h);
    return () => ipcRenderer.removeListener("translator:progress", h);
  },
  /** Mở liên kết bằng trình duyệt mặc định. */
  openExternal: (url) => ipcRenderer.invoke("open-external", url),
});
