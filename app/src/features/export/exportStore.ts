// Export jobs (SPEC 2.12): one at a time; the result of the last run of each target.
import { create } from "zustand";
import type { ErrorInfo, ExportResult, JobFinished } from "../../lib/rpc.types";

export type ExportTarget = "rekordbox" | "traktor" | "serato" | "virtualdj" | "engineDj";

/** The destinations, in the order the Export screen and the set builder list them. */
export const EXPORT_TARGETS: { target: ExportTarget; title: string }[] = [
  { target: "rekordbox", title: "Rekordbox" },
  { target: "traktor", title: "Traktor" },
  { target: "serato", title: "Serato" },
  { target: "virtualdj", title: "VirtualDJ" },
  { target: "engineDj", title: "Engine DJ" },
];

/** Export opened for one playlist (a set from the builder): that destination, only it. */
export interface ExportPreset {
  target: ExportTarget;
  playlistId: number;
}

export type ExportOutcome =
  | { status: "done"; result: ExportResult }
  | { status: "failed"; error: string; errorInfo: ErrorInfo | null }
  | { status: "cancelled" };

interface ExportState {
  running: { target: ExportTarget; jobId: string; simulate: boolean } | null;
  outcomes: Partial<Record<ExportTarget, ExportOutcome>>;
  /** Read when the Export screen opens; cleared when it closes. */
  preset: ExportPreset | null;
  setPreset: (preset: ExportPreset | null) => void;
  start: (target: ExportTarget, jobId: string, simulate: boolean) => void;
  finish: (job: JobFinished) => void;
}

export const useExportStore = create<ExportState>((set, get) => ({
  running: null,
  outcomes: {},
  preset: null,
  setPreset: (preset) => set({ preset }),
  start: (target, jobId, simulate) => set({ running: { target, jobId, simulate } }),
  finish: (job) => {
    const running = get().running;
    if (!running || running.jobId !== job.jobId) return;
    const outcome: ExportOutcome =
      job.status === "done"
        ? { status: "done", result: job.result as unknown as ExportResult }
        : job.status === "cancelled"
          ? { status: "cancelled" }
          : { status: "failed", error: job.error ?? "?", errorInfo: job.errorInfo ?? null };
    set((s) => ({ running: null, outcomes: { ...s.outcomes, [running.target]: outcome } }));
  },
}));
