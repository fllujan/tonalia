// Pro mode (SPEC 2.15, DESIGN 6.9 and 6.10): the track on deck A, the mode and the idea
// filter. Deck B always shows one of the ideas for A; `idea` is its position in the list.
import { create } from "zustand";
import type { SuggestFilters } from "../../lib/rpc.types";

export type ProMode = "mashup" | "mix";
export type EnergyDirection = "keep" | "up" | "down";

interface DecksState {
  mode: ProMode;
  trackA: number | null;
  /** Position of deck B's idea in the current list. */
  idea: number;
  filters: SuggestFilters;
  /** Try shifting B by up to ±2 semitones. */
  allowShift: boolean;
  /** DJ Mix only: keep, raise or lower the energy. */
  energyDirection: EnergyDirection;
  filtersOpen: boolean;
  setMode: (mode: ProMode) => void;
  loadA: (trackId: number) => void;
  setIdea: (idea: number) => void;
  setFilters: (filters: SuggestFilters) => void;
  setAllowShift: (allowShift: boolean) => void;
  setEnergyDirection: (energyDirection: EnergyDirection) => void;
  toggleFilters: () => void;
}

export const EMPTY_FILTERS: SuggestFilters = {};

/** Number of conditions set in the idea filter (shown on its button). */
export function activeFilters(f: SuggestFilters): number {
  return (
    (f.energyMin != null || f.energyMax != null ? 1 : 0) +
    (f.bpmMin != null || f.bpmMax != null ? 1 : 0) +
    (f.playlistIds?.length ? 1 : 0) +
    (f.genres?.length ? 1 : 0)
  );
}

export const useDecksStore = create<DecksState>((set) => ({
  mode: "mashup",
  trackA: null,
  idea: 0,
  filters: EMPTY_FILTERS,
  allowShift: true,
  energyDirection: "up",
  filtersOpen: false,
  setMode: (mode) => set({ mode, idea: 0 }),
  loadA: (trackA) => set({ trackA, idea: 0 }),
  setIdea: (idea) => set({ idea }),
  setFilters: (filters) => set({ filters, idea: 0 }),
  setAllowShift: (allowShift) => set({ allowShift, idea: 0 }),
  setEnergyDirection: (energyDirection) => set({ energyDirection, idea: 0 }),
  toggleFilters: () => set((s) => ({ filtersOpen: !s.filtersOpen })),
}));
