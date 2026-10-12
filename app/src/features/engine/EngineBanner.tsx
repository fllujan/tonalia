// DESIGN 6.15: amber banner at the top when the analysis engine restarts, with details and
// the logs folder; red while it does not answer.
import { ChevronDown, LoaderCircle, TriangleAlert, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { openLogsFolder } from "../../lib/system";
import type { EngineState } from "./useEngineStatus";

export function EngineBanner({ status, restarted, retry, dismissRestart }: EngineState) {
  const { t } = useTranslation();
  const [details, setDetails] = useState(false);
  const kind =
    status === "restarting"
      ? "restarting"
      : status === "disconnected"
        ? "down"
        : restarted
          ? "restarted"
          : null;
  if (!kind) return null;
  const danger = kind === "down";
  const linkButton =
    "h-6 shrink-0 rounded-sm px-2 text-control font-semibold hover:bg-surface-3 hover:text-text";
  return (
    <div
      role={danger ? "alert" : "status"}
      className={`flex shrink-0 flex-col gap-1.5 border-b px-5 py-2 text-control ${danger ? "border-danger/40 bg-danger/10" : "border-warning/40 bg-warning/10"}`}
    >
      <div className="flex items-center gap-2.5">
        {kind === "restarting" ? (
          <LoaderCircle
            aria-hidden
            size={16}
            strokeWidth={1.5}
            className="shrink-0 animate-spin text-warning motion-reduce:animate-none"
          />
        ) : (
          <TriangleAlert
            aria-hidden
            size={16}
            strokeWidth={1.5}
            className={`shrink-0 ${danger ? "text-danger" : "text-warning"}`}
          />
        )}
        <span className="min-w-0 flex-1 font-medium text-text">{t(`engine.banner.${kind}`)}</span>
        {kind !== "restarting" && (
          <button
            type="button"
            aria-expanded={details}
            onClick={() => setDetails((d) => !d)}
            className={`${linkButton} flex items-center gap-1 text-text-2`}
          >
            {t("engine.banner.details")}
            <ChevronDown
              aria-hidden
              size={14}
              strokeWidth={1.5}
              className={`transition-transform duration-hover ${details ? "rotate-180" : ""}`}
            />
          </button>
        )}
        {danger && (
          <button type="button" onClick={retry} className={`${linkButton} text-primary`}>
            {t("engine.retry")}
          </button>
        )}
        {kind === "restarted" && (
          <button
            type="button"
            aria-label={t("toast.dismiss")}
            onClick={dismissRestart}
            className="grid size-6 shrink-0 place-items-center rounded-sm text-text-3 hover:bg-surface-3 hover:text-text"
          >
            <X aria-hidden size={14} strokeWidth={1.5} />
          </button>
        )}
      </div>
      {details && kind !== "restarting" && (
        <div className="flex flex-col items-start gap-2 pb-1 pl-[26px] text-text-2">
          <p className="max-w-[720px]">{t(`engine.banner.${kind}Detail`)}</p>
          <button
            type="button"
            onClick={() => void openLogsFolder().catch(() => undefined)}
            className="h-7 rounded-sm border border-border bg-surface-3 px-2.5 text-text hover:border-border-strong"
          >
            {t("settings.openLogs")}
          </button>
        </div>
      )}
    </div>
  );
}
