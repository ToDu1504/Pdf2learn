import { useEffect, useState, type ReactNode } from "react";
import { ExternalLink, FolderOpen, KeyRound } from "lucide-react";
import { errorMessage } from "../../api/client";
import { useAppConfig, useSaveAppConfig } from "../../api/queries";
import { Button, Spinner } from "../../components/ui";

/** Mở liên kết ra trình duyệt (trong app desktop đi qua Electron; trên trình duyệt mở tab mới). */
export const openExternal = (url: string) => (window.pdf2learn ? void window.pdf2learn.openExternal(url) : void window.open(url, "_blank"));

const AI_STUDIO = "https://aistudio.google.com/apikey";

/** Thư mục dữ liệu: xem, mở bằng Explorer, đổi chỗ (chỉ có trong app desktop). */
export function DataDirControl() {
  const { data } = useAppConfig();
  const [dir, setDir] = useState<string | null>(null);
  useEffect(() => {
    void window.pdf2learn?.dataDir().then(setDir);
  }, []);
  const shown = dir ?? data?.data_dir ?? "";
  return (
    <div className="space-y-3">
      <p className="rounded-xl bg-slate-100 px-3 py-2 font-mono text-[13px] break-all dark:bg-white/10">{shown}</p>
      {window.pdf2learn && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => void window.pdf2learn!.openDataDir()}>
            <FolderOpen /> Mở thư mục
          </Button>
          <Button size="sm" variant="secondary" onClick={() => void window.pdf2learn!.chooseDataDir()}>
            Đổi thư mục…
          </Button>
        </div>
      )}
      <p className="text-[13px] text-slate-500">Chứa cơ sở dữ liệu, file PDF, bản dịch và gói dịch. Sao lưu chỉ cần chép thư mục này.</p>
    </div>
  );
}

/** Nhập / đổi Gemini API key (kiểm tra với Google trước khi lưu; lưu dạng mã hóa). */
export function ApiKeyForm({ onSaved, submitLabel = "Lưu" }: { onSaved?: () => void; submitLabel?: string }) {
  const { data } = useAppConfig();
  const save = useSaveAppConfig();
  const [key, setKey] = useState("");
  const [model, setModel] = useState("");
  const [fallbacks, setFallbacks] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!data) return;
    setModel((m) => m || data.gemini_model);
    setFallbacks((f) => f || data.gemini_fallback_models);
  }, [data]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    save.mutate(
      {
        ...(key.trim() ? { gemini_api_key: key.trim() } : {}),
        ...(model.trim() && model.trim() !== data?.gemini_model ? { gemini_model: model.trim() } : {}),
        ...(fallbacks.trim() !== data?.gemini_fallback_models ? { gemini_fallback_models: fallbacks.trim() } : {}),
      },
      {
        onSuccess: () => {
          setKey("");
          onSaved?.();
        },
        onError: (err) => setError(errorMessage(err)),
      },
    );
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <label className="block">
        <span className="mb-1.5 block text-[14px] font-medium">Gemini API key</span>
        <input
          type="password"
          className="input"
          autoComplete="off"
          placeholder={data?.key_hint ? `Đang dùng key ${data.key_hint} — nhập key mới để đổi` : "AIza…"}
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />
        <button type="button" onClick={() => openExternal(AI_STUDIO)} className="mt-1.5 inline-flex items-center gap-1 text-[13px] text-brand-600 hover:text-brand-700 dark:text-brand-400">
          Lấy API key miễn phí ở Google AI Studio <ExternalLink className="size-3.5" />
        </button>
      </label>
      <details className="text-[14px]">
        <summary className="cursor-pointer text-slate-500">Model (nâng cao)</summary>
        <div className="mt-3 space-y-3">
          <label className="block">
            <span className="mb-1 block text-[13px] text-slate-500">Model chính</span>
            <input className="input" value={model} onChange={(e) => setModel(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[13px] text-slate-500">Model dự phòng khi hết lượt trong ngày (cách nhau bởi dấu phẩy)</span>
            <input className="input" value={fallbacks} onChange={(e) => setFallbacks(e.target.value)} />
          </label>
        </div>
      </details>
      {error && <p className="text-[14px] text-rose-500">{error}</p>}
      <Button type="submit" loading={save.isPending} disabled={!key.trim() && !data?.key_hint}>
        <KeyRound /> {submitLabel}
      </Button>
      {data?.key_hint && (
        <p className="text-[13px] text-slate-500">
          Key hiện tại: {data.key_hint} · {data.key_encrypted ? "đã mã hóa trên máy này" : "chưa mã hóa (đang chạy ngoài app desktop)"}
        </p>
      )}
    </form>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="card p-6">
      <h2 className="mb-4 flex items-center gap-3 text-[17px] font-semibold">
        <span className="grid size-7 place-items-center rounded-full bg-brand-600 text-[13px] text-white">{n}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

/** Lần đầu chạy (chưa có API key): chọn nơi lưu dữ liệu, nhập Gemini API key. Xong thì vào thẳng app. */
export function WelcomeGate({ children }: { children: ReactNode }) {
  const { data, isLoading, error } = useAppConfig();
  if (isLoading)
    return (
      <div className="grid h-screen place-items-center">
        <Spinner />
      </div>
    );
  if (error || !data) return <div className="grid h-screen place-items-center text-rose-500">{errorMessage(error, "Không kết nối được máy chủ của app")}</div>;
  if (data.configured) return <>{children}</>;
  return (
    <div className="min-h-screen bg-slate-50 px-4 py-14 dark:bg-slate-950">
      <div className="mx-auto max-w-xl space-y-5">
        <div className="mb-8">
          <h1 className="text-[32px] font-bold tracking-tight">Chào mừng đến Pdf2Learn</h1>
          <p className="mt-2 text-[17px] text-slate-500">Hai bước nhỏ trước khi bắt đầu. Mọi dữ liệu nằm trên máy của bạn.</p>
        </div>
        <Step n={1} title="Nơi lưu dữ liệu">
          <DataDirControl />
        </Step>
        <Step n={2} title="Kết nối Gemini (AI soạn bài)">
          <p className="mb-4 text-[14px] text-slate-500">
            Pdf2Learn dùng Gemini để soạn bài giảng, câu hỏi và trả lời gia sư. Key được kiểm tra với Google rồi lưu dạng mã hóa trên máy này.
          </p>
          <ApiKeyForm submitLabel="Lưu và bắt đầu" />
        </Step>
      </div>
    </div>
  );
}
