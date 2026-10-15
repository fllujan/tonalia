// Personal energy (SPEC 12.2): ratings, calibration and the import of ratings in tags.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { request } from "../../lib/rpc";
import type { EnergyImportPreviewParams, EnergyStatus } from "../../lib/rpc.types";
import { libraryKeys } from "../library/api";

export const energyKeys = {
  all: ["energy"] as const,
  status: ["energy", "status"] as const,
  queue: ["energy", "queue"] as const,
};

/** The patterns the engine uses by default ({n} is the level). */
export const DEFAULT_PATTERNS = ["Energy {n}", "E{n}", "{n} - ", "{n}"];

/** How many tracks the rating screen asks for at a time. */
export const QUEUE_SIZE = 20;

export function useEnergyStatus() {
  return useQuery({ queryKey: energyKeys.status, queryFn: () => request("energy.status") });
}

/** The tracks to rate; fetched once per visit so rating one does not reshuffle the rest. */
export function useRatingQueue() {
  return useQuery({
    queryKey: energyKeys.queue,
    queryFn: () => request("energy.ratingQueue", { n: QUEUE_SIZE }),
    staleTime: Infinity,
    gcTime: 0,
  });
}

function useSetStatus() {
  const client = useQueryClient();
  return (status: EnergyStatus) => client.setQueryData(energyKeys.status, status);
}

export function useRate() {
  const setStatus = useSetStatus();
  return useMutation({
    mutationFn: (p: { trackId: number; rating: number | null }) => request("energy.rate", p),
    onSuccess: setStatus,
  });
}

/** Recomputing every level changes the library: its tables and stats refresh. */
function useAfterRecompute() {
  const client = useQueryClient();
  const setStatus = useSetStatus();
  return (status: EnergyStatus) => {
    setStatus(status);
    void client.invalidateQueries({ queryKey: libraryKeys.all });
  };
}

export function useCalibrate() {
  const after = useAfterRecompute();
  return useMutation({
    mutationFn: (apply: boolean) => request("energy.calibrate", { apply }),
    onSuccess: (result) => (result.applied ? after(result.status) : undefined),
  });
}

export function useRevert() {
  const after = useAfterRecompute();
  return useMutation({
    mutationFn: () => request("energy.revert"),
    onSuccess: (result) => after(result.status),
  });
}

export function useImportPreview() {
  return useMutation({
    mutationFn: (p: EnergyImportPreviewParams) => request("energy.importPreview", p),
  });
}

export function useImportRatings() {
  const client = useQueryClient();
  const setStatus = useSetStatus();
  return useMutation({
    mutationFn: (p: { items: { trackId: number; rating: number }[]; overwrite: boolean }) =>
      request("energy.import", p),
    onSuccess: (result) => {
      setStatus(result.status);
      void client.invalidateQueries({ queryKey: energyKeys.queue });
    },
  });
}

/** Keys 1–9 rate 1–9 and 0 rates 10 (SPEC 12.2). */
export function ratingFromKey(key: string): number | null {
  if (!/^[0-9]$/.test(key)) return null;
  return key === "0" ? 10 : Number(key);
}
