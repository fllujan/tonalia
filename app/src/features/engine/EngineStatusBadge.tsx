import { useTranslation } from "react-i18next";
import type { EngineStatus } from "./useEngineStatus";

const DOT: Record<EngineStatus, string> = {
  connecting: "bg-text-3",
  connected: "bg-success",
  restarting: "bg-warning",
  disconnected: "bg-danger",
};

export function EngineStatusBadge({
  status,
  onRetry,
}: {
  status: EngineStatus;
  onRetry?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      role="status"
      aria-live="polite"
      className="inline-flex items-center gap-2 rounded-pill border border-border bg-surface-2 px-3 py-1 text-control text-text-2"
    >
      <span aria-hidden className={`size-2 rounded-pill ${DOT[status]}`} />
      <span>
        {t("engine.label")}: <span className="text-text">{t(`engine.status.${status}`)}</span>
      </span>
      {status === "disconnected" && onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="ml-1 rounded-sm px-1.5 text-primary transition-colors duration-hover hover:text-primary-hover"
        >
          {t("engine.retry")}
        </button>
      )}
    </div>
  );
}
