/** Cầu nối do app desktop cung cấp (app/desktop/preload.cjs); không có khi mở bằng trình duyệt. */
interface Pdf2LearnBridge {
  isDesktop: true;
  dataDir(): Promise<string>;
  openDataDir(): Promise<string>;
  chooseDataDir(): Promise<{ changed: boolean }>;
  openExternal(url: string): Promise<void>;
}
interface Window {
  pdf2learn?: Pdf2LearnBridge;
}
