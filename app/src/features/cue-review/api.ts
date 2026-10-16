// Assisted cue review (SPEC 12.5): the queue, the verdicts and the accuracy report.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { request } from "../../lib/rpc";
import type { CueReviewReport, CueReviewSetParams } from "../../lib/rpc.types";

export const cueReviewKeys = {
  queue: (trackIds: number[] | null) => ["cueReview", "queue", trackIds] as const,
  report: ["cueReview", "report"] as const,
};

/** How many tracks a review batch asks for. */
export const BATCH = 20;
/** Bars each cue plays for. */
export const LISTEN_BARS = 8;

/** Fetched once per visit, so a verdict does not reshuffle the batch. */
export function useReviewQueue(trackIds: number[] | null) {
  return useQuery({
    queryKey: cueReviewKeys.queue(trackIds),
    queryFn: () => request("cueReview.queue", { n: BATCH, trackIds }),
    staleTime: Infinity,
    gcTime: 0,
  });
}

export function useReviewReport() {
  return useQuery({ queryKey: cueReviewKeys.report, queryFn: () => request("cueReview.report") });
}

export function useVerdicts() {
  const client = useQueryClient();
  const setReport = (report: CueReviewReport) => client.setQueryData(cueReviewKeys.report, report);
  return {
    set: useMutation({
      mutationFn: (p: CueReviewSetParams) => request("cueReview.set", p),
      onSuccess: (result) => setReport(result.report),
    }),
    remove: useMutation({
      mutationFn: (reviewId: number) => request("cueReview.delete", { reviewId }),
      onSuccess: setReport,
    }),
  };
}
