import { create } from "zustand";

export type ToastTone = "neutral" | "success" | "warning" | "danger";

export interface Toast {
  id: number;
  title: string;
  detail?: string;
  tone: ToastTone;
  /** One button, e.g. "Undo" after writing tags. */
  action?: { label: string; run: () => void };
  /** The screen the action opens: once the user is there, the toast has said its piece. */
  leadsTo?: string;
}

interface ToastState {
  toasts: Toast[];
  push: (toast: Omit<Toast, "id">) => number;
  dismiss: (id: number) => void;
}

let nextId = 1;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (toast) => {
    const id = nextId++;
    set((s) => ({ toasts: [...s.toasts.slice(-2), { ...toast, id }] }));
    return id;
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
