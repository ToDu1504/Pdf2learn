import { create } from "zustand";

export type Toast = { id: number; kind: "success" | "error" | "info"; message: string };

type ToastState = {
  toasts: Toast[];
  push: (kind: Toast["kind"], message: string) => void;
  dismiss: (id: number) => void;
};

let seq = 0;

export const useToast = create<ToastState>((set, get) => ({
  toasts: [],
  push: (kind, message) => {
    const id = ++seq;
    set({ toasts: [...get().toasts, { id, kind, message }] });
    setTimeout(() => get().dismiss(id), kind === "error" ? 6000 : 3500);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

export const toast = {
  success: (m: string) => useToast.getState().push("success", m),
  error: (m: string) => useToast.getState().push("error", m),
  info: (m: string) => useToast.getState().push("info", m),
};
