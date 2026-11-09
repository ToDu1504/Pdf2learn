import { forwardRef, useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Pencil, X } from "lucide-react";
import { createPortal } from "react-dom";
import { useToast } from "../stores/toast";
import { useConfirm } from "../stores/confirm";

export const cn = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

/* Nút bo tròn dạng viên thuốc; chỉ nút chính mang màu nhấn, còn lại là xám nhạt. */
type Variant = "primary" | "secondary" | "ghost" | "danger";
const VARIANT: Record<Variant, string> = {
  primary: "bg-brand-600 text-white hover:bg-brand-700",
  secondary: "bg-slate-100 text-slate-900 hover:bg-slate-200 dark:bg-white/10 dark:text-slate-100 dark:hover:bg-white/15",
  ghost: "text-brand-600 hover:bg-brand-50 dark:text-brand-400 dark:hover:bg-white/5",
  danger: "bg-rose-500 text-white hover:bg-rose-600",
};

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" | "lg"; loading?: boolean }
>(({ variant = "primary", size = "md", loading, className, children, disabled, ...props }, ref) => (
  <button
    ref={ref}
    disabled={disabled || loading}
    className={cn(
      "inline-flex items-center justify-center gap-1.5 rounded-full font-medium whitespace-nowrap transition-colors active:opacity-80 disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4 [&_svg]:shrink-0",
      size === "sm" ? "h-8 px-3.5 text-[13px]" : size === "lg" ? "h-12 px-6 text-[17px]" : "h-10 px-4.5 text-[15px]",
      VARIANT[variant],
      className,
    )}
    {...props}
  >
    {loading && <Spinner className="size-4" />}
    {children}
  </button>
));

/** Nút chỉ có icon (tròn). */
export function IconButton({ label, className, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      aria-label={label}
      title={label}
      className={cn(
        "inline-grid size-9 shrink-0 place-items-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:opacity-40 dark:hover:bg-white/10 dark:hover:text-white [&_svg]:size-[18px]",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function Spinner({ className = "size-5" }: { className?: string }) {
  return (
    <svg className={cn("animate-spin text-slate-400", className)} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.5" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-2xl bg-slate-200/70 dark:bg-white/5", className)} />;
}

/** Trạng thái trống: icon xám trong vòng tròn + tiêu đề + mô tả. */
export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      {icon && <div className="mb-2 grid size-14 place-items-center rounded-full bg-slate-100 text-slate-400 dark:bg-white/5 [&_svg]:size-6">{icon}</div>}
      <p className="text-[17px] font-semibold">{title}</p>
      {children && <div className="max-w-md text-[15px] text-slate-500">{children}</div>}
    </div>
  );
}

const BADGE = {
  slate: "bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300",
  green: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400",
  red: "bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300",
  amber: "bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  brand: "bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300",
};
export function Badge({ color = "slate", children }: { color?: keyof typeof BADGE; children: ReactNode }) {
  return <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-[12px] font-medium", BADGE[color])}>{children}</span>;
}

export function ProgressBar({ value, className }: { value: number; className?: string }) {
  return (
    <div className={cn("h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-white/10", className)}>
      <div className="h-full rounded-full bg-brand-600 transition-all duration-500" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

/** Hộp thoại: vẽ thẳng vào <body> (không bị khối cha có z-index đè lên), Esc / bấm nền để đóng. */
export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-4 backdrop-blur-sm sm:items-center" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal
        className={cn("max-h-[90vh] w-full overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl dark:bg-slate-900", wide ? "max-w-2xl" : "max-w-md")}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-xl font-semibold">{title}</h2>
          <IconButton label="Đóng" onClick={onClose}>
            <X />
          </IconButton>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** Hộp thoại xác nhận toàn cục (gọi bằng `ask()` trong stores/confirm). Esc / bấm nền = hủy. */
export function ConfirmDialog() {
  const { current, close } = useConfirm();
  useEffect(() => {
    if (!current) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, close]);
  if (!current) return null;
  return (
    <div className="fixed inset-0 z-[55] flex items-end justify-center bg-black/30 p-4 backdrop-blur-sm sm:items-center" onMouseDown={() => close(false)}>
      <div role="alertdialog" aria-modal aria-labelledby="confirm-title" className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl dark:bg-slate-900" onMouseDown={(e) => e.stopPropagation()}>
        <h2 id="confirm-title" className="text-[19px] font-semibold">
          {current.title}
        </h2>
        {current.message && <p className="mt-2 text-[15px] text-slate-500">{current.message}</p>}
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => close(false)}>
            {current.cancelLabel ?? "Hủy"}
          </Button>
          <Button autoFocus variant={current.danger ? "danger" : "primary"} onClick={() => close(true)}>
            {current.confirmLabel ?? "Đồng ý"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Thông báo dạng viên thuốc tối màu ở giữa phía dưới (kiểu iOS). */
export function Toaster() {
  const { toasts, dismiss } = useToast();
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[60] flex flex-col items-center gap-2 px-4">
      {toasts.map((t) => (
        <button
          key={t.id}
          onClick={() => dismiss(t.id)}
          className={cn(
            "pointer-events-auto flex max-w-md items-center gap-2 rounded-full px-5 py-2.5 text-[14px] font-medium text-white shadow-lg backdrop-blur-xl",
            t.kind === "error" ? "bg-rose-500/95" : "bg-slate-900/90 dark:bg-slate-700/90",
          )}
        >
          {t.kind === "success" && <span className="size-1.5 rounded-full bg-emerald-400" />}
          {t.message}
        </button>
      ))}
    </div>
  );
}

/** Segmented control. */
export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { value: T; label: ReactNode }[] }) {
  return (
    <div className="inline-flex rounded-full bg-slate-100 p-0.5 dark:bg-white/10">
      {items.map((it) => (
        <button
          key={it.value}
          onClick={() => onChange(it.value)}
          className={cn(
            "rounded-full px-3.5 py-1.5 text-[13px] font-medium transition",
            value === it.value ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white" : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white",
          )}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

export const DIFFICULTY_LABEL = { easy: "Dễ", medium: "Trung bình", hard: "Khó" } as const;
export const TYPE_LABEL = { mcq: "Trắc nghiệm", true_false: "Đúng/Sai", short_answer: "Tự luận" } as const;

/**
 * Tiêu đề sửa tại chỗ: rê chuột hiện nút bút chì; Enter / bấm ra ngoài để lưu, Esc để hủy.
 * `onSave` ném lỗi thì giữ ô nhập để người dùng sửa tiếp.
 */
export function EditableTitle({ value, onSave, className, label = "Sửa tiêu đề" }: { value: string; onSave: (v: string) => Promise<unknown>; className?: string; label?: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);

  const start = () => {
    setDraft(value);
    setEditing(true);
  };
  const commit = async () => {
    const v = draft.trim();
    if (!v || v === value) return setEditing(false);
    setSaving(true);
    try {
      await onSave(v);
      setEditing(false);
    } catch {
      input.current?.focus();
    } finally {
      setSaving(false);
    }
  };

  if (editing)
    return (
      <input
        ref={input}
        value={draft}
        maxLength={250}
        disabled={saving}
        aria-label={label}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === "Enter") void commit();
          if (e.key === "Escape") setEditing(false);
        }}
        className={cn("w-full min-w-0 rounded-lg bg-transparent px-1 -mx-1 outline-none ring-2 ring-brand-500/40 disabled:opacity-60", className)}
      />
    );
  return (
    <span className={cn("group/title inline-flex min-w-0 items-baseline gap-1.5", className)}>
      <span className="min-w-0 break-words">{value}</span>
      <button
        type="button"
        aria-label={label}
        title={label}
        onClick={(e) => {
          e.stopPropagation();
          start();
        }}
        className="shrink-0 self-center rounded-full p-1 text-slate-400 transition-opacity md:opacity-0 hover:bg-slate-100 hover:text-slate-700 md:focus-visible:opacity-100 md:group-hover/title:opacity-100 dark:hover:bg-white/10 dark:hover:text-white [&_svg]:size-[0.6em] [&_svg]:min-h-3.5 [&_svg]:min-w-3.5"
      >
        <Pencil />
      </button>
    </span>
  );
}
