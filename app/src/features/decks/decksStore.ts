// Pro mode (SPEC 2.15, DESIGN 6.9 and 6.10): the track on deck A, the mode and the idea
// filter. Deck B always shows one of the ideas for A; `idea` is its position in the list.
import { create } from "zustand";
import type { SuggestFilters } from "../../lib/rpc.types";
import type { Side } from "./Deck";
import type { CrossfadeBars } from "./segments";

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
  /** Where each deck plays from (original seconds); null = its first downbeat. */
  anchors: Record<Side, number | null>;
  /** Length of the automatic crossfade of "Try mix". */
  crossfadeBars: CrossfadeBars;
  /** Key change per deck: A's semitones; for B, the user's change on top of the idea's. */
  shifts: Record<Side, number>;
  setMode: (mode: ProMode) => void;
  loadA: (trackId: number) => void;
  setIdea: (idea: number) => void;
  setFilters: (filters: SuggestFilters) => void;
  setAllowShift: (allowShift: boolean) => void;
  setEnergyDirection: (energyDirection: EnergyDirection) => void;
  toggleFilters: () => void;
  setAnchor: (side: Side, time: number | null) => void;
  setCrossfadeBars: (bars: CrossfadeBars) => void;
  /** A new key for A asks for new ideas (back to the best one). */
  setShift: (side: Side, semitones: number) => void;
}

const NO_ANCHORS = { a: null, b: null };
const NO_SHIFTS = { a: 0, b: 0 };

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

/** Deck B gets another idea: back to the first, from its first downbeat, unshifted. */
function newIdea(s: DecksState) {
  return { idea: 0, anchors: { ...s.anchors, b: null }, shifts: { ...s.shifts, b: 0 } };
}

export const useDecksStore = create<DecksState>((set) => ({
  mode: "mashup",
  trackA: null,
  idea: 0,
  filters: EMPTY_FILTERS,
  allowShift: true,
  energyDirection: "up",
  filtersOpen: false,
  anchors: NO_ANCHORS,
  crossfadeBars: 16,
  shifts: NO_SHIFTS,
  setMode: (mode) => set((s) => ({ mode, ...newIdea(s) })),
  loadA: (trackA) => set({ trackA, idea: 0, anchors: NO_ANCHORS, shifts: NO_SHIFTS }),
  setIdea: (idea) => set((s) => ({ ...newIdea(s), idea })),
  setFilters: (filters) => set((s) => ({ filters, ...newIdea(s) })),
  setAllowShift: (allowShift) => set((s) => ({ allowShift, ...newIdea(s) })),
  setEnergyDirection: (energyDirection) => set((s) => ({ energyDirection, ...newIdea(s) })),
  setShift: (side, semitones) =>
    set((s) =>
      side === "a"
        ? { ...newIdea(s), shifts: { a: semitones, b: 0 } }
        : { shifts: { ...s.shifts, b: semitones } },
    ),
  setAnchor: (side, time) => set((s) => ({ anchors: { ...s.anchors, [side]: time } })),
  setCrossfadeBars: (crossfadeBars) => set({ crossfadeBars }),
  toggleFilters: () => set((s) => ({ filtersOpen: !s.filtersOpen })),
}));
