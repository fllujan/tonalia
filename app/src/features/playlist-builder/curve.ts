// Energy curve templates (mirror of engine/tonalia_engine/playlist_builder.py PRESETS) and
// helpers for the curve editor. "Flat" sits at the pool's median energy in the engine; the
// editor draws it at FLAT_PREVIEW until a point is moved.
import type { CurvePoint } from "../../lib/rpc.types";
import type { CurvePreset } from "./builderStore";

export const FLAT_PREVIEW = 6;

export const TEMPLATES: Record<Exclude<CurvePreset, "custom">, CurvePoint[]> = {
  warmup_peak_cooldown: [
    { x: 0, energy: 4 },
    { x: 0.6, energy: 9 },
    { x: 0.85, energy: 9 },
    { x: 1, energy: 6 },
  ],
  flat: [
    { x: 0, energy: FLAT_PREVIEW },
    { x: 1, energy: FLAT_PREVIEW },
  ],
  ascending: [
    { x: 0, energy: 4 },
    { x: 1, energy: 9 },
  ],
};

export function pointsOf(preset: CurvePreset, points: CurvePoint[]): CurvePoint[] {
  return preset === "custom" ? points : TEMPLATES[preset];
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round = (v: number, step: number) => Math.round(v / step) * step;

/** Move point `i`: energy 1–10 (steps of 0.5); x stays between its neighbours (0 and 1 pinned at the ends). */
export function movePoint(
  points: CurvePoint[],
  i: number,
  x: number,
  energy: number,
): CurvePoint[] {
  const sorted = [...points].sort((a, b) => a.x - b.x);
  const prev = sorted[i - 1];
  const next = sorted[i + 1];
  const nx =
    i === 0
      ? 0
      : i === sorted.length - 1
        ? 1
        : clamp(round(x, 0.01), (prev?.x ?? 0) + 0.01, (next?.x ?? 1) - 0.01);
  return sorted.map((p, k) =>
    k === i ? { x: Math.round(nx * 100) / 100, energy: clamp(round(energy, 0.5), 1, 10) } : p,
  );
}

/** Add a point at `x` on the line (or at `energy` when given). */
export function addPoint(points: CurvePoint[], x: number, energy: number): CurvePoint[] {
  const at = Math.round(clamp(x, 0.01, 0.99) * 100) / 100;
  if (points.some((p) => Math.abs(p.x - at) < 0.02)) return points;
  return [...points, { x: at, energy: clamp(round(energy, 0.5), 1, 10) }].sort((a, b) => a.x - b.x);
}

/** Remove an inner point (the ends stay). */
export function removePoint(points: CurvePoint[], i: number): CurvePoint[] {
  const sorted = [...points].sort((a, b) => a.x - b.x);
  if (i === 0 || i === sorted.length - 1 || sorted.length <= 2) return sorted;
  return sorted.filter((_, k) => k !== i);
}
