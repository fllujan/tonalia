// Taking a library from one DJ program to another (SPEC 13.2): one job at a time (the
// plan, which changes nothing, or the trip itself) and the outcome of the last one.
import { create } from "zustand";
import { request } from "../../lib/rpc";
import type { ConvertOptions, ConvertReport, ErrorInfo, JobFinished } from "../../lib/rpc.types";

export type ConvertOutcome =
  | { status: "done"; result: ConvertReport; options: ConvertOptions }
  | { status: "failed"; error: string; errorInfo: ErrorInfo | null }
  | { status: "cancelled" };

interface ConvertJobState {
  running: { jobId: string; options: ConvertOptions; simulate: boolean } | null;
  outcome: ConvertOutcome | null;
  start: (options: ConvertOptions, jobId: string, simulate: boolean) => void;
  finish: (job: JobFinished) => ConvertOutcome | null;
  clear: () => void;
}

export const useConvertJobs = create<ConvertJobState>((set, get) => ({
  running: null,
  outcome: null,
  start: (options, jobId, simulate) => set({ running: { jobId, options, simulate } }),
  finish: (job) => {
    const running = get().running;
    if (!running || running.jobId !== job.jobId) return null;
    const outcome: ConvertOutcome =
      job.status === "done"
        ? {
            status: "done",
            result: job.result as unknown as ConvertReport,
            options: running.options,
          }
        : job.status === "cancelled"
          ? { status: "cancelled" }
          : { status: "failed", error: job.error ?? "?", errorInfo: job.errorInfo ?? null };
    set({ running: null, outcome });
    return outcome;
  },
  clear: () => set({ outcome: null }),
}));

export async function startConvert(options: ConvertOptions, simulate: boolean): Promise<void> {
  const { jobId } = await request(simulate ? "convert.plan" : "convert.apply", options);
  useConvertJobs.getState().start(options, jobId, simulate);
}

/** Two option sets plan the same trip (the plan stays valid for the trip). */
export function sameConvert(a: ConvertOptions, b: ConvertOptions): boolean {
  const norm = (o: ConvertOptions) => ({
    source: o.source,
    target: o.target,
    sourcePath: o.sourcePath ?? null,
    targetPath: o.targetPath ?? null,
    policy: o.policy ?? null,
    pathMaps: o.pathMaps ?? null,
    playlists: o.playlists ?? true,
    addMissing: o.addMissing ?? false,
    language: o.language ?? "en",
  });
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
}
