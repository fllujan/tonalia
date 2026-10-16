// The way into "Revisar cues" (SPEC 12.5) from the Analyse view: what it is for and, once
// cues have been reviewed, how many are right.
import { ListChecks } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatCount } from "../../lib/format";
import { useViewStore } from "../navigation/viewStore";
import { BATCH, useReviewReport } from "./api";

export function CueReviewCard() {
  const { t, i18n } = useTranslation();
  const report = useReviewReport().data;
  const open = useViewStore((s) => s.openCueReview);
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-surface-2 p-4 shadow-card">
      <h2 className="flex items-center gap-2 text-section">
        <ListChecks size={16} strokeWidth={1.5} aria-hidden className="text-primary-ink" />
        {t("cueReview.card.title")}
      </h2>
      <p className="text-[12px] text-text-2">{t("cueReview.card.text", { n: BATCH })}</p>
      {report && report.accuracy != null && (
        <p className="text-[12px] text-text-3">
          {t("cueReview.card.done", {
            count: report.reviewedCues,
            n: formatCount(report.reviewedCues, i18n.language),
            percent: new Intl.NumberFormat(i18n.language, { style: "percent" }).format(
              report.accuracy,
            ),
          })}
        </p>
      )}
      <div>
        <button
          type="button"
          onClick={() => open(null)}
          className="mt-1 h-8 rounded-sm border border-border bg-surface-3 px-3 text-control hover:border-border-strong"
        >
          {t("cueReview.open")}
        </button>
      </div>
    </div>
  );
}
