// Set builder (SPEC 2.17): the configuration on the left and the set on the right. Any edit
// of the set (reorder, replace, remove) forgets the playlist it was saved as.
import { create } from "zustand";
import type { BuilderResult, CurvePoint, EnergyCurve } from "../../lib/rpc.types";
import type { Requested } from "./shortfall";

export type CurvePreset = NonNullable<EnergyCurve["preset"]>;
export type BuilderSource =
  | { kind: "playlist"; playlistId: number }
  | { kind: "selection"; trackIds: number[] }
  | { kind: "library" };

interface BuilderState {
  source: BuilderSource | null;
  lengthMode: "duration" | "count";
  durationMin: number;
  count: number;
  startTrackId: number | null;
  preset: CurvePreset;
  /** Points of a drawn curve (preset "custom"). */
  points: CurvePoint[];
  allowShift: boolean;
  /** A set is being generated (from the settings or from the clash notice). */
  generating: boolean;
  result: BuilderResult | null;
  /** The length the set was generated for (edits of the set keep it). */
  requested: Requested | null;
  /** The playlist this exact set was saved as. */
  saved: { id: number; name: string } | null;
  setSource: (source: BuilderSource | null) => void;
  setLengthMode: (mode: "duration" | "count") => void;
  setDuration: (minutes: number) => void;
  setCount: (count: number) => void;
  setStart: (trackId: number | null) => void;
  setPreset: (preset: Exclude<CurvePreset, "custom">) => void;
  setPoints: (points: CurvePoint[]) => void;
  setAllowShift: (allowShift: boolean) => void;
  setResult: (result: BuilderResult | null, requested?: Requested) => void;
  setSaved: (saved: { id: number; name: string }) => void;
  reset: () => void;
}

const INITIAL = {
  // The whole library until the DJ picks a playlist or a selection: one step less, and
  // "Generate set" is never disabled on arrival.
  source: { kind: "library" } as BuilderSource | null,
  lengthMode: "duration" as const,
  durationMin: 60,
  count: 20,
  startTrackId: null,
  preset: "warmup_peak_cooldown" as CurvePreset,
  points: [],
  // As in Pro's idea filter: ±2 semitones are allowed unless the DJ turns them off.
  allowShift: true,
  generating: false,
  result: null,
  requested: null,
  saved: null,
};

export const useBuilderStore = create<BuilderState>((set) => ({
  ...INITIAL,
  setSource: (source) => set({ source, startTrackId: null }),
  setLengthMode: (lengthMode) => set({ lengthMode }),
  setDuration: (durationMin) => set({ durationMin }),
  setCount: (count) => set({ count }),
  setStart: (startTrackId) => set({ startTrackId }),
  setPreset: (preset) => set({ preset, points: [] }),
  setPoints: (points) => set({ preset: "custom", points }),
  setAllowShift: (allowShift) => set({ allowShift }),
  setResult: (result, requested) =>
    set((s) => ({ result, saved: null, requested: requested ?? (result ? s.requested : null) })),
  setSaved: (saved) => set({ saved }),
  reset: () => set(INITIAL),
}));

/** The curve as the engine takes it. */
export function curveOf(preset: CurvePreset, points: CurvePoint[]): EnergyCurve {
  return preset === "custom" ? { preset, points } : { preset };
}
