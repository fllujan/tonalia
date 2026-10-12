// Export jobs (SPEC 2.12): one at a time; the result of the last run of each target.
import { create } from "zustand";
import type { ExportResult, JobFinished } from "../../lib/rpc.types";

export type ExportTarget = "rekordbox" | "traktor" | "serato" | "virtualdj" | "engineDj";

export type ExportOutcome =
  | { status: "done"; result: ExportResult }
  | { status: "failed"; error: string }
  | { status: "cancelled" };

interface ExportState {
  running: { target: ExportTarget; jobId: string; simulate: boolean } | null;
  outcomes: Partial<Record<ExportTarget, ExportOutcome>>;
  start: (target: ExportTarget, jobId: string, simulate: boolean) => void;
  finish: (job: JobFinished) => void;
}

export const useExportStore = create<ExportState>((set, get) => ({
  running: null,
  outcomes: {},
  start: (target, jobId, simulate) => set({ running: { target, jobId, simulate } }),
  finish: (job) => {
    const running = get().running;
    if (!running || running.jobId !== job.jobId) return;
    const outcome: ExportOutcome =
      job.status === "done"
        ? { status: "done", result: job.result as unknown as ExportResult }
        : job.status === "cancelled"
          ? { status: "cancelled" }
          : { status: "failed", error: job.error ?? "?" };
    set((s) => ({ running: null, outcomes: { ...s.outcomes, [running.target]: outcome } }));
  },
}));
