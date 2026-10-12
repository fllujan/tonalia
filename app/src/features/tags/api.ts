// Tag writing (SPEC 2.9): preview, write batch, undo batch.
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { request } from "../../lib/rpc";
import type { CleanRules, EditParams, TagOptions } from "../../lib/rpc.types";
import { useTagJobStore } from "./tagJobStore";

/** Tracks shown in the before -> after preview (the write covers all of them). */
export const PREVIEW_LIMIT = 100;

function isNonEmpty<T>(items: T[]): items is [T, ...T[]] {
  return items.length > 0;
}

export function useTagPreview(trackIds: number[], options: TagOptions) {
  const ids = trackIds.slice(0, PREVIEW_LIMIT);
  return useQuery({
    queryKey: ["tags", "preview", ids, options],
    enabled: ids.length > 0,
    placeholderData: keepPreviousData,
    queryFn: () =>
      isNonEmpty(ids) ? request("tags.preview", { trackIds: ids, options }) : { items: [] },
  });
}

export async function startTagWrite(trackIds: number[], options: TagOptions): Promise<void> {
  if (!isNonEmpty(trackIds)) return;
  const { jobId } = await request("tags.write", { trackIds, options });
  useTagJobStore.getState().start(jobId, "write");
}

/** Every batch that changed files, newest first (SPEC 2.9: undo stays available). */
export function useTagHistory() {
  return useQuery({
    queryKey: ["tags", "history"],
    queryFn: () => request("tags.history", {}),
  });
}

export async function startTagUndo(batchId: string): Promise<void> {
  const { jobId } = await request("tags.undo", { batchId });
  useTagJobStore.getState().start(jobId, "undo");
}

export function useCleanPreview(trackIds: number[], rules: CleanRules) {
  const ids = trackIds.slice(0, PREVIEW_LIMIT);
  return useQuery({
    queryKey: ["tags", "clean", ids, rules],
    enabled: ids.length > 0,
    placeholderData: keepPreviousData,
    queryFn: () =>
      isNonEmpty(ids) ? request("tags.cleanPreview", { trackIds: ids, rules }) : { items: [] },
  });
}

export function useEditPreview(trackIds: number[], values: EditParams["values"]) {
  const ids = trackIds.slice(0, PREVIEW_LIMIT);
  return useQuery({
    queryKey: ["tags", "edit", ids, values],
    enabled: ids.length > 0 && Object.keys(values).length > 0,
    placeholderData: keepPreviousData,
    queryFn: () =>
      isNonEmpty(ids) ? request("tags.editPreview", { trackIds: ids, values }) : { items: [] },
  });
}

export async function startClean(trackIds: number[], rules: CleanRules): Promise<void> {
  if (!isNonEmpty(trackIds)) return;
  const { jobId } = await request("tags.clean", { trackIds, rules });
  useTagJobStore.getState().start(jobId, "write");
}

export async function startEdit(trackIds: number[], values: EditParams["values"]): Promise<void> {
  if (!isNonEmpty(trackIds)) return;
  const { jobId } = await request("tags.edit", { trackIds, values });
  useTagJobStore.getState().start(jobId, "write");
}
