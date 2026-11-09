import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FileArchive, Trash2 } from "lucide-react";
import { useAppConfig } from "../../api/queries";
import { Button, ProgressBar, Spinner } from "../../components/ui";
import { ask } from "../../stores/confirm";
import { toast } from "../../stores/toast";

const PHASE = { verify: "Đang kiểm tra file", extract: "Đang giải nén", finish: "Đang hoàn tất", done: "Xong", error: "Lỗi" } as const;
const TOTAL_FILES = 28_500; // gói 1.0.0: ~28.5 nghìn file (chỉ để ước lượng thanh tiến độ)

/**
 * Gói dịch (VI-Translate + Python độc lập, ~365MB nén / ~770MB khi cài) để dịch PDF giữ nguyên bố cục.
 * Cài từ file .zip; nằm trong thư mục dữ liệu. Không có gói thì tab Bản dịch dùng Gemini dịch chữ.
 */
export function TranslatorSection() {
  const qc = useQueryClient();
  const { data } = useAppConfig();
  const [progress, setProgress] = useState<{ phase: keyof typeof PHASE; files?: number; error?: string } | null>(null);
  const bridge = window.pdf2learn;
  useEffect(() => bridge?.onTranslatorProgress((p) => setProgress(p)), [bridge]);

  const t = data?.translator;
  const busy = !!progress && progress.phase !== "done" && progress.phase !== "error";
  const refresh = () => qc.invalidateQueries({ queryKey: ["app-config"] });

  const install = async () => {
    if (!bridge) return;
    const r = await bridge.installTranslator();
    if (r.installed) {
      toast.success("Đã cài gói dịch");
      await refresh();
    } else if (r.error) toast.error(r.error);
    setProgress(null);
  };
  const remove = async () => {
    if (!bridge) return;
    if (!(await ask({ title: "Gỡ gói dịch?", message: "Các bản dịch đã có vẫn giữ. Muốn dịch tiếp thì phải cài lại gói.", confirmLabel: "Gỡ", danger: true }))) return;
    const r = await bridge.removeTranslator();
    if (r.removed) toast.success("Đã gỡ gói dịch");
    else toast.error(r.error ?? "Không gỡ được");
    await refresh();
  };

  return (
    <div className="space-y-3 text-[14px]">
      {t?.installed ? (
        <p>
          <span className="font-medium text-emerald-600">Đã cài</span>
          {t.version ? ` · phiên bản ${t.version}` : ""}
          {t.source === "dev" ? " · bản phát triển (vi-translate/.venv)" : ""}
          {t.vi_translate_commit ? <span className="text-slate-400"> · VI-Translate {t.vi_translate_commit.slice(0, 7)}</span> : null}
        </p>
      ) : (
        <p className="text-slate-600 dark:text-slate-300">
          Chưa cài. Cần gói dịch (~365MB) để xem bản dịch tiếng Việt giữ nguyên hình, bảng, bố cục của PDF. Chưa có gói thì tab Bản dịch chỉ dịch chữ bằng Gemini.
        </p>
      )}
      {busy && (
        <div>
          <p className="mb-1.5 flex items-center gap-2 text-slate-500">
            <Spinner className="size-3.5" /> {PHASE[progress!.phase]}
            {progress!.phase === "extract" && progress!.files ? ` · ${progress!.files.toLocaleString("vi-VN")} file` : ""}
          </p>
          <ProgressBar value={progress!.phase === "extract" ? Math.min(98, ((progress!.files ?? 0) / TOTAL_FILES) * 100) : progress!.phase === "finish" ? 99 : 2} />
        </div>
      )}
      {bridge ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant={t?.installed ? "secondary" : "primary"} onClick={install} disabled={busy}>
            <FileArchive /> {t?.installed ? "Cài lại / cập nhật từ file .zip…" : "Cài từ file .zip…"}
          </Button>
          {t?.installed && t.source === "pack" && (
            <Button size="sm" variant="secondary" onClick={remove} disabled={busy}>
              <Trash2 /> Gỡ
            </Button>
          )}
        </div>
      ) : (
        <p className="text-[13px] text-slate-500">Cài gói dịch trong app desktop.</p>
      )}
      <p className="text-[12px] text-slate-400">
        Gồm VI-Translate (AGPL-3.0, github.com/breslee1707/VI-Translate) chạy bằng Python độc lập; dịch qua Google Dịch trên trình duyệt, không tốn lượt AI.
      </p>
    </div>
  );
}
