// Beatgrid helpers shared by the detail view (snap cues, bar ruler).

/** Beat grid as stored by the engine (`TrackDetail.beatGrid`). */
export interface BeatGrid {
  kind: "constant" | "variable";
  bpm: number;
  first_downbeat: number;
  beats?: number[] | null;
}

export function asBeatGrid(value: unknown): BeatGrid | null {
  if (!value || typeof value !== "object") return null;
  const g = value as Partial<BeatGrid>;
  if ((g.kind !== "constant" && g.kind !== "variable") || !g.bpm || g.first_downbeat == null) {
    return null;
  }
  return g as BeatGrid;
}

/** Every beat in [0, duration). */
export function beatTimes(grid: BeatGrid, duration: number): number[] {
  if (grid.kind === "variable" && grid.beats?.length) {
    return grid.beats.filter((t) => t >= 0 && t < duration);
  }
  const period = 60 / grid.bpm;
  const first = grid.first_downbeat - period * Math.floor(grid.first_downbeat / period);
  const out: number[] = [];
  for (let t = first; t < duration; t += period) out.push(t);
  return out;
}

/** Downbeats (bar starts), from the first one at or after 0. */
export function downbeatTimes(grid: BeatGrid, duration: number): number[] {
  const beats = beatTimes(grid, duration);
  if (!beats.length) return [];
  let first = 0;
  let best = Infinity;
  beats.forEach((t, i) => {
    const d = Math.abs(t - grid.first_downbeat);
    if (d < best) [best, first] = [d, i];
  });
  return beats.filter((_, i) => i >= first % 4 && (i - first) % 4 === 0);
}

/** Nearest beat to `time` (Snap Cue); the time itself when there is no grid. */
export function snapToBeat(grid: BeatGrid | null, time: number, duration: number): number {
  if (!grid) return Math.max(0, time);
  const beats = beatTimes(grid, duration);
  let best = time;
  let distance = Infinity;
  for (const t of beats) {
    const d = Math.abs(t - time);
    if (d < distance) [distance, best] = [d, t];
  }
  return best;
}

/** Nearest downbeat (bar start) to `time`; the time itself when there is no grid. */
export function snapToDownbeat(grid: BeatGrid | null, time: number, duration: number): number {
  if (!grid) return Math.max(0, time);
  let best = Math.max(0, time);
  let distance = Infinity;
  for (const t of downbeatTimes(grid, duration)) {
    const d = Math.abs(t - time);
    if (d < distance) [distance, best] = [d, t];
  }
  return best;
}

/** Seconds per 4/4 bar. */
export function barSeconds(bpm: number): number {
  return 240 / bpm;
}
