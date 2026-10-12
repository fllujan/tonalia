// "Tonalia X is available" with its notes, "Install and restart" and "Not now".
import { Download, LoaderCircle, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useUpdateStore } from "./updateStore";

export function UpdateBanner() {
  const { t, i18n } = useTranslation();
  const { status, version, notes, progress, dismissed, error, install, dismiss } = useUpdateStore();
  const [showNotes, setShowNotes] = useState(false);
  const visible =
    (status === "available" && !dismissed) ||
    status === "downloading" ||
    status === "installing" ||
    (status === "error" && version != null);
  if (!visible || !version) return null;
  const busy = status === "downloading" || status === "installing";
  const percent =
    progress == null
      ? null
      : new Intl.NumberFormat(i18n.language, { style: "percent" }).format(progress);
  return (
    <div
      role="status"
      className="flex shrink-0 flex-col gap-1.5 border-b border-info/40 bg-info/10 px-5 py-2 text-control"
    >
      <div className="flex items-center gap-2.5">
        {busy ? (
          <LoaderCircle
            aria-hidden
            size={16}
            strokeWidth={1.5}
            className="shrink-0 animate-spin text-info motion-reduce:animate-none"
          />
        ) : (
          <Download aria-hidden size={16} strokeWidth={1.5} className="shrink-0 text-info" />
        )}
        <span className="min-w-0 flex-1 font-medium text-text">
          {status === "downloading"
            ? t("updates.downloading", { version, percent: percent ?? "…" })
            : status === "installing"
              ? t("updates.installing", { version })
              : status === "error"
                ? t("updates.installFailed", { error })
                : t("updates.available", { version })}
        </span>
        {notes && !busy && (
          <button
            type="button"
            aria-expanded={showNotes}
            onClick={() => setShowNotes((s) => !s)}
            className="h-6 shrink-0 rounded-sm px-2 font-semibold text-text-2 hover:bg-surface-3 hover:text-text"
          >
            {t("updates.notes")}
          </button>
        )}
        {!busy && (
          <button
            type="button"
            onClick={() => void install()}
            className="h-7 shrink-0 rounded-sm bg-primary px-3 font-semibold text-white hover:bg-primary-hover"
          >
            {t(status === "error" ? "updates.retry" : "updates.install")}
          </button>
        )}
        {!busy && (
          <button
            type="button"
            aria-label={t("updates.later")}
            title={t("updates.later")}
            onClick={dismiss}
            className="grid size-6 shrink-0 place-items-center rounded-sm text-text-3 hover:bg-surface-3 hover:text-text"
          >
            <X aria-hidden size={14} strokeWidth={1.5} />
          </button>
        )}
      </div>
      {showNotes && notes && !busy && (
        <p className="max-w-[720px] whitespace-pre-line pb-1 pl-[26px] text-text-2">{notes}</p>
      )}
    </div>
  );
}
