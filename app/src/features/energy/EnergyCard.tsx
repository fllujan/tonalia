// The way into "Calibrar energía" (SPEC 12.2): in Settings → Analysis and in the Analyse
// view. Says where the DJ stands (ratings so far, or the calibration in use) in one line.
import { Activity } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatCount } from "../../lib/format";
import { useViewStore } from "../navigation/viewStore";
import { useEnergyStatus } from "./api";

export function EnergyCard({ compact = false }: { compact?: boolean }) {
  const { t, i18n } = useTranslation();
  const status = useEnergyStatus().data;
  const open = useViewStore((s) => s.openEnergy);
  const mae = (v: number) =>
    new Intl.NumberFormat(i18n.language, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 2,
    }).format(v);
  const line = !status
    ? null
    : status.model === "personal" && status.calibration
      ? t("energyCal.card.personal", {
          before: mae(status.calibration.maeBefore),
          after: mae(status.calibration.maeAfter),
        })
      : status.usable >= status.needed
        ? t("energyCal.card.ready", {
            count: status.usable,
            n: formatCount(status.usable, i18n.language),
          })
        : t("energyCal.card.progress", {
            count: status.needed,
            done: formatCount(status.usable, i18n.language),
            needed: formatCount(status.needed, i18n.language),
          });
  return (
    <div
      className={`flex flex-col gap-2 rounded-md border border-border bg-surface-2 shadow-card ${compact ? "p-4" : "p-5"}`}
    >
      <h2 className="flex items-center gap-2 text-section">
        <Activity size={16} strokeWidth={1.5} aria-hidden className="text-primary-ink" />
        {t("energyCal.card.title")}
      </h2>
      <p className="text-[12px] text-text-2">{t("energyCal.card.text")}</p>
      {line && <p className="text-[12px] text-text-3">{line}</p>}
      <div>
        <button
          type="button"
          onClick={open}
          className="mt-1 h-8 rounded-sm border border-border bg-surface-3 px-3 text-control hover:border-border-strong"
        >
          {t("energyCal.open")}
        </button>
      </div>
    </div>
  );
}
