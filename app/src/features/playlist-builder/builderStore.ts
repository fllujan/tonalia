// Set builder (SPEC 2.17): the configuration on the left and the set on the right. Any edit
// of the set (reorder, replace, remove) forgets the playlist it was saved as.
import { create } from "zustand";
import type { BuilderResult, CurvePoint, EnergyCurve } from "../../lib/rpc.types";

export type CurvePreset = NonNullable<EnergyCurve["preset"]>;
export type BuilderSource =
  { kind: "playlist"; playlistId: number } | { kind: "selection"; trackIds: number[] };

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
  result: BuilderResult | null;
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
  setResult: (result: BuilderResult | null) => void;
  setSaved: (saved: { id: number; name: string }) => void;
  reset: () => void;
}

const INITIAL = {
  source: null,
  lengthMode: "duration" as const,
  durationMin: 60,
  count: 20,
  startTrackId: null,
  preset: "warmup_peak_cooldown" as CurvePreset,
  points: [],
  allowShift: false,
  result: null,
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
  setResult: (result) => set({ result, saved: null }),
  setSaved: (saved) => set({ saved }),
  reset: () => set(INITIAL),
}));

/** The curve as the engine takes it. */
export function curveOf(preset: CurvePreset, points: CurvePoint[]): EnergyCurve {
  return preset === "custom" ? { preset, points } : { preset };
}
