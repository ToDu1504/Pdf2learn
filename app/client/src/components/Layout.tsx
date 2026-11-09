import { Suspense, useEffect, useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { BarChart3, House, Layers, LogOut, Menu, PanelLeftClose, PanelLeftOpen, Settings, X } from "lucide-react";
import { useAuth } from "../stores/auth";
import { useThemeSync } from "../hooks/useTheme";
import { useOverview } from "../api/queries";
import { cn, IconButton, Spinner } from "./ui";

const NAV = [
  { to: "/app", label: "Tổng quan", icon: House, end: true },
  { to: "/app/flashcards", label: "Flashcard", icon: Layers },
  { to: "/app/stats", label: "Thống kê", icon: BarChart3 },
  { to: "/app/settings", label: "Cài đặt", icon: Settings },
];

export const APP_NAME = "Pdf2Learn";

/** Logo: bấm để về trang chủ (trang giới thiệu). */
export function Logo({ to, compact }: { to?: string; compact?: boolean }) {
  const body = (
    <span className="flex items-center gap-2 text-[17px] font-semibold tracking-tight">
      <img src="/favicon.svg" alt="" className="size-7 shrink-0" />
      {!compact && <span>{APP_NAME}</span>}
    </span>
  );
  return to ? (
    <Link to={to} aria-label={`${APP_NAME} – trang chính`} className="rounded-lg">
      {body}
    </Link>
  ) : (
    body
  );
}

const SIDEBAR_KEY = "pdf2learn-sidebar-collapsed";

export function AppLayout() {
  useThemeSync();
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  // Sidebar thu gọn (chỉ còn icon) — nhớ lựa chọn theo trình duyệt.
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_KEY) === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_KEY, collapsed ? "1" : "0");
    } catch {
      /* private mode */
    }
  }, [collapsed]);

  const signOut = () => {
    logout();
    qc.clear();
    navigate("/login");
  };

  const due = useOverview().data?.dueCards ?? 0;

  const nav = (compact: boolean) => (
    <nav className="flex flex-col gap-0.5">
      {NAV.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          title={compact ? label : undefined}
          onClick={() => setOpen(false)}
          className={({ isActive }) =>
            cn(
              "relative flex items-center gap-3 rounded-lg py-2 text-[14px] font-medium transition-colors",
              compact ? "justify-center px-0" : "px-3",
              isActive ? "bg-black/[0.06] text-slate-900 dark:bg-white/10 dark:text-white" : "text-slate-600 hover:bg-black/[0.04] dark:text-slate-400 dark:hover:bg-white/5",
            )
          }
        >
          {({ isActive }) => (
            <>
              <Icon className={cn("size-[18px] shrink-0", isActive ? "text-brand-600 dark:text-brand-400" : "text-slate-400")} strokeWidth={1.75} />
              {!compact && label}
              {to === "/app/flashcards" && due > 0 && (
                <span
                  className={cn(
                    "rounded-full bg-brand-600 text-[11px] leading-[18px] font-semibold text-white tabular-nums",
                    compact ? "absolute top-0.5 right-0.5 min-w-[18px] px-1" : "ml-auto min-w-[20px] px-1.5 text-center",
                  )}
                  aria-label={`${due} thẻ cần ôn`}
                >
                  {due > 99 ? "99+" : due}
                </span>
              )}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen lg:flex">
      <aside
        className={cn(
          "sticky top-0 hidden h-screen shrink-0 flex-col border-r border-black/[0.06] bg-slate-50/80 py-5 backdrop-blur-xl transition-[width] duration-200 lg:flex dark:border-white/[0.08] dark:bg-slate-950/80",
          collapsed ? "w-[68px] px-2.5" : "w-60 px-3",
        )}
      >
        <div className={cn("mb-7 flex items-center", collapsed ? "flex-col gap-3" : "justify-between pl-3")}>
          <Logo to="/" compact={collapsed} />
          <IconButton label={collapsed ? "Mở rộng thanh bên" : "Thu gọn thanh bên"} onClick={() => setCollapsed(!collapsed)} className="size-8">
            {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
          </IconButton>
        </div>
        {nav(collapsed)}
        <div className={cn("mt-auto", collapsed ? "flex justify-center" : "px-3")}>
          {!collapsed && (
            <>
              <p className="truncate text-[13px] font-medium">{user?.full_name}</p>
              <p className="truncate text-[12px] text-slate-500">{user?.email}</p>
            </>
          )}
          <button
            className={cn("flex items-center gap-2 text-[13px] text-slate-500 hover:text-slate-900 dark:hover:text-white", !collapsed && "mt-3")}
            onClick={signOut}
            title="Đăng xuất"
          >
            <LogOut className="size-4" strokeWidth={1.75} /> {!collapsed && "Đăng xuất"}
          </button>
        </div>
      </aside>

      <header className="sticky top-0 z-30 flex h-13 items-center justify-between border-b border-black/[0.06] bg-white/75 px-4 backdrop-blur-xl lg:hidden dark:border-white/[0.08] dark:bg-black/70">
        <Logo to="/" />
        <IconButton label="Menu" onClick={() => setOpen(!open)}>
          {open ? <X /> : <Menu />}
        </IconButton>
      </header>
      {open && (
        <div className="fixed inset-x-0 top-13 z-30 border-b border-black/[0.06] bg-white/95 p-3 backdrop-blur-xl lg:hidden dark:bg-black/90">
          {nav(false)}
          <button className="mt-2 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[14px] text-slate-500" onClick={signOut}>
            <LogOut className="size-[18px]" strokeWidth={1.75} /> Đăng xuất
          </button>
        </div>
      )}

      <main className="min-w-0 flex-1">
        <Suspense fallback={<div className="grid h-64 place-items-center"><Spinner /></div>}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  );
}

export function Page({ title, actions, children, wide }: { title?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={cn("mx-auto w-full px-5 py-8 sm:px-8 lg:py-12", wide ? "max-w-[1400px]" : "max-w-5xl")}>
      {(title || actions) && (
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          {title && <h1 className="text-[28px] leading-tight font-bold sm:text-[34px]">{title}</h1>}
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </div>
  );
}
