// Library data access. Rows are fetched in pages of PAGE_SIZE only for the range the
// virtualized table is showing, so scrolling through 100 000 tracks stays cheap.
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { request } from "../../lib/rpc";
import type {
  LibraryPage,
  LibraryQuery,
  TrackSummary,
  TrackUpdateParams,
} from "../../lib/rpc.types";
import { useToastStore } from "../toast/toastStore";
import { useAnalysisStore } from "./analysisStore";
import { useImportStore } from "./importStore";
import { errorMessage } from "../../lib/errors";

export const PAGE_SIZE = 200;

export type ListParams = Pick<
  LibraryQuery,
  "search" | "sort" | "descending" | "qualityIssues" | "playlistId" | "filter"
>;

export const libraryKeys = {
  all: ["library"] as const,
  page: (params: ListParams, page: number) => ["library", "list", params, page] as const,
};

function fetchPage(params: ListParams, page: number): Promise<LibraryPage> {
  return request("library.list", { ...params, offset: page * PAGE_SIZE, limit: PAGE_SIZE });
}

/** Total count for the current query (from the first page). */
export function useLibraryTotal(params: ListParams) {
  const query = useQuery({
    queryKey: libraryKeys.page(params, 0),
    queryFn: () => fetchPage(params, 0),
    placeholderData: (previous) => previous,
  });
  return { total: query.data?.total ?? 0, isLoading: query.isPending, isError: query.isError };
}

/** Rows for indices [first, last] (inclusive); unloaded rows come back undefined. */
export function useLibraryRows(params: ListParams, first: number, last: number) {
  const pages = useMemo(() => {
    if (last < first) return [0];
    const out: number[] = [];
    for (let p = Math.floor(first / PAGE_SIZE); p <= Math.floor(last / PAGE_SIZE); p++) out.push(p);
    return out;
  }, [first, last]);

  const results = useQueries({
    queries: pages.map((page) => ({
      queryKey: libraryKeys.page(params, page),
      queryFn: () => fetchPage(params, page),
    })),
  });

  const loaded = useMemo(() => {
    const map = new Map<number, TrackSummary[]>();
    results.forEach((r, i) => {
      const page = pages[i];
      if (r.data && page !== undefined) map.set(page, r.data.items);
    });
    return map;
  }, [results, pages]);

  return useCallback(
    (index: number): TrackSummary | undefined =>
      loaded.get(Math.floor(index / PAGE_SIZE))?.[index % PAGE_SIZE],
    [loaded],
  );
}

export function isNonEmpty<T>(items: T[]): items is [T, ...T[]] {
  return items.length > 0;
}

/** Every track id of a query (paged; used when an action applies to the whole view). */
export async function fetchAllIds(params: ListParams): Promise<number[]> {
  const ids: number[] = [];
  for (let offset = 0; ; offset += 5000) {
    const page = await request("library.list", { ...params, offset, limit: 5000 });
    ids.push(...page.items.map((t) => t.id));
    if (ids.length >= page.total || page.items.length === 0) return ids;
  }
}

export async function startImport(paths: string[]): Promise<void> {
  if (!isNonEmpty(paths)) return;
  const { jobId } = await request("library.addPaths", { paths });
  useImportStore.getState().start(jobId);
}

/** Statuses of the "Analizar" view: still to analyse, being analysed or failed. */
export const QUEUE_STATUSES = ["pending", "analyzing", "error"] as const;

/** Analyse every pending track (SPEC 2.4); the queue reports through progress events. */
export async function analyzePending(): Promise<void> {
  await request("analysis.start", {});
}

/** Analyse these tracks again from scratch (a failed one, or after a change). */
export async function reanalyze(trackIds: number[]): Promise<void> {
  if (!isNonEmpty(trackIds)) return;
  await request("analysis.reanalyze", { trackIds });
}

export async function cancelAnalysis(): Promise<void> {
  const jobId = useAnalysisStore.getState().jobId;
  if (jobId) await request("job.cancel", { jobId });
}

export async function cancelImport(): Promise<void> {
  const jobId = useImportStore.getState().jobId;
  if (jobId) await request("job.cancel", { jobId });
}

/** Manual key / BPM edit (SPEC 2.14: it prevails over the analysis). */
export function useUpdateTrack() {
  const client = useQueryClient();
  const { t } = useTranslation();
  return useMutation({
    mutationFn: (params: TrackUpdateParams) => request("track.update", params),
    onSuccess: () => void client.invalidateQueries({ queryKey: libraryKeys.all }),
    onError: (err) =>
      useToastStore.getState().push({
        title: t("edit.failed", { error: errorMessage(err) }),
        tone: "danger",
      }),
  });
}

/** Genres in the library with their track counts (most used first). */
export function useGenres() {
  const query = useQuery({
    queryKey: [...libraryKeys.all, "genres"],
    queryFn: () => request("library.genres"),
  });
  return query.data?.genres ?? [];
}
