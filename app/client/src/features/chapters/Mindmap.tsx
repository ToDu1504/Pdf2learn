import { useEffect, useId, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { errorMessage, http } from "../../api/client";
import { Button, Empty, Spinner } from "../../components/ui";
import { toast } from "../../stores/toast";
import type { Summary } from "../../types";
import { matchNode, type SummaryTarget } from "./matchNode";
import { Network, RotateCw } from "lucide-react";

export function Mindmap({
  chapterId,
  code,
  summary,
  onSelect,
}: {
  chapterId: number;
  code: string | null;
  summary: Pick<Summary, "key_points" | "key_terms">;
  onSelect: (target: SummaryTarget) => void;
}) {
  const qc = useQueryClient();
  const [loading, setLoading] = useState(false);
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

  const generate = async (force = false) => {
    setLoading(true);
    try {
      await http.post(`/chapters/${chapterId}/mindmap${force ? "?force=1" : ""}`);
      await qc.invalidateQueries({ queryKey: ["chapter", chapterId] });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  if (!code)
    return (
      <Empty icon={<Network />} title="Chưa có sơ đồ tư duy">
        <p className="mb-3">AI sẽ vẽ sơ đồ từ bản tóm tắt chương.</p>
        <Button onClick={() => generate()} loading={loading}>
          Tạo sơ đồ
        </Button>
      </Empty>
    );

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs text-slate-500">Bấm vào một nhánh để xem phần lý thuyết tương ứng</p>
        <Button size="sm" variant="ghost" onClick={() => generate(true)} loading={loading}>
          <RotateCw /> Tạo lại
        </Button>
      </div>
      {renderError ? (
        <div className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
          Sơ đồ AI tạo bị lỗi cú pháp. Bấm “Tạo lại”.
        </div>
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
