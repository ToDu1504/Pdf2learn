import { create } from "zustand";

/** Hộp thoại xác nhận thay cho window.confirm: `if (!(await ask({...}))) return;` */
export type ConfirmOptions = { title: string; message?: string; confirmLabel?: string; cancelLabel?: string; danger?: boolean };

type ConfirmState = {
  current: (ConfirmOptions & { resolve: (ok: boolean) => void }) | null;
  close: (ok: boolean) => void;
};

export const useConfirm = create<ConfirmState>((set, get) => ({
  current: null,
  close: (ok) => {
    get().current?.resolve(ok);
    set({ current: null });
  },
}));

export function ask(options: ConfirmOptions) {
  useConfirm.getState().current?.resolve(false);
  return new Promise<boolean>((resolve) => useConfirm.setState({ current: { ...options, resolve } }));
}
