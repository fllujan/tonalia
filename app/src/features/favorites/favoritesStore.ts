// The favorite combination being exported and the one playing from its card.
import { create } from "zustand";
import type { FavoriteSaveParams } from "../../lib/rpc.types";

/** A combination to export: the favorite's fields plus A's tempo (B is matched to it). */
export type ExportCombination = Pick<
  FavoriteSaveParams,
  "trackA" | "trackB" | "shiftA" | "shiftB" | "stemA" | "stemB" | "bpmFactor"
> & { bpmA: number | null };

interface FavoritesState {
  exporting: ExportCombination | null;
  playing: number | null;
  openExport: (combination: ExportCombination) => void;
  closeExport: () => void;
  setPlaying: (favoriteId: number | null) => void;
}

export const useFavoritesStore = create<FavoritesState>((set) => ({
  exporting: null,
  playing: null,
  openExport: (exporting) => set({ exporting }),
  closeExport: () => set({ exporting: null }),
  setPlaying: (playing) => set({ playing }),
}));
