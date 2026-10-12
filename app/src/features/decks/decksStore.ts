// Pro mode (SPEC 2.15, DESIGN 6.9 and 6.10): the track on deck A, the mode and the idea
// filter. Deck B always shows one of the ideas for A; `idea` is its position in the list.
import { create } from "zustand";
import type { Favorite, SuggestFilters } from "../../lib/rpc.types";
import type { Side } from "./Deck";
import type { CrossfadeBars, LoopLength, LoopRegion } from "./segments";

export type ProMode = "mashup" | "mix";
/** What a deck plays (DESIGN 6.9): the full track, the vocals or the instrumental. */
export type DeckStem = "mix" | "vocals" | "instrumental";
export const DECK_STEMS: readonly DeckStem[] = ["mix", "vocals", "instrumental"];
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
  /** Stem of each deck. B keeps its stem across ideas ("acapella in A, instrumentals in B"). */
  stems: Record<Side, DeckStem>;
  /** Loop of each deck (null = none). B keeps a bar loop across ideas, not a free one. */
  loops: Record<Side, LoopLength | null>;
  /** Edges of the free loops (original seconds of the deck's track). */
  freeLoops: Record<Side, LoopRegion | null>;
  /** Deck B opened from a favorite instead of an idea (the arrows go back to the ideas). */
  pinnedB: PinnedB | null;
  /** Tracks already moved out of deck A ("Move B → A"): never suggested again. */
  history: number[];
  /** Track deck B shows now (kept by the view), so a new key for A can stay on it. */
  shownB: number | null;
  /** After a new key for A: the track to find again in the new ideas. */
  keepB: number | null;
  setShownB: (trackId: number | null) => void;
  /** The new ideas are in: show `idea`, which is where `keepB` landed (or the best). */
  settleIdea: (idea: number) => void;
  setMode: (mode: ProMode) => void;
  loadA: (trackId: number) => void;
  setIdea: (idea: number) => void;
  setFilters: (filters: SuggestFilters) => void;
  setAllowShift: (allowShift: boolean) => void;
  /** Back to every idea: no filters and the key change allowed. */
  clearFilters: () => void;
  setEnergyDirection: (energyDirection: EnergyDirection) => void;
  toggleFilters: () => void;
  setAnchor: (side: Side, time: number | null) => void;
  setCrossfadeBars: (bars: CrossfadeBars) => void;
  /** A new key for A asks for new ideas, staying on B's track if it is still among them. */
  setShift: (side: Side, semitones: number) => void;
  setStem: (side: Side, stem: DeckStem) => void;
  /** A free loop needs its first edges. */
  setLoop: (side: Side, loop: LoopLength | null, free?: LoopRegion) => void;
  setFreeLoop: (side: Side, region: LoopRegion) => void;
  /** Both decks as the favorite was saved. */
  openFavorite: (favorite: Favorite) => void;
  /** DJ Mix "Move B → A": B becomes the current track (with its key change and stem). */
  moveBToA: (trackId: number, semitones: number, stem: DeckStem) => void;
}

export interface PinnedB {
  trackId: number;
  /** Semitones of B in the favorite (the user's change goes on top, like an idea's). */
  shiftB: number;
  bpmFactor: number;
}

const NO_ANCHORS = { a: null, b: null };
const NO_SHIFTS = { a: 0, b: 0 };
const NO_LOOPS = { a: null, b: null };

export const EMPTY_FILTERS: SuggestFilters = {};

/** Number of conditions set in the idea filter (shown on its button). */
/** Conditions narrowing the ideas; a key change switched off is one of them. */
export function activeFilters(f: SuggestFilters, allowShift = true): number {
  return (
    (allowShift ? 0 : 1) +
    (f.energyMin != null || f.energyMax != null ? 1 : 0) +
    (f.bpmMin != null || f.bpmMax != null ? 1 : 0) +
    (f.playlistIds?.length ? 1 : 0) +
    (f.genres?.length ? 1 : 0)
  );
}

/** Deck B gets another idea: back to the first, from its first downbeat, unshifted. */
function newIdea(s: DecksState) {
  return {
    idea: 0,
    anchors: { ...s.anchors, b: null },
    shifts: { ...s.shifts, b: 0 },
    loops: { ...s.loops, b: s.loops.b === "free" ? null : s.loops.b },
    freeLoops: { ...s.freeLoops, b: null },
    pinnedB: null,
  };
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
  stems: { a: "mix", b: "mix" },
  loops: NO_LOOPS,
  freeLoops: NO_LOOPS,
  pinnedB: null,
  history: [],
  shownB: null,
  keepB: null,
  setShownB: (shownB) => set({ shownB }),
  settleIdea: (idea) => set({ idea, keepB: null }),
  // A mode is a fresh set-up: the stems, loops and start points of a mashup (A on its
  // vocals, a 4-bar loop) make no sense at the start of a mix, and vice versa.
  setMode: (mode) =>
    set((s) => ({
      mode,
      ...newIdea(s),
      anchors: NO_ANCHORS,
      stems: { a: "mix", b: "mix" },
      loops: NO_LOOPS,
      freeLoops: NO_LOOPS,
    })),
  loadA: (trackA) =>
    set((s) => ({
      ...newIdea(s),
      trackA,
      anchors: NO_ANCHORS,
      shifts: NO_SHIFTS,
      stems: { ...s.stems, a: "mix" },
      loops: { ...newIdea(s).loops, a: null },
      freeLoops: NO_LOOPS,
      history: [],
    })),
  setIdea: (idea) => set((s) => ({ ...newIdea(s), idea })),
  setFilters: (filters) => set((s) => ({ filters, ...newIdea(s) })),
  setAllowShift: (allowShift) => set((s) => ({ allowShift, ...newIdea(s) })),
  clearFilters: () => set((s) => ({ filters: EMPTY_FILTERS, allowShift: true, ...newIdea(s) })),
  setEnergyDirection: (energyDirection) => set((s) => ({ energyDirection, ...newIdea(s) })),
  setShift: (side, semitones) =>
    set((s) =>
      side === "a"
        ? {
            ...newIdea(s),
            shifts: { a: semitones, b: 0 },
            // Until the new ideas land, the old list stays on screen at the same place.
            ...(s.pinnedB || s.shownB == null ? {} : { idea: s.idea, keepB: s.shownB }),
          }
        : { shifts: { ...s.shifts, b: semitones } },
    ),
  setStem: (side, stem) => set((s) => ({ stems: { ...s.stems, [side]: stem } })),
  setLoop: (side, loop, free) =>
    set((s) => ({
      loops: { ...s.loops, [side]: loop },
      freeLoops: { ...s.freeLoops, [side]: loop === "free" ? (free ?? null) : null },
    })),
  setFreeLoop: (side, region) => set((s) => ({ freeLoops: { ...s.freeLoops, [side]: region } })),
  moveBToA: (trackId, semitones, stem) =>
    set((s) => ({
      trackA: trackId,
      history: s.trackA == null ? s.history : [...s.history, s.trackA],
      idea: 0,
      anchors: NO_ANCHORS,
      shifts: { a: semitones, b: 0 },
      stems: { ...s.stems, a: stem },
      loops: NO_LOOPS,
      freeLoops: NO_LOOPS,
      pinnedB: null,
    })),
  openFavorite: (f) =>
    set({
      mode: f.mode,
      trackA: f.trackA,
      idea: 0,
      anchors: { a: f.cueA ?? null, b: f.cueB ?? null },
      shifts: { a: f.shiftA ?? 0, b: 0 },
      stems: { a: f.stemA ?? "mix", b: f.stemB ?? "mix" },
      loops: NO_LOOPS,
      freeLoops: NO_LOOPS,
      pinnedB: { trackId: f.trackB, shiftB: f.shiftB ?? 0, bpmFactor: f.bpmFactor ?? 1 },
      history: [],
    }),
  setAnchor: (side, time) => set((s) => ({ anchors: { ...s.anchors, [side]: time } })),
  setCrossfadeBars: (crossfadeBars) => set({ crossfadeBars }),
  toggleFilters: () => set((s) => ({ filtersOpen: !s.filtersOpen })),
}));
