// Single subscription to engine notifications that matter to the library: import
// progress refreshes the table every second (it fills while importing) and the final
// `job.finished` event shows a summary toast.
import { finishRender } from "../decks/renderJobs";
import { handleStemsFinished } from "../stems/api";
import { useStemsStore } from "../stems/stemsStore";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { onEngineEvent, onProgress } from "../../lib/rpc";
import type {
  AddPathsResult,
  AnalysisSummary,
  AnalysisTrackDone,
  JobFinished,
  JobStartedEvent,
  TagUndoResult,
  TagWriteResult,
} from "../../lib/rpc.types";
import { useExportStore } from "../export/exportStore";
import { startTagUndo } from "../tags/api";
import { useTagJobStore } from "../tags/tagJobStore";
import { useToastStore } from "../toast/toastStore";
import { useAnalysisStore } from "./analysisStore";
import { libraryKeys } from "./api";
import { useImportStore } from "./importStore";
import { describeMessage } from "../../lib/errors";

const REFRESH_MS = 1000;

export function importSummary(result: AddPathsResult, t: TFunction): string {
  const parts = (["added", "updated", "moved", "duplicates"] as const)
    .filter((k) => (result[k] ?? 0) > 0)
    .map((k) => t(`import.summary.${k}`, { count: result[k] ?? 0 }));
  const failed = result.failed?.length ?? 0;
  if (failed > 0) parts.push(t("import.summary.failed", { count: failed }));
  return parts.length > 0 ? parts.join(" · ") : t("import.summary.nothing");
}

export function analysisSummary(result: AnalysisSummary, t: TFunction): string {
  const parts = [t("analysis.summary.analyzed", { count: result.analyzed ?? 0 })];
  if ((result.failed ?? 0) > 0)
    parts.push(t("import.summary.failed", { count: result.failed ?? 0 }));
  return parts.join(" · ");
}

function handleAnalysisFinished(job: JobFinished, qc: QueryClient, t: TFunction) {
  useAnalysisStore.getState().finish(job.jobId);
  void qc.invalidateQueries({ queryKey: libraryKeys.all });
  const push = useToastStore.getState().push;
  if (job.status === "done" && job.result) {
    const result = job.result as AnalysisSummary;
    push({
      title: t("analysis.done"),
      detail: analysisSummary(result, t),
      tone: (result.failed ?? 0) > 0 ? "warning" : "success",
    });
  } else if (job.status === "cancelled") {
    push({ title: t("analysis.cancelled"), tone: "neutral" });
  } else if (job.status === "failed") {
    push({
      title: t("analysis.failed", { error: describeMessage(job.error ?? "?") }),
      tone: "danger",
    });
  }
}

function handleTagsFinished(job: JobFinished, qc: QueryClient, t: TFunction) {
  useTagJobStore.getState().finish(job.jobId);
  void qc.invalidateQueries({ queryKey: libraryKeys.all });
  void qc.invalidateQueries({ queryKey: ["tags"] });
  void qc.invalidateQueries({ queryKey: ["track"] });
  const push = useToastStore.getState().push;
  if (job.status === "failed") {
    push({ title: t("tags.failed", { error: describeMessage(job.error ?? "?") }), tone: "danger" });
    return;
  }
  if (job.kind === "tags.write" && job.result) {
    const result = job.result as unknown as TagWriteResult;
    const failed = result.failed?.length ?? 0;
    push({
      title: t("tags.written", { count: result.written ?? 0 }),
      ...(failed > 0
        ? { detail: t("import.summary.failed", { count: failed }) }
        : (result.written ?? 0) > 0
          ? { detail: t("tags.history.later") }
          : {}),
      tone: failed > 0 ? "warning" : "success",
      ...((result.written ?? 0) > 0
        ? { action: { label: t("tags.undo"), run: () => void startTagUndo(result.batchId) } }
        : {}),
    });
  } else if (job.kind === "tags.undo" && job.result) {
    const result = job.result as unknown as TagUndoResult;
    const skipped = result.skipped?.length ?? 0;
    push({
      title: t("tags.restored", { count: result.restored ?? 0 }),
      ...(skipped > 0 ? { detail: t("tags.skipped", { count: skipped }) } : {}),
      tone: skipped > 0 ? "warning" : "success",
    });
  }
}

function handleFinished(job: JobFinished, qc: QueryClient, t: TFunction) {
  if (job.kind === "analysis") return handleAnalysisFinished(job, qc, t);
  if (job.kind === "render.preview") return finishRender(job);
  if (job.kind.startsWith("export.")) return useExportStore.getState().finish(job);
  if (job.kind.startsWith("stems.")) return handleStemsFinished(job, qc, t);
  if (job.kind === "tags.write" || job.kind === "tags.undo") return handleTagsFinished(job, qc, t);
  if (job.kind === "watch.import") {
    void qc.invalidateQueries({ queryKey: libraryKeys.all });
    const result = job.result as AddPathsResult | null;
    const found = (result?.added ?? 0) + (result?.updated ?? 0) + (result?.moved ?? 0);
    if (job.status === "done" && found > 0)
      useToastStore.getState().push({ title: t("watch.found", { count: found }), tone: "success" });
    return;
  }
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
    push({
      title: t("import.failed", { error: describeMessage(job.error ?? "?") }),
      tone: "danger",
    });
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

    const refresh = () => {
      const now = Date.now();
      if (now - lastRefresh > REFRESH_MS) {
        lastRefresh = now;
        void qc.invalidateQueries({ queryKey: libraryKeys.all });
      }
    };

    keep(
      onProgress((p) => {
        useImportStore.getState().progress(p);
        useAnalysisStore.getState().progress(p);
        useTagJobStore.getState().progress(p);
        useStemsStore.getState().progress(p);
        if (p.stage === "importing") refresh();
      }),
    );
    keep(
      onEngineEvent((e) => {
        if (e.type === "job.finished") handleFinished(e.payload as unknown as JobFinished, qc, t);
        else if (e.type === "job.started") {
          const job = e.payload as unknown as JobStartedEvent;
          if (job.kind === "analysis") useAnalysisStore.getState().start(job.jobId);
        } else if (e.type === "analysis.trackDone") {
          useAnalysisStore.getState().trackDone(e.payload as unknown as AnalysisTrackDone);
          refresh();
        }
      }),
    );

    return () => {
      disposed = true;
      unlisteners.forEach((fn) => fn());
    };
  }, [qc, t]);
}
