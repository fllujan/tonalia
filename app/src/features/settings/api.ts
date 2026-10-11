// Engine-persisted preferences (settings.get / settings.set).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { request } from "../../lib/rpc";
import type { Settings, SettingsUpdate, TagOptions } from "../../lib/rpc.types";
import { useToastStore } from "../toast/toastStore";

export type AppSettings = Required<Settings>;

export const DEFAULT_TAG_OPTIONS: Required<TagOptions> = {
  writeKey: true,
  writeBpm: true,
  writeComment: true,
  commentTemplate: "{key} - Energy {energy}",
  commentPosition: "before",
  energyInGrouping: false,
  energyInRating: false,
  notation: null,
  bpmDecimals: null,
};

export const DEFAULT_SETTINGS: AppSettings = {
  notation: "alphanumeric",
  bpmDecimals: 2,
  cueCount: 8,
  tagOptions: DEFAULT_TAG_OPTIONS,
};

export const settingsKey = ["settings"] as const;

export function useSettings(): AppSettings {
  const query = useQuery({ queryKey: settingsKey, queryFn: () => request("settings.get") });
  return { ...DEFAULT_SETTINGS, ...query.data };
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
        title: errorTitle(err instanceof Error ? err.message : String(err)),
        tone: "danger",
      });
    },
    onSuccess: (saved) => client.setQueryData(settingsKey, saved),
  });
}
