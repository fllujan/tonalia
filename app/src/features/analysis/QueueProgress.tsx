// Progress header of the Analyse view (DESIGN 6.4): "Analizando 342 de 1.200 · quedan
// ~6 min", the global bar in the aurora gradient and Cancel. Cancelling leaves the rest
// pending, so "Analizar N pendientes" picks up where it stopped. When a run ends, a line
// says what it did and leads back to the library, so the end is not just rows vanishing.
import { useEffect, useState } from "react";
import { CircleCheck, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatCount } from "../../lib/format";
import { cancelAnalysis } from "../library/api";
import { analysisSummary } from "../library/useLibraryEvents";
import { useViewStore } from "../navigation/viewStore";
import { remainingSeconds, useAnalysisStore } from "../library/analysisStore";

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

export function QueueProgress() {
  const { t, i18n } = useTranslation();
  const { jobId, done, total, percent, startedAt } = useAnalysisStore();
  const now = useNow(jobId !== null);
  if (!jobId) return <LastRun />;
  const n = (count: number) => formatCount(count, i18n.language);
  const label =
    total > 0 ? t("analysis.progress", { done: n(done), total: n(total) }) : t("analysis.starting");
  const left = remainingSeconds(percent, now - startedAt);
  const minutes = left === null ? 0 : Math.ceil(left / 60);
  const eta =
    left === null
      ? t("analysis.remaining.estimating")
      : left < 60
        ? t("analysis.remaining.soon")
        : minutes < 60
          ? t("analysis.remaining.minutes", { count: minutes })
          : t("analysis.remaining.hours", {
              hours: Math.floor(minutes / 60),
              minutes: minutes % 60,
            });
  return (
    <div role="status" className="flex shrink-0 flex-col gap-2 border-b border-border px-5 py-3">
      <div className="flex items-center gap-2">
        <span className="text-control font-medium text-text">{label}</span>
        <span className="text-control text-text-2">· {eta}</span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => void cancelAnalysis()}
          className="flex h-8 items-center rounded-sm border border-border bg-surface-3 px-3 text-text transition-colors duration-hover hover:border-border-strong"
        >
          {t("import.cancel")}
        </button>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-pill bg-surface-3"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percent)}
      >
        <div
          className="h-full rounded-pill bg-aurora transition-[width] duration-panel"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

function LastRun() {
  const { t } = useTranslation();
  const last = useAnalysisStore((s) => s.last);
  if (!last) return null;
  const failed = (last.failed ?? 0) > 0;
  return (
    <div
      role="status"
      aria-label={t("analysis.done")}
      className="flex shrink-0 items-center gap-2 border-b border-border px-5 py-2.5"
    >
      <CircleCheck
        aria-hidden
        size={16}
        strokeWidth={1.5}
        className={failed ? "text-warning" : "text-success"}
      />
      <span className="text-control font-medium text-text">{t("analysis.done")}</span>
      <span className="text-control text-text-2">· {analysisSummary(last, t)}</span>
      <span className="flex-1" />
      <button
        type="button"
        onClick={() => useViewStore.getState().show("library")}
        className="flex h-8 items-center rounded-sm border border-border bg-surface-3 px-3 text-text transition-colors duration-hover hover:border-border-strong"
      >
        {t("analysis.seeLibrary")}
      </button>
      <button
        type="button"
        aria-label={t("toast.dismiss")}
        title={t("toast.dismiss")}
        onClick={() => useAnalysisStore.getState().dismissLast()}
        className="grid size-8 place-items-center rounded-sm text-text-3 transition-colors duration-hover hover:text-text"
      >
        <X aria-hidden size={16} strokeWidth={1.5} />
      </button>
    </div>
  );
}
