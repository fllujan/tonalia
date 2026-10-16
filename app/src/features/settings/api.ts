// Engine-persisted preferences (settings.get / settings.set).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { request } from "../../lib/rpc";
import type { Settings, SettingsUpdate, TagOptions } from "../../lib/rpc.types";
import { useToastStore } from "../toast/toastStore";
import { errorMessage } from "../../lib/errors";
import { CUE_PALETTE } from "../../lib/sections";

export type AppSettings = Required<Settings>;

export const DEFAULT_TAG_OPTIONS: Required<TagOptions> = {
  writeKey: true,
  writeBpm: true,
  writeComment: true,
  commentTemplate: "{key} - Energy {energy}",
  commentPosition: "before",
  energyInGrouping: false,
  energyInRating: false,
  writeReplaygain: false,
  notation: null,
  bpmDecimals: null,
};

export const DEFAULT_SETTINGS: AppSettings = {
  notation: "alphanumeric",
  bpmDecimals: 2,
  cueCount: 8,
  bpmRange: [70, 180],
  analysisWorkers: 0,
  cueColors: [...CUE_PALETTE] as AppSettings["cueColors"],
  tagOptions: DEFAULT_TAG_OPTIONS,
  watchedFolders: [],
  stemModel: "htdemucs",
  stemDevice: "auto",
  dawFolder: "",
  stemExportFormat: "wav",
  stemExportTemplate: "{artist} - {title} ({stem}) [{key} {bpm}]",
  checkUpdates: true,
  importPolicy: {
    cues: "fill",
    grid: "fill",
    key: "fill",
    bpm: "fill",
    rating: "fill",
    playCount: "fill",
    comment: "fill",
  },
  historyAvoidDays: 0,
};

export const settingsKey = ["settings"] as const;

/** The settings as stored by the engine (undefined until they arrive). */
export function useStoredSettings() {
  return useQuery({ queryKey: settingsKey, queryFn: () => request("settings.get") });
}

export function useSettings(): AppSettings {
  return { ...DEFAULT_SETTINGS, ...useStoredSettings().data };
}

export function useUpdateSettings(errorTitle: (message: string) => string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (update: SettingsUpdate) => request("settings.set", update),
    onMutate: (update) => {
      // Optimistic: the table re-renders in the new notation immediately.
      const previous = client.getQueryData<Settings>(settingsKey);
      const changes = Object.fromEntries(
        Object.entries(update).filter(([, value]) => value != null),
      ) as Settings;
      client.setQueryData<Settings>(settingsKey, { ...DEFAULT_SETTINGS, ...previous, ...changes });
      return { previous };
    },
    onError: (err, _update, context) => {
      client.setQueryData(settingsKey, context?.previous);
      useToastStore.getState().push({
        title: errorTitle(errorMessage(err)),
        tone: "danger",
      });
    },
    onSuccess: (saved) => client.setQueryData(settingsKey, saved),
  });
}
