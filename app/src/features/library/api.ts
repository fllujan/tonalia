// Library data access. Rows are fetched in pages of PAGE_SIZE only for the range the
// virtualized table is showing, so scrolling through 100 000 tracks stays cheap.
import { useQueries, useQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { request } from "../../lib/rpc";
import type { LibraryPage, LibraryQuery, TrackSummary } from "../../lib/rpc.types";
import { useAnalysisStore } from "./analysisStore";
import { useImportStore } from "./importStore";

export const PAGE_SIZE = 200;

export type ListParams = Pick<LibraryQuery, "search" | "sort" | "descending">;

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

function isNonEmpty<T>(items: T[]): items is [T, ...T[]] {
  return items.length > 0;
}

export async function startImport(paths: string[]): Promise<void> {
  if (!isNonEmpty(paths)) return;
  const { jobId } = await request("library.addPaths", { paths });
  useImportStore.getState().start(jobId);
}

export async function cancelAnalysis(): Promise<void> {
  const jobId = useAnalysisStore.getState().jobId;
  if (jobId) await request("job.cancel", { jobId });
}

export async function cancelImport(): Promise<void> {
  const jobId = useImportStore.getState().jobId;
  if (jobId) await request("job.cancel", { jobId });
}
