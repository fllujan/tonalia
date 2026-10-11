// Single subscription to engine notifications that matter to the library: import
// progress refreshes the table every second (it fills while importing) and the final
// `job.finished` event shows a summary toast.
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { onEngineEvent, onProgress } from "../../lib/rpc";
import type { AddPathsResult, JobFinished } from "../../lib/rpc.types";
import { useToastStore } from "../toast/toastStore";
import { libraryKeys } from "./api";
import { useImportStore } from "./importStore";

const REFRESH_MS = 1000;

export function importSummary(result: AddPathsResult, t: TFunction): string {
  const parts = (["added", "updated", "moved", "duplicates"] as const)
    .filter((k) => (result[k] ?? 0) > 0)
    .map((k) => t(`import.summary.${k}`, { count: result[k] ?? 0 }));
  const failed = result.failed?.length ?? 0;
  if (failed > 0) parts.push(t("import.summary.failed", { count: failed }));
  return parts.length > 0 ? parts.join(" · ") : t("import.summary.nothing");
}

function handleFinished(job: JobFinished, qc: QueryClient, t: TFunction) {
  if (job.kind !== "library.addPaths") return;
  useImportStore.getState().finish(job.jobId);
  void qc.invalidateQueries({ queryKey: libraryKeys.all });
  const push = useToastStore.getState().push;
  if (job.status === "done" && job.result) {
    const result = job.result as AddPathsResult;
    push({
      title: t("import.done"),
      detail: importSummary(result, t),
      tone: (result.failed?.length ?? 0) > 0 ? "warning" : "success",
    });
  } else if (job.status === "cancelled") {
    push({ title: t("import.cancelled"), tone: "neutral" });
  } else {
    push({ title: t("import.failed", { error: job.error ?? "?" }), tone: "danger" });
  }
}

export function useLibraryEvents(): void {
  const qc = useQueryClient();
  const { t } = useTranslation();

  useEffect(() => {
    let disposed = false;
    let lastRefresh = 0;
    const unlisteners: (() => void)[] = [];
    const keep = (p: Promise<() => void>) =>
      p
        .then((fn) => {
          if (disposed) fn();
          else unlisteners.push(fn);
        })
        .catch(() => undefined);

    keep(
      onProgress((p) => {
        useImportStore.getState().progress(p);
        const now = Date.now();
        if (p.stage === "importing" && now - lastRefresh > REFRESH_MS) {
          lastRefresh = now;
          void qc.invalidateQueries({ queryKey: libraryKeys.all });
        }
      }),
    );
    keep(
      onEngineEvent((e) => {
        if (e.type === "job.finished") handleFinished(e.payload as unknown as JobFinished, qc, t);
      }),
    );

    return () => {
      disposed = true;
      unlisteners.forEach((fn) => fn());
    };
  }, [qc, t]);
}
