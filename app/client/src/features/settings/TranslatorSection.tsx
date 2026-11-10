import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Download, FileArchive, Square, Trash2 } from "lucide-react";
import { useAppConfig } from "../../api/queries";
import { Button, ProgressBar, Spinner } from "../../components/ui";
import { ask } from "../../stores/confirm";
import { toast } from "../../stores/toast";

const PHASE = { download: "Đang tải", verify: "Đang kiểm tra file", extract: "Đang giải nén", finish: "Đang hoàn tất", done: "Xong", error: "Lỗi" } as const;
const TOTAL_FILES = 28_500; // gói 1.0.0: ~28.5 nghìn file (chỉ để ước lượng thanh tiến độ)

type Progress = { phase: keyof typeof PHASE; files?: number; received?: number; total?: number; error?: string };
const mb = (b = 0) => `${Math.round(b / 1048576).toLocaleString("vi-VN")}MB`;

/** Thanh tiến độ chung: tải chiếm 0–60%, giải nén 60–99%. */
function percent(p: Progress) {
  if (p.phase === "download") return p.total ? ((p.received ?? 0) / p.total) * 60 : 1;
  if (p.phase === "verify") return 60;
  if (p.phase === "extract") return 60 + Math.min(38, ((p.files ?? 0) / TOTAL_FILES) * 38);
  return 99;
}

/**
 * Gói dịch (VI-Translate + Python độc lập, ~365MB nén / ~770MB khi cài) để dịch PDF giữ nguyên bố cục.
 * Tải từ GitHub Releases (tải tiếp được khi bị ngắt) hoặc cài từ file .zip; nằm trong thư mục dữ liệu.
 * Không có gói thì tab Bản dịch dùng Gemini dịch chữ.
 */
export function TranslatorSection() {
  const qc = useQueryClient();
  const { data } = useAppConfig();
  const [progress, setProgress] = useState<Progress | null>(null);
  const bridge = window.pdf2learn;
  useEffect(() => bridge?.onTranslatorProgress((p) => setProgress(p)), [bridge]);

  const t = data?.translator;
  const busy = !!progress && progress.phase !== "done" && progress.phase !== "error";
  const refresh = () => qc.invalidateQueries({ queryKey: ["app-config"] });

  const run = async (action: () => Promise<{ installed: boolean; error?: string }>) => {
    const r = await action();
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
          Chưa cài. Cần gói dịch (tải ~365MB, một lần) để xem bản dịch tiếng Việt giữ nguyên hình, bảng, bố cục của PDF. Chưa có gói thì tab Bản dịch chỉ dịch chữ bằng
          Gemini.
        </p>
      )}
      {busy && (
        <div>
          <p className="mb-1.5 flex items-center gap-2 text-slate-500">
            <Spinner className="size-3.5" /> {PHASE[progress!.phase]}
            {progress!.phase === "download" && progress!.total ? ` · ${mb(progress!.received)} / ${mb(progress!.total)}` : ""}
            {progress!.phase === "extract" && progress!.files ? ` · ${progress!.files.toLocaleString("vi-VN")} file` : ""}
          </p>
          <ProgressBar value={percent(progress!)} />
        </div>
      )}
      {bridge ? (
        <div className="flex flex-wrap gap-2">
          {busy && progress!.phase === "download" ? (
            <Button size="sm" variant="secondary" onClick={() => bridge.cancelTranslatorDownload()}>
              <Square /> Dừng tải
            </Button>
          ) : (
            <Button size="sm" variant={t?.installed ? "secondary" : "primary"} onClick={() => run(() => bridge.downloadTranslator())} disabled={busy}>
              <Download /> {t?.installed ? "Tải lại / cập nhật" : "Tải gói dịch"}
            </Button>
          )}
          <Button size="sm" variant="secondary" onClick={() => run(() => bridge.installTranslator())} disabled={busy}>
            <FileArchive /> Cài từ file .zip…
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
