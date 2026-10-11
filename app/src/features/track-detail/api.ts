// Track detail data: full record, waveform file and cue edits.
import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { request } from "../../lib/rpc";
import type { CueSetParams } from "../../lib/rpc.types";
import { parseWaveform } from "../../lib/waveform";
import { libraryKeys } from "../library/api";
import { useToastStore } from "../toast/toastStore";

export const detailKey = (trackId: number) => ["track", trackId] as const;

export function useTrackDetail(trackId: number) {
  return useQuery({
    queryKey: detailKey(trackId),
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
      title: t("cues.failed", { error: err instanceof Error ? err.message : String(err) }),
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
      mutationFn: (slot: number) => request("cues.delete", { trackId, slot }),
      onSuccess: refresh,
      onError,
    }),
    reset: useMutation({
      mutationFn: () => request("cues.resetAuto", { trackId }),
      onSuccess: refresh,
      onError,
    }),
  };
}
