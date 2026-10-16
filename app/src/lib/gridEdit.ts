// Beatgrid editor maths (SPEC 12.4). A grid is a tempo and a first downbeat (beat 0) plus,
// for a tempo that changes, anchors that pin where a beat is heard; between pins the
// beats are spread evenly. The engine builds the stored grid the same way
// (engine/tonalia_engine/grid.py), so what the editor draws is what gets saved.
import type { BeatGrid } from "./beats";
import type { GridSpec } from "./rpc.types";

export interface GridAnchor {
  beat: number;
  time: number;
}

export interface EditorGrid {
  bpm: number;
  firstDownbeat: number;
  anchors: GridAnchor[];
}

export const MIN_BPM = 40;
export const MAX_BPM = 300;
const BEATS_PER_BAR = 4;
// An analysed variable grid opens with an anchor every 16 bars.
const ANALYSED_ANCHOR_BEATS = 64;

type Pin = [beat: number, time: number];

function pins(g: EditorGrid): Pin[] {
  return [[0, g.firstDownbeat], ...g.anchors.map((a): Pin => [a.beat, a.time])];
}

/** When beat `n` (counted from the first downbeat) is heard. */
export function timeOfBeat(g: EditorGrid, n: number): number {
  const p = pins(g);
  if (p.length < 2) return g.firstDownbeat + (n * 60) / g.bpm;
  const slope = (a: Pin, b: Pin) => (b[1] - a[1]) / (b[0] - a[0]);
  const first = p[0] as Pin;
  const last = p[p.length - 1] as Pin;
  if (n <= first[0]) return first[1] + (n - first[0]) * slope(first, p[1] as Pin);
  if (n >= last[0]) return last[1] + (n - last[0]) * slope(p[p.length - 2] as Pin, last);
  for (let i = 1; i < p.length; i++) {
    const a = p[i - 1] as Pin;
    const b = p[i] as Pin;
    if (n <= b[0]) return a[1] + (n - a[0]) * slope(a, b);
  }
  return last[1];
}

/** The beat number nearest to `time`. */
export function beatAt(g: EditorGrid, time: number): number {
  let lo = -1e6;
  let hi = 1e6;
  // timeOfBeat grows with n: bisect, then pick the closer neighbour.
  for (let i = 0; i < 60 && hi - lo > 1; i++) {
    const mid = Math.floor((lo + hi) / 2);
    if (timeOfBeat(g, mid) <= time) lo = mid;
    else hi = mid;
  }
  return time - timeOfBeat(g, lo) <= timeOfBeat(g, hi) - time ? lo : hi;
}

/** The grid to draw (same shape as the stored one). */
export function toBeatGrid(g: EditorGrid, duration: number): BeatGrid {
  if (!g.anchors.length) {
    return { kind: "constant", bpm: g.bpm, first_downbeat: g.firstDownbeat };
  }
  const beats: number[] = [];
  let firstDownbeat: number | null = null;
  for (let n = beatAt(g, 0) - 1; ; n++) {
    const t = timeOfBeat(g, n);
    if (t >= duration) break;
    if (t < -1e-9) continue;
    beats.push(Math.max(0, t));
    if (firstDownbeat === null && ((n % BEATS_PER_BAR) + BEATS_PER_BAR) % BEATS_PER_BAR === 0)
      firstDownbeat = Math.max(0, t);
  }
  const gaps = beats.slice(1).map((t, i) => t - (beats[i] ?? 0));
  const sorted = [...gaps].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 60 / g.bpm;
  return {
    kind: "variable",
    bpm: 60 / median,
    first_downbeat: firstDownbeat ?? g.firstDownbeat,
    beats,
    anchors: pins(g),
  };
}

export function toSpec(g: EditorGrid): GridSpec {
  return { bpm: g.bpm, firstDownbeat: g.firstDownbeat, anchors: g.anchors };
}

/** The editor's starting point for a stored grid. */
export function editorFromStored(grid: BeatGrid | null): EditorGrid | null {
  if (!grid) return null;
  const stored = grid.anchors;
  if (stored?.length) {
    const [first, ...rest] = stored;
    return {
      bpm: grid.bpm,
      firstDownbeat: first?.[1] ?? grid.first_downbeat,
      anchors: rest.map(([beat, time]) => ({ beat: beat ?? 0, time: time ?? 0 })),
    };
  }
  if (grid.kind === "variable" && grid.beats && grid.beats.length > 1) {
    const beats = grid.beats;
    let zero = 0;
    beats.forEach((t, i) => {
      if (Math.abs(t - grid.first_downbeat) < Math.abs((beats[zero] ?? 0) - grid.first_downbeat))
        zero = i;
    });
    const anchors: GridAnchor[] = [];
    const lastBeat = beats.length - 1 - zero;
    for (let k = ANALYSED_ANCHOR_BEATS; k <= lastBeat; k += ANALYSED_ANCHOR_BEATS)
      anchors.push({ beat: k, time: beats[zero + k] ?? 0 });
    if (lastBeat > (anchors[anchors.length - 1]?.beat ?? 0))
      anchors.push({ beat: lastBeat, time: beats[beats.length - 1] ?? 0 });
    return { bpm: grid.bpm, firstDownbeat: beats[zero] ?? grid.first_downbeat, anchors };
  }
  return { bpm: grid.bpm, firstDownbeat: grid.first_downbeat, anchors: [] };
}

// ---- edits (each returns a new grid) ----

export function shiftGrid(g: EditorGrid, seconds: number): EditorGrid {
  return {
    ...g,
    firstDownbeat: g.firstDownbeat + seconds,
    anchors: g.anchors.map((a) => ({ ...a, time: a.time + seconds })),
  };
}

/** "Primer downbeat aquí": the beat nearest to `time` lands there and starts a bar. */
export function setDownbeatAt(g: EditorGrid, time: number): EditorGrid {
  if (!g.anchors.length) return { ...g, firstDownbeat: time };
  const n = beatAt(g, time);
  const shifted = shiftGrid(g, time - timeOfBeat(g, n));
  const phase = ((n % BEATS_PER_BAR) + BEATS_PER_BAR) % BEATS_PER_BAR;
  if (phase === 0) return shifted;
  return {
    ...shifted,
    firstDownbeat: timeOfBeat(shifted, phase),
    anchors: shifted.anchors
      .filter((a) => a.beat > phase)
      .map((a) => ({ ...a, beat: a.beat - phase })),
  };
}

export function setBpm(g: EditorGrid, bpm: number): EditorGrid {
  return { ...g, bpm: Math.min(MAX_BPM, Math.max(MIN_BPM, bpm)) };
}

export function doubleTempo(g: EditorGrid): EditorGrid {
  if (!g.anchors.length) return setBpm(g, g.bpm * 2);
  return { ...g, bpm: g.bpm * 2, anchors: g.anchors.map((a) => ({ ...a, beat: a.beat * 2 })) };
}

export function halveTempo(g: EditorGrid): EditorGrid {
  if (!g.anchors.length) return setBpm(g, g.bpm / 2);
  const anchors: GridAnchor[] = [];
  for (const a of g.anchors) {
    const beat = Math.round(a.beat / 2);
    if (beat >= 1 && beat > (anchors[anchors.length - 1]?.beat ?? 0)) anchors.push({ ...a, beat });
  }
  return { ...g, bpm: g.bpm / 2, anchors };
}

/** An anchor on the beat nearest to `time`, where that beat is now (nothing moves yet). */
export function addAnchor(g: EditorGrid, time: number): EditorGrid {
  const beat = beatAt(g, time);
  if (beat < 1 || g.anchors.some((a) => a.beat === beat)) return g;
  const anchors = [...g.anchors, { beat, time: timeOfBeat(g, beat) }].sort(
    (a, b) => a.beat - b.beat,
  );
  return { ...g, anchors };
}

/** Move an anchor; it stays between its neighbours (the grid never folds back). */
export function moveAnchor(g: EditorGrid, beat: number, time: number): EditorGrid {
  const p = pins(g);
  const i = p.findIndex(([b]) => b === beat);
  if (i < 1) return g;
  const prev = p[i - 1] as Pin;
  const next = p[i + 1];
  if (time <= prev[1] || (next && time >= next[1])) return g;
  const bpmBefore = (60 * (beat - prev[0])) / (time - prev[1]);
  if (bpmBefore < MIN_BPM / 2 || bpmBefore > MAX_BPM * 2) return g;
  return { ...g, anchors: g.anchors.map((a) => (a.beat === beat ? { ...a, time } : a)) };
}

export function removeAnchor(g: EditorGrid, beat: number): EditorGrid {
  return { ...g, anchors: g.anchors.filter((a) => a.beat !== beat) };
}

/** Tap tempo (track times of the taps): a constant grid whose beats fall on the taps,
 * with the bar count kept near the old first downbeat. Null with fewer than 3 taps. */
export function tapGrid(g: EditorGrid, taps: number[]): EditorGrid | null {
  if (taps.length < 3) return null;
  const n = taps.length;
  const xs = taps.map((_, i) => i);
  const mx = (n - 1) / 2;
  const my = taps.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  xs.forEach((x, i) => {
    num += (x - mx) * ((taps[i] ?? 0) - my);
    den += (x - mx) ** 2;
  });
  const period = num / den;
  const bpm = 60 / period;
  // Taps far outside any tempo (a key held down, a double tap) propose nothing.
  if (!(period > 0) || bpm < MIN_BPM || bpm > MAX_BPM) return null;
  const phase = my - mx * period;
  const bar = BEATS_PER_BAR * period;
  // The tapped beat nearest to the old downbeat becomes the downbeat.
  const k = Math.round((g.firstDownbeat - phase) / period);
  let firstDownbeat = phase + k * period;
  firstDownbeat -= bar * Math.floor(firstDownbeat / bar);
  return { bpm: Math.round(bpm * 100) / 100, firstDownbeat, anchors: [] };
}
