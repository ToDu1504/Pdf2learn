/** Cầu nối do app desktop cung cấp (app/desktop/preload.cjs); không có khi mở bằng trình duyệt. */
interface Pdf2LearnBridge {
  isDesktop: true;
  dataDir(): Promise<string>;
  openDataDir(): Promise<string>;
  chooseDataDir(): Promise<{ changed: boolean }>;
  openExternal(url: string): Promise<void>;
  installTranslator(zipPath?: string): Promise<{ installed: boolean; error?: string; pack?: { version: string } }>;
  downloadTranslator(): Promise<{ installed: boolean; error?: string; pack?: { version: string } }>;
  cancelTranslatorDownload(): Promise<void>;
  removeTranslator(): Promise<{ removed: boolean; error?: string }>;
  onTranslatorProgress(
    cb: (p: { phase: "download" | "verify" | "extract" | "finish" | "done" | "error"; files?: number; received?: number; total?: number; error?: string }) => void,
  ): () => void;
}
interface Window {
  pdf2learn?: Pdf2LearnBridge;
}
