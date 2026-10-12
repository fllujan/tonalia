// What each deck plays (SPEC 2.15): the engine renders that segment (deck B stretched to
// A's tempo and shifted), and the player lines the renders up on their downbeats.
//
// - Cue click / "Try mashup": both decks from their anchor (the last cue clicked or the
//   bar clicked on the waveform; by default the first downbeat) for MASHUP_BARS bars.
// - "Try mix": A from MIX_PRE_BARS before its outro; B enters on A's outro from its first
//   downbeat (the intro) and an equal-power crossfade of 16 or 32 bars hands over to B,
//   which plays MIX_POST_BARS more. A short outro moves the crossfade earlier so it fits.
// - A deck's own play button: that deck alone from its anchor for SOLO_BARS bars.
// - A deck with a loop (solo, cue click, "Try mashup") renders just the loop and repeats it
//   until stopped: 1–32 bars from its anchor, or a free loop with both edges on the beat.
//   "Try mix" ignores the loops: it is a transition.
import {
  type BeatGrid,
  barSeconds,
  downbeatTimes,
  snapToBeat,
  snapToDownbeat,
} from "../../lib/beats";
import type { Cue, RenderSpec, SegmentInfo } from "../../lib/rpc.types";
import type { Side } from "./Deck";

export const MASHUP_BARS = 16;
export const SOLO_BARS = 32;
export const MIX_PRE_BARS = 8;
export const MIX_POST_BARS = 8;
/** The full track or one of its stems. */
export type RenderSource = NonNullable<RenderSpec["source"]>;

export const CROSSFADE_BARS = [16, 32] as const;
export type CrossfadeBars = (typeof CROSSFADE_BARS)[number];
export const LOOP_BARS = [1, 2, 4, 8, 16, 32] as const;
export type LoopBars = (typeof LOOP_BARS)[number];
/** Loop of a deck: whole bars from its anchor, or free. */
export type LoopLength = LoopBars | "free";
/** Extra seconds rendered after a loop so its end is always inside the buffer. */
export const LOOP_MARGIN = 0.25;

/** A loop in original seconds of the track. */
export interface LoopRegion {
  start: number;
  end: number;
}

export interface DeckInfo {
  trackId: number;
  bpm: number;
  duration: number;
  grid: BeatGrid | null;
  segments: readonly SegmentInfo[];
  cues: readonly Cue[];
}

/** How a deck is played: semitones, the BPM it plays at and the stem (default: the mix). */
export interface DeckProcessing {
  semitones: number;
  targetBpm: number | null;
  source?: RenderSource;
}

export interface Fade {
  direction: "in" | "out";
  /** Seconds after the common downbeat. */
  at: number;
  length: number;
}

export interface PlayDeck {
  side: Side;
  spec: RenderSpec;
  /** Seconds after the common downbeat at which this buffer's first downbeat plays. */
  delay: number;
  fade?: Fade;
  /** Repeat the first `loop` original seconds of the render until stopped. */
  loop?: number;
}

export type PlayKind = "a" | "b" | "mashup" | "mix";

export interface PlayPlan {
  kind: PlayKind;
  decks: PlayDeck[];
}

/** First downbeat of the track (0 without a beatgrid). */
export function defaultAnchor(info: Pick<DeckInfo, "grid" | "duration">): number {
  if (!info.grid) return 0;
  return downbeatTimes(info.grid, info.duration)[0] ?? 0;
}

/** Start of the outro section (or the outro cue); else the last bars that fit a crossfade. */
export function outroStart(info: DeckInfo, crossfadeBars: number): number {
  const section = info.segments.find((s) => s.label === "outro");
  const cue = info.cues.find((c) => c.label === "outro");
  const raw =
    section?.start ??
    cue?.positionSec ??
    Math.max(0, info.duration - crossfadeBars * barSeconds(info.bpm));
  return snapToDownbeat(info.grid, raw, info.duration);
}

const ms = (seconds: number) => Math.round(seconds * 1000) / 1000;

/** `bars` whole bars from the downbeat nearest to `anchor`, within the track. */
export function barLoop(info: DeckInfo, anchor: number, bars: number): LoopRegion {
  const start = snapToDownbeat(info.grid, anchor, info.duration);
  const downbeats = info.grid ? downbeatTimes(info.grid, info.duration) : [];
  const index = downbeats.findIndex((t) => Math.abs(t - start) < 1e-6);
  const end =
    (index >= 0 ? downbeats[index + bars] : undefined) ?? start + bars * barSeconds(info.bpm);
  return { start: ms(start), end: ms(Math.min(end, info.duration)) };
}

/** Free loop: the edge nearer to `time` moves to the nearest beat; at least one beat long. */
export function moveFreeEdge(info: DeckInfo, loop: LoopRegion, time: number): LoopRegion {
  const at = snapToBeat(info.grid, Math.min(info.duration, Math.max(0, time)), info.duration);
  const beat = 60 / info.bpm;
  if (Math.abs(at - loop.start) <= Math.abs(at - loop.end)) {
    const start = Math.max(0, Math.min(at, loop.end - beat));
    return { start: ms(start), end: loop.end };
  }
  const end = Math.min(info.duration, Math.max(at, loop.start + beat));
  return { start: loop.start, end: ms(end) };
}

function spec(
  info: DeckInfo,
  start: number,
  seconds: number,
  processing: DeckProcessing,
): RenderSpec {
  const from = Math.max(0, Math.min(start, info.duration - 0.5));
  return {
    trackId: info.trackId,
    source: processing.source ?? "mix",
    start: ms(from),
    duration: ms(Math.max(0.5, Math.min(seconds, info.duration - from))),
    semitones: processing.semitones,
    targetBpm: processing.targetBpm,
  };
}

/** A deck playing `bars` bars from `anchor`, or its loop when it has one. */
function deck(
  side: Side,
  info: DeckInfo,
  anchor: number,
  bars: number,
  processing: DeckProcessing,
  loop?: LoopRegion,
): PlayDeck {
  if (!loop)
    return { side, spec: spec(info, anchor, bars * barSeconds(info.bpm), processing), delay: 0 };
  const length = ms(loop.end - loop.start);
  return {
    side,
    spec: spec(info, loop.start, length + LOOP_MARGIN, processing),
    delay: 0,
    loop: length,
  };
}

const ORIGINAL: DeckProcessing = { semitones: 0, targetBpm: null };

export function soloPlan(
  side: Side,
  info: DeckInfo,
  anchor: number,
  processing: DeckProcessing = ORIGINAL,
  loop?: LoopRegion,
): PlayPlan {
  return { kind: side, decks: [deck(side, info, anchor, SOLO_BARS, processing, loop)] };
}

export function mashupPlan(
  a: DeckInfo,
  b: DeckInfo,
  anchors: { a: number; b: number },
  processing: { a: DeckProcessing; b: DeckProcessing },
  loops: Partial<Record<Side, LoopRegion>> = {},
): PlayPlan {
  return {
    kind: "mashup",
    decks: [
      deck("a", a, anchors.a, MASHUP_BARS, processing.a, loops.a),
      deck("b", b, anchors.b, MASHUP_BARS, processing.b, loops.b),
    ],
  };
}

export function mixPlan(
  a: DeckInfo,
  b: DeckInfo,
  crossfadeBars: CrossfadeBars,
  processing: { a: DeckProcessing; b: DeckProcessing },
): PlayPlan {
  const barA = barSeconds(processing.a.targetBpm ?? a.bpm);
  const barOriginalA = barSeconds(a.bpm);
  // The whole crossfade must fit before A ends: start it earlier if the outro is short.
  const latest = a.duration - crossfadeBars * barOriginalA;
  let outro = outroStart(a, crossfadeBars);
  if (outro > latest) {
    const bars = a.grid ? downbeatTimes(a.grid, a.duration).filter((t) => t <= latest + 1e-6) : [];
    outro = bars.at(-1) ?? Math.max(0, latest);
  }
  const aStart = snapToDownbeat(
    a.grid,
    Math.max(0, outro - MIX_PRE_BARS * barOriginalA),
    a.duration,
  );
  // Output seconds from A's first rendered downbeat to its outro (A may be shifted, never
  // stretched here; the ratio keeps it right if it ever is).
  const ratio = processing.a.targetBpm ? a.bpm / processing.a.targetBpm : 1;
  const entry = (outro - aStart) * ratio;
  const fade = crossfadeBars * barA;
  return {
    kind: "mix",
    decks: [
      {
        side: "a",
        spec: spec(a, aStart, outro - aStart + crossfadeBars * barOriginalA, processing.a),
        delay: 0,
        fade: { direction: "out", at: entry, length: fade },
      },
      {
        side: "b",
        spec: spec(
          b,
          defaultAnchor(b),
          (crossfadeBars + MIX_POST_BARS) * barSeconds(b.bpm),
          processing.b,
        ),
        delay: entry,
        fade: { direction: "in", at: entry, length: fade },
      },
    ],
  };
}
