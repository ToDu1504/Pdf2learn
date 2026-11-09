import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../stores/auth";
import type { DocumentStatus } from "../types";

export type Progress = { status: DocumentStatus; progress: number; step: string | null; error?: string | null };

/** Theo dõi tiến độ xử lý qua SSE. EventSource không gửi header nên truyền token qua query. */
export function useDocumentProgress(documentId: number, enabled: boolean) {
  const token = useAuth((s) => s.token);
  const qc = useQueryClient();
  const [progress, setProgress] = useState<Progress | null>(null);

  useEffect(() => {
    if (!enabled || !token) return;
    const es = new EventSource(`/api/v1/documents/${documentId}/progress?token=${encodeURIComponent(token)}`);
    let lastChapterStep = "";
    es.onmessage = (ev) => {
      const data = JSON.parse(ev.data) as Progress;
      setProgress(data);
      // Mỗi khi xong 1 chương thì làm mới danh sách chương để hiện dần kết quả.
      if (data.step !== lastChapterStep) {
        lastChapterStep = data.step ?? "";
        void qc.invalidateQueries({ queryKey: ["document", documentId] });
      }
      if (data.status === "done" || data.status === "failed") {
        es.close();
        void qc.invalidateQueries({ queryKey: ["document", documentId] });
        void qc.invalidateQueries({ queryKey: ["documents"] });
      }
    };
    return () => es.close();
  }, [documentId, enabled, token, qc]);

  return progress;
}

export function stepLabel(step: string | null) {
  if (!step) return "Đang chờ trong hàng đợi…";
  if (step === "metadata") return "Đọc thông tin PDF";
  if (step === "extract") return "Đọc chữ từng trang";
  if (step === "split") return "Tách chương";
  if (step === "roadmap") return "AI đang lập lộ trình học";
  if (step === "quota") return "Tạm dừng: hết lượt Gemini hôm nay";
  if (step === "done") return "Hoàn tất";
  const m = /^chapter:(\d+)\/(\d+)$/.exec(step);
  if (m) return `Tóm tắt & sinh câu hỏi: chương ${m[1]}/${m[2]}`;
  return step;
}
