// Imports from DJ programs (SPEC 13.1): one job at a time (a preview or the import
// itself), and the outcome of the last one of each source.
import { useQuery } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import { create } from "zustand";
import { errorMessage } from "../../lib/errors";
import { request } from "../../lib/rpc";
import { useToastStore } from "../toast/toastStore";
import type {
  ErrorInfo,
  ImportOptions,
  ImportReport,
  ImportSourceStatus,
  JobFinished,
} from "../../lib/rpc.types";

export type ImportSource = ImportSourceStatus["source"];

/** The programs, in the order the Import screen lists them. */
export const IMPORT_SOURCES: { source: ImportSource; title: string }[] = [
  { source: "rekordbox", title: "Rekordbox" },
  { source: "traktor", title: "Traktor" },
  { source: "serato", title: "Serato" },
  { source: "virtualdj", title: "VirtualDJ" },
  { source: "engine_dj", title: "Engine DJ" },
];

export type ImportOutcome =
  | { status: "done"; result: ImportReport; options: ImportOptions }
  | { status: "failed"; error: string; errorInfo: ErrorInfo | null }
  | { status: "cancelled" };

interface ImportJobState {
  running: {
    source: ImportSource;
    jobId: string;
    options: ImportOptions;
    simulate: boolean;
  } | null;
  outcomes: Partial<Record<ImportSource, ImportOutcome>>;
  start: (options: ImportOptions, jobId: string, simulate: boolean) => void;
  finish: (job: JobFinished) => ImportOutcome | null;
}

export const useImportJobs = create<ImportJobState>((set, get) => ({
  running: null,
  outcomes: {},
  start: (options, jobId, simulate) =>
    set({ running: { source: options.source, jobId, options, simulate } }),
  finish: (job) => {
    const running = get().running;
    if (!running || running.jobId !== job.jobId) return null;
    const outcome: ImportOutcome =
      job.status === "done"
        ? {
            status: "done",
            result: job.result as unknown as ImportReport,
            options: running.options,
          }
        : job.status === "cancelled"
          ? { status: "cancelled" }
          : { status: "failed", error: job.error ?? "?", errorInfo: job.errorInfo ?? null };
    set((s) => ({ running: null, outcomes: { ...s.outcomes, [running.source]: outcome } }));
    return outcome;
  },
}));

export async function startImport(options: ImportOptions, simulate: boolean): Promise<void> {
  const { jobId } = await request(simulate ? "import.preview" : "import.apply", options);
  useImportJobs.getState().start(options, jobId, simulate);
}

/** Two option sets plan the same import (the preview stays valid for Import). */
export function sameImport(a: ImportOptions, b: ImportOptions): boolean {
  return JSON.stringify(normalise(a)) === JSON.stringify(normalise(b));
}

function normalise(o: ImportOptions): ImportOptions {
  return {
    source: o.source,
    path: o.path ?? null,
    policy: o.policy ?? null,
    pathMaps: o.pathMaps ?? null,
    playlists: o.playlists ?? true,
    addMissing: o.addMissing ?? false,
    language: o.language ?? "en",
  };
}

export function useImportHistory() {
  return useQuery({ queryKey: ["import", "history"], queryFn: () => request("import.history") });
}

export async function undoImport(
  batchId: string,
  t: TFunction,
  invalidate: () => void,
): Promise<void> {
  try {
    const result = await request("import.undo", { batchId });
    invalidate();
    useToastStore.getState().push({
      title: t("djImport.undone"),
      ...(result.skipped > 0
        ? { detail: t("djImport.undoSkipped", { count: result.skipped }) }
        : {}),
      tone: result.skipped > 0 ? "warning" : "success",
    });
  } catch (err) {
    useToastStore.getState().push({
      title: t("djImport.undoFailed", { error: errorMessage(err) }),
      tone: "danger",
    });
  }
}
