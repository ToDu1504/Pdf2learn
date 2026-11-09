import { FileText, Upload } from "lucide-react";

/**
 * Ảnh động cho trang giới thiệu (lặp ~10 giây):
 *   1. File PDF rơi vào ô tải lên → 2. thanh tiến độ phân tích chạy → 3. lộ trình hiện dần (trục, chặng, bài học),
 *   tất cả bài học đều TRỐNG (chưa học) — đúng trạng thái ngay sau khi upload.
 * Chỉ dùng CSS keyframes (không thư viện). Người dùng bật "giảm chuyển động" sẽ thấy khung lộ trình tĩnh.
 */

const DURATION = 10; // giây cho 1 vòng

// Lộ trình mẫu: [tên chặng, số bài]
const SECTIONS: [string, number][] = [
  ["Nhập môn", 2],
  ["Kiến thức nền", 3],
  ["Thực hành", 2],
];

/** Mốc xuất hiện (theo % vòng lặp) cho từng phần tử của lộ trình. */
function timeline() {
  const items: { key: string; at: number }[] = [];
  let t = 54;
  SECTIONS.forEach(([, n], s) => {
    items.push({ key: `s${s}`, at: t });
    t += 3;
    for (let l = 0; l < n; l++) {
      items.push({ key: `s${s}l${l}`, at: t });
      t += 2.2;
    }
    t += 1;
  });
  return items;
}

const ITEMS = timeline();

const keyframes = ITEMS.map(
  ({ key, at }) => `
@keyframes p2l-${key} {
  0%, ${at}% { opacity: 0; transform: translateY(6px); }
  ${at + 2.5}%, 90% { opacity: 1; transform: none; }
  97%, 100% { opacity: 0; transform: none; }
}`,
).join("\n");

const anim = (key: string) => ({ animation: `p2l-${key} ${DURATION}s ease-out infinite` });

export function PdfToRoadmap() {
  return (
    <div className="p2l relative mx-auto h-[440px] w-full max-w-[380px] select-none" aria-hidden>
      <style>{keyframes}</style>

      {/* Bước 1–2: ô tải lên + file PDF + thanh phân tích */}
      <div className="p2l-upload absolute inset-x-0 top-8 mx-auto flex h-56 w-72 flex-col items-center justify-center rounded-3xl border border-dashed border-slate-300 bg-white/60 dark:border-white/15 dark:bg-white/[0.03]">
        <div className="p2l-doc absolute left-1/2 top-6 -ml-8 flex h-20 w-16 flex-col gap-1.5 rounded-lg border border-black/[0.08] bg-white p-2.5 shadow-lg dark:border-white/10 dark:bg-slate-800">
          <FileText className="mb-0.5 size-4 text-rose-500" strokeWidth={1.75} />
          <span className="h-1 w-full rounded bg-slate-200 dark:bg-white/15" />
          <span className="h-1 w-4/5 rounded bg-slate-200 dark:bg-white/15" />
          <span className="h-1 w-full rounded bg-slate-200 dark:bg-white/15" />
          <span className="h-1 w-3/5 rounded bg-slate-200 dark:bg-white/15" />
        </div>
        <p className="p2l-hint absolute bottom-10 flex items-center gap-1.5 text-[13px] text-slate-500">
          <Upload className="size-4" strokeWidth={1.75} /> Thả file PDF
        </p>
        <div className="p2l-progress absolute bottom-10 w-44">
          <p className="mb-2 text-center text-[13px] text-slate-500">Đang lập lộ trình…</p>
          <div className="h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-white/10">
            <div className="p2l-bar h-full rounded-full bg-brand-600" />
          </div>
        </div>
      </div>

      {/* Bước 3: lộ trình trống */}
      <div className="p2l-roadmap absolute inset-0 px-6 pt-4">
        <div className="relative">
          <span className="p2l-spine absolute top-3 bottom-3 left-[11px] w-px origin-top bg-slate-300 dark:bg-white/15" />
          <ol className="relative space-y-4">
            {SECTIONS.map(([title, n], s) => (
              <li key={title}>
                <div className="flex items-center gap-3" style={anim(`s${s}`)}>
                  <span className="relative z-10 grid size-6 place-items-center rounded-full border border-slate-300 bg-white text-[11px] font-semibold text-slate-600 dark:border-white/20 dark:bg-slate-900 dark:text-slate-300">
                    {s + 1}
                  </span>
                  <span className="text-[15px] font-semibold">{title}</span>
                </div>
                <div className="mt-2 space-y-1.5 pl-9">
                  {Array.from({ length: n }, (_, l) => (
                    <div
                      key={l}
                      style={anim(`s${s}l${l}`)}
                      className="flex items-center gap-2.5 rounded-xl border border-black/[0.06] bg-white px-3 py-2 dark:border-white/[0.08] dark:bg-slate-900"
                    >
                      <span className="size-3.5 shrink-0 rounded-full border-[1.5px] border-slate-300 dark:border-slate-600" />
                      <span className="h-1.5 rounded bg-slate-200 dark:bg-white/10" style={{ width: `${55 + ((s * 3 + l * 7) % 4) * 10}%` }} />
                    </div>
                  ))}
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}


