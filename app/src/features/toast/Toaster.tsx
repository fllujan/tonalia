import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { type Toast, type ToastTone, useToastStore } from "./toastStore";

const TONE: Record<ToastTone, { icon: typeof Info; className: string }> = {
  neutral: { icon: Info, className: "text-info" },
  success: { icon: CircleCheck, className: "text-success" },
  warning: { icon: TriangleAlert, className: "text-warning" },
  danger: { icon: CircleAlert, className: "text-danger" },
};

const AUTO_DISMISS_MS = 6000;
const AUTO_DISMISS_WITH_ACTION_MS = 12000; // time to reach the "Undo" button

function ToastItem({ toast }: { toast: Toast }) {
  const { t } = useTranslation();
  const dismiss = useToastStore((s) => s.dismiss);
  const { icon: Icon, className } = TONE[toast.tone];

  // Paused while the pointer or the focus is on it, so it can be read and acted on.
  const [held, setHeld] = useState({ hover: false, focus: false });
  const paused = held.hover || held.focus;
  useEffect(() => {
    if (paused) return;
    const delay =
      toast.action || toast.tone === "danger" ? AUTO_DISMISS_WITH_ACTION_MS : AUTO_DISMISS_MS;
    const timer = window.setTimeout(() => dismiss(toast.id), delay);
    return () => window.clearTimeout(timer);
  }, [dismiss, toast.id, toast.action, toast.tone, paused]);

  return (
    <div
      role={toast.tone === "danger" ? "alert" : "status"}
      onPointerEnter={() => setHeld((h) => ({ ...h, hover: true }))}
      onPointerLeave={() => setHeld((h) => ({ ...h, hover: false }))}
      onFocus={() => setHeld((h) => ({ ...h, focus: true }))}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setHeld((h) => ({ ...h, focus: false }));
      }}
      className="pointer-events-auto flex w-[360px] items-start gap-3 rounded-md border border-border bg-surface-2 p-3 shadow-overlay"
    >
      <Icon aria-hidden size={18} strokeWidth={1.5} className={`mt-px shrink-0 ${className}`} />
      <div className="min-w-0 flex-1">
        <div className="font-semibold">{toast.title}</div>
        {toast.detail && <div className="mt-0.5 text-control text-text-2">{toast.detail}</div>}
      </div>
      {toast.action && (
        <button
          type="button"
          onClick={() => {
            toast.action?.run();
            dismiss(toast.id);
          }}
          className="h-6 shrink-0 rounded-sm px-2 text-control font-semibold text-primary hover:bg-surface-3 hover:text-primary-hover"
        >
          {toast.action.label}
        </button>
      )}
      <button
        type="button"
        aria-label={t("toast.dismiss")}
        onClick={() => dismiss(toast.id)}
        className="grid size-6 shrink-0 place-items-center rounded-sm text-text-3 transition-colors duration-hover hover:bg-surface-3 hover:text-text"
      >
        <X size={14} strokeWidth={1.5} />
      </button>
    </div>
  );
}

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </div>
  );
}
