import { useEffect, useId, useRef, useState } from "react";
import { Empty, Spinner } from "../../components/ui";
import type { Summary } from "../../types";
import { matchNode, type SummaryTarget } from "./matchNode";
import { Network } from "lucide-react";

/** Sơ đồ tư duy server dựng bằng code (services/mindmap.ts), không gọi AI. */
export function Mindmap({
  code,
  summary,
  onSelect,
}: {
  code: string | null;
  summary: Pick<Summary, "key_points" | "key_terms">;
  onSelect: (target: SummaryTarget) => void;
}) {
  const [svg, setSvg] = useState<string | null>(null);
  const [renderError, setRenderError] = useState(false);
  const id = "mm" + useId().replace(/[^a-zA-Z0-9]/g, "");
  const box = useRef<HTMLDivElement>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  // Mermaid mindmap không hỗ trợ "click": gắn sự kiện thẳng vào từng node sau khi vẽ,
  // so khớp chữ trên node với ý chính / khái niệm của tóm tắt.
  useEffect(() => {
    const root = box.current;
    if (!svg || !root) return;
    const nodes = [...root.querySelectorAll<SVGGElement>("g.mindmap-node, g.node")].filter(
      (g, _i, all) => !all.some((other) => other !== g && other.contains(g)), // bỏ node lồng nhau
    );
    const cleanups: (() => void)[] = [];
    nodes.forEach((g, i) => {
      const text = (g.textContent ?? "").replace(/\s+/g, " ").trim();
      if (!text) return;
      const isRoot = i === 0 || /section-root|section--1\b/.test(g.getAttribute("class") ?? "");
      const target = matchNode(text, summary, isRoot);
      if (!target) return;
      g.style.cursor = "pointer";
      g.classList.add("mm-link");
      const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
      title.textContent = "Xem phần lý thuyết";
      g.appendChild(title);
      const click = () => onSelectRef.current(target);
      g.addEventListener("click", click);
      cleanups.push(() => {
        g.removeEventListener("click", click);
        title.remove(); // để lần vẽ lại không lẫn chữ tooltip vào chữ của node
        g.classList.remove("mm-link");
      });
    });
    return () => cleanups.forEach((f) => f());
  }, [svg, summary]);

  useEffect(() => {
    if (!code) return;
    let cancelled = false;
    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        const dark = document.documentElement.classList.contains("dark");
        mermaid.initialize({ startOnLoad: false, theme: dark ? "dark" : "neutral", securityLevel: "strict", fontFamily: "Inter, -apple-system, sans-serif" });
        const { svg } = await mermaid.render(id, code);
        if (!cancelled) {
          setSvg(svg);
          setRenderError(false);
        }
      } catch {
        if (!cancelled) setRenderError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, id]);

  if (!code)
    return (
      <Empty icon={<Network />} title="Chưa có sơ đồ tư duy">
        <p>Sơ đồ có ngay khi bài có ý chính đã kiểm chứng với sách.</p>
      </Empty>
    );

  return (
    <div>
      <p className="mb-2 text-xs text-slate-500">
        Nhánh theo mục lục của sách, chỉ gồm ý đã đối chiếu với PDF. Bấm vào một nút để xem phần lý thuyết tương ứng.
      </p>
      {renderError ? (
        <div className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">Không vẽ được sơ đồ cho bài này.</div>
      ) : svg ? (
        <div ref={box} className="overflow-auto rounded-xl bg-white p-2 dark:bg-slate-950 [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full" dangerouslySetInnerHTML={{ __html: svg }} />
      ) : (
        <div className="grid h-48 place-items-center">
          <Spinner />
        </div>
      )}
    </div>
  );
}
