// "Marcar como revisado" (Revisar calidad as a to-do list): the tracks leave the list, and
// the toast can put them back.
import type { QueryClient } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import { errorMessage } from "../../lib/errors";
import { useToastStore } from "../toast/toastStore";
import { libraryKeys, reviewQuality } from "./api";

export function markReviewed(
  trackIds: number[],
  title: string | null,
  t: TFunction,
  qc: QueryClient,
): void {
  const refresh = () => void qc.invalidateQueries({ queryKey: libraryKeys.all });
  const push = useToastStore.getState().push;
  const report = (err: unknown) =>
    push({ title: t("analysis.failed", { error: errorMessage(err) }), tone: "danger" });
  void reviewQuality(trackIds)
    .then(() => {
      refresh();
      push({
        title:
          title != null && trackIds.length === 1
            ? t("quality.markedReviewed", { title })
            : t("quality.markedReviewedMany", { count: trackIds.length }),
        tone: "success",
        action: {
          label: t("quality.undo"),
          run: () => void reviewQuality(trackIds, false).then(refresh).catch(report),
        },
      });
    })
    .catch(report);
}
