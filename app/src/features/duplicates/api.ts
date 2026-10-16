// Duplicates (SPEC 13.3): the groups waiting for a decision, the scan (a job, one at a
// time, with its progress) and the actions on a group.
import { useQuery } from "@tanstack/react-query";
import { create } from "zustand";
import { request } from "../../lib/rpc";
import type {
  DuplicateResolveParams,
  DuplicateScanResult,
  ErrorInfo,
  JobFinished,
} from "../../lib/rpc.types";

export const duplicatesKey = ["duplicates"] as const;

export function useDuplicates() {
  return useQuery({ queryKey: duplicatesKey, queryFn: () => request("duplicates.list") });
}

export type ScanOutcome =
  | { status: "done"; result: DuplicateScanResult }
  | { status: "failed"; error: string; errorInfo: ErrorInfo | null }
  | { status: "cancelled" };

interface ScanState {
  running: { jobId: string; stage: string; percent: number } | null;
  outcome: ScanOutcome | null;
  start: (jobId: string) => void;
  progress: (jobId: string, stage: string, percent: number) => void;
  finish: (job: JobFinished) => ScanOutcome | null;
}

export const useDuplicateScan = create<ScanState>((set, get) => ({
  running: null,
  outcome: null,
  start: (jobId) => set({ running: { jobId, stage: "fingerprints", percent: 0 } }),
  progress: (jobId, stage, percent) => {
    if (get().running?.jobId === jobId) set({ running: { jobId, stage, percent } });
  },
  finish: (job) => {
    if (get().running?.jobId !== job.jobId) return null;
    const outcome: ScanOutcome =
      job.status === "done"
        ? { status: "done", result: job.result as unknown as DuplicateScanResult }
        : job.status === "cancelled"
          ? { status: "cancelled" }
          : { status: "failed", error: job.error ?? "?", errorInfo: job.errorInfo ?? null };
    set({ running: null, outcome });
    return outcome;
  },
}));

export async function startScan(full = false): Promise<void> {
  const { jobId } = await request("duplicates.scan", { full });
  useDuplicateScan.getState().start(jobId);
}

export function resolveGroup(params: DuplicateResolveParams) {
  return request("duplicates.resolve", params);
}

export function undoMerge(mergeId: string) {
  return request("duplicates.undo", { mergeId });
}
