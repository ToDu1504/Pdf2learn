import { useRef, useState } from "react";
import { Upload } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { errorMessage, http } from "../../api/client";
import { cn, ProgressBar } from "../../components/ui";
import { toast } from "../../stores/toast";
import type { DocumentItem } from "../../types";

const MAX_MB = 50;

export function UploadZone() {
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [uploading, setUploading] = useState<{ name: string; pct: number } | null>(null);
  const qc = useQueryClient();
  const navigate = useNavigate();

  const upload = async (file: File) => {
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) return toast.error("Chỉ chấp nhận file PDF");
    if (file.size > MAX_MB * 1024 * 1024) return toast.error(`File vượt quá ${MAX_MB}MB`);
    const fd = new FormData();
    fd.append("file", file);
    setUploading({ name: file.name, pct: 0 });
    try {
      const { data } = await http.post<DocumentItem>("/documents", fd, {
        onUploadProgress: (e) => setUploading({ name: file.name, pct: e.total ? Math.round((e.loaded / e.total) * 100) : 0 }),
      });
      await qc.invalidateQueries({ queryKey: ["documents"] });
      toast.success("Đã tải lên, AI đang xử lý tài liệu");
      navigate(`/app/documents/${data.id}`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setUploading(null);
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => !uploading && input.current?.click()}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        const f = e.dataTransfer.files[0];
        if (f) void upload(f);
      }}
      className={cn(
        "flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-2xl border border-dashed px-8 py-10 text-center transition-colors",
        drag
          ? "border-brand-500 bg-brand-50 dark:bg-brand-500/10"
          : "border-slate-300 bg-white hover:border-slate-400 dark:border-white/15 dark:bg-slate-900 dark:hover:border-white/25",
      )}
    >
      <input
        ref={input}
        type="file"
        accept="application/pdf"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void upload(f);
          e.target.value = "";
        }}
      />
      {uploading ? (
        <div className="w-full max-w-sm">
          <p className="mb-3 truncate text-[14px] text-slate-500">Đang tải lên {uploading.name}</p>
          <ProgressBar value={uploading.pct} />
        </div>
      ) : (
        <>
          <Upload className="mb-1 size-7 text-brand-600" strokeWidth={1.5} />
          <p className="text-[17px] font-semibold">Thêm giáo trình PDF</p>
          <p className="text-[14px] text-slate-500">Kéo thả hoặc bấm để chọn · tối đa {MAX_MB} MB</p>
        </>
      )}
    </div>
  );
}
