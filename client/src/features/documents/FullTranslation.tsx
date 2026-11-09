import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleAlert, Download, Languages, Square } from "lucide-react";
import { download, errorMessage, http } from "../../api/client";
import { Button, Modal, ProgressBar, Spinner } from "../../components/ui";
import { toast } from "../../stores/toast";

type FullStatus =
  | { available: false }
  | {
      available: true;
      total: number;
      ready: number;
      running: boolean;
      current: { from: number; to: number; phase: string; done: number; total: number; unit?: "page" | "segment" } | null;
      error: string | null;
      complete: boolean;
    };

const MIN_PER_CHUNK = 2; // đo thực tế: ~107 giây / 10 trang qua Google trên trình duyệt

/**
 * Dịch toàn bộ PDF sang tiếng Việt (giữ bố cục) ở nền rồi tải về 1 file.
 * Server dịch lần lượt từng cụm 10 trang qua Google trên trình duyệt (không tốn lượt AI);
 * Google đòi CAPTCHA thì cửa sổ Chrome bật lên để giải.
 */
export function FullTranslation({ documentId, title, open, onClose }: { documentId: number; title: string; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const key = ["translation-full", documentId];
  const { data } = useQuery({
    queryKey: key,
    queryFn: async () => (await http.get<FullStatus>(`/documents/${documentId}/translation/full`)).data,
    enabled: open,
    refetchInterval: (q) => (q.state.data?.available && q.state.data.running ? 3000 : false),
  });

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: key });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const start = () => act(() => http.post(`/documents/${documentId}/translation/full`));
  const stop = () => act(() => http.delete(`/documents/${documentId}/translation/full`));
  const save = () => act(() => download(`/documents/${documentId}/translation/full/file`, `${title} - tiếng Việt.pdf`));

  return (
    <Modal open={open} onClose={onClose} title="Dịch toàn bộ PDF">
      {!data ? (
        <div className="grid h-32 place-items-center">
          <Spinner />
        </div>
      ) : !data.available ? (
        <p className="text-[15px] text-slate-600 dark:text-slate-300">Server chưa cài VI-Translate nên chưa dịch được cả file PDF. Xem hướng dẫn cài trong README.</p>
      ) : (
        <div className="space-y-5 text-[15px]">
          <p className="text-slate-600 dark:text-slate-300">
            Dịch lần lượt {data.total} cụm 10 trang, giữ nguyên bố cục, bằng Google Dịch trên trình duyệt (không tốn lượt AI). Nếu Google đòi xác minh,
            cửa sổ Chrome sẽ bật lên: hãy giải CAPTCHA và để cửa sổ mở.
          </p>

          <div>
            <div className="mb-2 flex justify-between text-[14px]">
              <span className="font-medium">
                {data.ready}/{data.total} cụm đã dịch
              </span>
              {data.running && !data.complete && <span className="text-slate-500">còn khoảng {Math.max(1, (data.total - data.ready) * MIN_PER_CHUNK)} phút</span>}
            </div>
            <ProgressBar value={(data.ready / Math.max(1, data.total)) * 100} />
            {data.running && data.current && (
              <p className="mt-2 flex items-center gap-2 text-[13px] text-slate-500">
                <Spinner className="size-3.5" /> Đang dịch trang {data.current.from}–{data.current.to}
                {data.current.total ? ` · ${data.current.done}/${data.current.total} ${data.current.unit === "segment" ? "đoạn" : "trang"}` : ""}
              </p>
            )}
          </div>

          {data.error && !data.running && (
            <p className="flex items-start gap-2 rounded-xl bg-rose-50 p-3 text-[14px] text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
              <CircleAlert className="mt-0.5 size-4 shrink-0" /> Đã dừng: {data.error}
            </p>
          )}

          <div className="flex flex-wrap justify-end gap-2">
            {data.running ? (
              <Button variant="secondary" loading={busy} onClick={stop}>
                <Square /> Dừng
              </Button>
            ) : (
              !data.complete && (
                <Button variant={data.ready ? "secondary" : "primary"} loading={busy} onClick={start}>
                  <Languages /> {data.ready ? "Dịch tiếp phần còn lại" : "Bắt đầu dịch"}
                </Button>
              )
            )}
            <Button disabled={!data.complete} loading={busy && data.complete} onClick={save} title={data.complete ? undefined : "Dịch xong toàn bộ mới tải được"}>
              <Download /> Tải bản dịch
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
