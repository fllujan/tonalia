// Mashup favorites RPC (SPEC 2.15): list, save, rate/annotate and remove. Keyed under the
// library so removing a track (which removes its favorites) refreshes them.
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { request } from "../../lib/rpc";
import type { Favorite, FavoriteSaveParams, FavoriteUpdateParams } from "../../lib/rpc.types";
import { libraryKeys } from "../library/api";

export type FavoriteSort = "date" | "rating";

export const favoritesKeys = {
  all: [...libraryKeys.all, "favorites"] as const,
  list: (sort: FavoriteSort) => [...favoritesKeys.all, sort] as const,
};

export function useFavorites(sort: FavoriteSort = "date") {
  return useQuery({
    queryKey: favoritesKeys.list(sort),
    placeholderData: keepPreviousData,
    queryFn: async () => (await request("favorites.list", { sort })).items,
  });
}

/** What identifies a combination (saving it again updates the same favorite). */
export function sameCombination(f: Favorite, p: FavoriteSaveParams): boolean {
  return (
    f.trackA === p.trackA &&
    f.trackB === p.trackB &&
    f.mode === p.mode &&
    (f.shiftA ?? 0) === (p.shiftA ?? 0) &&
    (f.shiftB ?? 0) === (p.shiftB ?? 0) &&
    (f.stemA ?? "mix") === (p.stemA ?? "mix") &&
    (f.stemB ?? "mix") === (p.stemB ?? "mix")
  );
}

/** The fields to save the favorite again (undo of a removal). */
export function saveParamsOf(f: Favorite): FavoriteSaveParams {
  return {
    trackA: f.trackA,
    trackB: f.trackB,
    mode: f.mode,
    shiftA: f.shiftA ?? 0,
    shiftB: f.shiftB ?? 0,
    cueA: f.cueA ?? null,
    cueB: f.cueB ?? null,
    stemA: f.stemA ?? "mix",
    stemB: f.stemB ?? "mix",
    bpmFactor: f.bpmFactor ?? 1,
    rating: f.rating,
    notes: f.notes,
  };
}

export function useFavoriteActions() {
  const qc = useQueryClient();
  const refresh = useCallback(
    () => void qc.invalidateQueries({ queryKey: favoritesKeys.all }),
    [qc],
  );
  return {
    save: useCallback(
      async (p: FavoriteSaveParams) => {
        const saved = await request("favorites.save", p);
        refresh();
        return saved;
      },
      [refresh],
    ),
    update: useCallback(
      async (p: FavoriteUpdateParams) => {
        const updated = await request("favorites.update", p);
        refresh();
        return updated;
      },
      [refresh],
    ),
    remove: useCallback(
      async (favoriteId: number) => {
        const result = await request("favorites.delete", { favoriteId });
        refresh();
        return result.deleted;
      },
      [refresh],
    ),
  };
}
