// Playlists and folders (SPEC 2.11). The tree lives under the library query key, so
// anything that refreshes the library (imports, analysis, tag writes) also refreshes
// track counts, including the live counts of smart playlists.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { request } from "../../lib/rpc";
import type {
  M3UExportParams,
  M3UImportParams,
  PlaylistCreateParams,
  PlaylistIdParams,
  PlaylistMoveParams,
  PlaylistNode,
  PlaylistTracksParams,
  PlaylistUpdateParams,
} from "../../lib/rpc.types";
import { libraryKeys } from "../library/api";
import { useToastStore } from "../toast/toastStore";

export const playlistKeys = { tree: [...libraryKeys.all, "playlists"] as const };

export function usePlaylistTree(): PlaylistNode[] {
  const query = useQuery({
    queryKey: playlistKeys.tree,
    queryFn: () => request("playlists.tree"),
  });
  return query.data?.playlists ?? [];
}

export function usePlaylist(id: number | null): PlaylistNode | undefined {
  const tree = usePlaylistTree();
  return id == null ? undefined : tree.find((p) => p.id === id);
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** A playlist change as a mutation: refreshes the library and reports failures in a toast. */
export function usePlaylistMutation<P, R>(run: (params: P) => Promise<R>) {
  const client = useQueryClient();
  const { t } = useTranslation();
  return useMutation({
    mutationFn: run,
    onSuccess: () => void client.invalidateQueries({ queryKey: libraryKeys.all }),
    onError: (err) =>
      useToastStore.getState().push({
        title: t("playlists.failed", { error: errorText(err) }),
        tone: "danger",
      }),
  });
}

export const playlistApi = {
  create: (p: PlaylistCreateParams) => request("playlists.create", p),
  update: (p: PlaylistUpdateParams) => request("playlists.update", p),
  move: (p: PlaylistMoveParams) => request("playlists.move", p),
  remove: (p: PlaylistIdParams) => request("playlists.delete", p),
  addTracks: (p: PlaylistTracksParams) => request("playlists.addTracks", p),
  removeTracks: (p: PlaylistTracksParams) => request("playlists.removeTracks", p),
  reorderTracks: (p: PlaylistTracksParams) => request("playlists.reorderTracks", p),
  importM3u: (p: M3UImportParams) => request("playlists.importM3u", p),
  exportM3u: (p: M3UExportParams) => request("playlists.exportM3u", p),
};
