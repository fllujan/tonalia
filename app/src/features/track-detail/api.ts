// Track detail data: full record, waveform file and cue edits.
import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { request } from "../../lib/rpc";
import type { Cue, CueSetParams, GridResult, GridSpec } from "../../lib/rpc.types";
import { parseWaveform } from "../../lib/waveform";
import { libraryKeys } from "../library/api";
import { useToastStore } from "../toast/toastStore";
import { errorMessage } from "../../lib/errors";

export const detailKey = (trackId: number) => ["track", trackId] as const;

export function useTrackDetail(trackId: number, enabled = true) {
  return useQuery({
    queryKey: detailKey(trackId),
    enabled,
    queryFn: () => request("library.get", { trackId }),
  });
}

export function useWaveform(path: string | null | undefined) {
  return useQuery({
    queryKey: ["waveform", path],
    enabled: !!path,
    staleTime: Infinity,
    queryFn: async () => {
      const response = await fetch(convertFileSrc(path as string));
      if (!response.ok) throw new Error(`waveform ${response.status}`);
      return parseWaveform(await response.arrayBuffer());
    },
  });
}

/** Ask the shell to expose this one file to the webview for playback. */
export function allowPlayback(path: string): Promise<void> {
  return invoke("allow_playback", { path });
}

export function useCueMutations(trackId: number) {
  const client = useQueryClient();
  const { t } = useTranslation();
  const refresh = () => {
    void client.invalidateQueries({ queryKey: detailKey(trackId) });
    void client.invalidateQueries({ queryKey: libraryKeys.all });
  };
  const onError = (err: unknown) =>
    useToastStore.getState().push({
      title: t("cues.failed", { error: errorMessage(err) }),
      tone: "danger",
    });
  return {
    set: useMutation({
      mutationFn: (params: Omit<CueSetParams, "trackId">) =>
        request("cues.set", { trackId, ...params }),
      onSuccess: refresh,
      onError,
    }),
    remove: useMutation({
      mutationFn: (cue: Cue) => request("cues.delete", { trackId, slot: cue.slot }),
      // A deleted cue can come back: the toast puts it back where it was.
      onSuccess: (_, cue) => {
        refresh();
        useToastStore.getState().push({
          title: t("cues.deleted", { n: cue.slot + 1 }),
          tone: "neutral",
          action: {
            label: t("cues.undo"),
            run: () =>
              void request("cues.set", {
                trackId,
                slot: cue.slot,
                positionSec: cue.positionSec,
                label: cue.label ?? null,
                color: cue.color ?? null,
              }).then(refresh, onError),
          },
        });
      },
      onError,
    }),
    reset: useMutation({
      mutationFn: () => request("cues.resetAuto", { trackId }),
      onSuccess: refresh,
      onError,
    }),
  };
}

/** Beatgrid editor (SPEC 12.4): every call answers with the track and the user's cues
 * that no longer sit on a beat. */
export function useGridMutations(trackId: number) {
  const client = useQueryClient();
  const { t } = useTranslation();
  const done = (result: GridResult) => {
    client.setQueryData(detailKey(trackId), result.track);
    void client.invalidateQueries({ queryKey: libraryKeys.all });
  };
  const onError = (err: unknown) =>
    useToastStore.getState().push({
      title: t("grid.failed", { error: errorMessage(err) }),
      tone: "danger",
    });
  const options = { onSuccess: done, onError };
  return {
    save: useMutation({
      mutationFn: (grid: GridSpec) => request("grid.update", { trackId, grid }),
      ...options,
    }),
    reset: useMutation({
      mutationFn: () => request("grid.reset", { trackId }),
      ...options,
    }),
    lock: useMutation({
      mutationFn: (locked: boolean) => request("grid.lock", { trackId, locked }),
      ...options,
    }),
    snapCues: useMutation({
      mutationFn: (slots: number[]) => request("grid.snapCues", { trackId, slots }),
      ...options,
    }),
  };
}
