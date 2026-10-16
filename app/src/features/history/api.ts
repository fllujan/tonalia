// Play history (SPEC 13.4): the sessions, importing a program's history (a job), marking
// a selection, a playlist or a set as played on a day, and forgetting a session.
import { useQuery, type QueryClient } from "@tanstack/react-query";
import { create } from "zustand";
import { request } from "../../lib/rpc";
import type {
  ErrorInfo,
  HistoryImportResult,
  HistoryMarkParams,
  JobFinished,
} from "../../lib/rpc.types";
import type { ImportSource } from "../dj-import/importJobs";
import { libraryKeys } from "../library/api";
import { useSettings } from "../settings/api";

export const historyKey = ["history"] as const;

export function useHistory() {
  return useQuery({ queryKey: historyKey, queryFn: () => request("history.list", {}) });
}

export function useHistorySources(enabled: boolean) {
  return useQuery({
    queryKey: [...historyKey, "detect"],
    queryFn: () => request("history.detect"),
    enabled,
  });
}

/** Everything that shows plays: the sessions, the table rows and the smart playlists. */
export function invalidateHistory(client: QueryClient) {
  for (const key of [historyKey, libraryKeys.all, ["track"]])
    void client.invalidateQueries({ queryKey: key });
}

export type HistoryOutcome =
  | { status: "done"; result: HistoryImportResult }
  | { status: "failed"; error: string; errorInfo: ErrorInfo | null }
  | { status: "cancelled" };

interface ImportState {
  running: { jobId: string; source: ImportSource } | null;
  outcome: { source: ImportSource; outcome: HistoryOutcome } | null;
  start: (jobId: string, source: ImportSource) => void;
  finish: (job: JobFinished) => HistoryOutcome | null;
  clear: () => void;
}

export const useHistoryImport = create<ImportState>((set, get) => ({
  running: null,
  outcome: null,
  start: (jobId, source) => set({ running: { jobId, source }, outcome: null }),
  finish: (job) => {
    const running = get().running;
    if (running?.jobId !== job.jobId) return null;
    const outcome: HistoryOutcome =
      job.status === "done"
        ? { status: "done", result: job.result as unknown as HistoryImportResult }
        : job.status === "cancelled"
          ? { status: "cancelled" }
          : { status: "failed", error: job.error ?? "?", errorInfo: job.errorInfo ?? null };
    set({ running: null, outcome: { source: running.source, outcome } });
    return outcome;
  },
  clear: () => set({ outcome: null }),
}));

export async function startHistoryImport(source: ImportSource, path: string | null) {
  const { jobId } = await request("history.import", { source, path });
  useHistoryImport.getState().start(jobId, source);
}

export function markPlayed(params: HistoryMarkParams) {
  return request("history.markPlayed", params);
}

export function deleteSession(sessionId: number) {
  return request("history.deleteSession", { sessionId });
}

/** The days to avoid in the set builder and the Pro ideas (0 = off), from the settings. */
export function useAvoidPlayedDays(): number {
  return useSettings().historyAvoidDays;
}
