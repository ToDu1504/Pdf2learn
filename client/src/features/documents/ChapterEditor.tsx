import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { errorMessage, http } from "../../api/client";
import { Button, Modal } from "../../components/ui";
import { toast } from "../../stores/toast";
import type { DocumentDetail } from "../../types";
import { X } from "lucide-react";

type Row = { title: string; start_page: number; end_page: number };

/** Sửa ranh giới chương khi AI/bookmark tách sai. */
export function ChapterEditor({ doc, open, onClose }: { doc: DocumentDetail; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [rows, setRows] = useState<Row[]>(() => doc.chapters.map(({ title, start_page, end_page }) => ({ title, start_page, end_page })));
  const [saving, setSaving] = useState(false);
  const max = doc.page_count ?? 9999;

  const update = (i: number, patch: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const error = (() => {
    const sorted = [...rows].sort((a, b) => a.start_page - b.start_page);
    for (const [i, r] of sorted.entries()) {
      if (!r.title.trim()) return "Tên chương không được trống";
      if (r.start_page < 1 || r.end_page > max || r.end_page < r.start_page) return `"${r.title}": khoảng trang không hợp lệ`;
      if (i > 0 && r.start_page <= sorted[i - 1].end_page) return "Các chương bị chồng trang";
    }
    return null;
  })();

  const save = async () => {
    setSaving(true);
    try {
      await http.patch(`/documents/${doc.id}/chapters`, { chapters: rows });
      await qc.invalidateQueries({ queryKey: ["document", doc.id] });
      toast.success("Đã lưu. Chương thay đổi sẽ được AI xử lý lại.");
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Sửa ranh giới chương" wide>
      <p className="mb-3 text-sm text-slate-500">
        Tài liệu có {doc.page_count} trang. Chương giữ nguyên khoảng trang thì giữ kết quả cũ; chương mới/đổi trang sẽ được tóm tắt lại.
      </p>
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center gap-2">
            <input className="input flex-1" value={r.title} onChange={(e) => update(i, { title: e.target.value })} />
            <input className="input w-20" type="number" value={r.start_page} onChange={(e) => update(i, { start_page: Number(e.target.value) })} />
            <span className="text-slate-400">–</span>
            <input className="input w-20" type="number" value={r.end_page} onChange={(e) => update(i, { end_page: Number(e.target.value) })} />
            <button className="rounded-lg p-2 text-slate-400 hover:text-rose-600" onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label="Xóa">
              <X className="size-4" />
            </button>
          </div>
        ))}
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="mt-2"
        onClick={() => {
          const last = rows.at(-1);
          const start = Math.min(max, (last?.end_page ?? 0) + 1);
          setRows([...rows, { title: `Chương ${rows.length + 1}`, start_page: start, end_page: max }]);
        }}
      >
        + Thêm chương
      </Button>
      {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Hủy
        </Button>
        <Button onClick={save} loading={saving} disabled={!!error || !rows.length}>
          Lưu
        </Button>
      </div>
    </Modal>
  );
}
