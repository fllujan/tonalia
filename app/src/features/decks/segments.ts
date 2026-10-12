// What each deck plays (SPEC 2.15): the engine renders that segment (deck B stretched to
// A's tempo and shifted), and the player lines the renders up on their downbeats.
//
// - Cue click / "Try mashup": both decks from their anchor (the last cue clicked or the
//   bar clicked on the waveform; by default the first downbeat) for MASHUP_BARS bars.
// - "Try mix": A from MIX_PRE_BARS before its outro; B enters on A's outro from its first
//   downbeat (the intro) and an equal-power crossfade of 16 or 32 bars hands over to B,
//   which plays MIX_POST_BARS more. A short outro moves the crossfade earlier so it fits.
// - A deck's own play button: that deck alone from its anchor for SOLO_BARS bars.
import { type BeatGrid, barSeconds, downbeatTimes, snapToDownbeat } from "../../lib/beats";
import type { Cue, RenderSpec, SegmentInfo } from "../../lib/rpc.types";
import type { Side } from "./Deck";

export const MASHUP_BARS = 16;
export const SOLO_BARS = 32;
export const MIX_PRE_BARS = 8;
export const MIX_POST_BARS = 8;
export const CROSSFADE_BARS = [16, 32] as const;
export type CrossfadeBars = (typeof CROSSFADE_BARS)[number];

export interface DeckInfo {
  trackId: number;
  bpm: number;
  duration: number;
  grid: BeatGrid | null;
  segments: readonly SegmentInfo[];
  cues: readonly Cue[];
}

/** How deck B is played against A: semitones and the BPM it plays at. */
export interface DeckProcessing {
  semitones: number;
  targetBpm: number | null;
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

function spec(
  info: DeckInfo,
  start: number,
  seconds: number,
  processing: DeckProcessing,
): RenderSpec {
  const from = Math.max(0, Math.min(start, info.duration - 0.5));
  return {
    trackId: info.trackId,
    source: "mix",
    start: Math.round(from * 1000) / 1000,
    duration: Math.round(Math.max(0.5, Math.min(seconds, info.duration - from)) * 1000) / 1000,
    semitones: processing.semitones,
    targetBpm: processing.targetBpm,
  };
}

const ORIGINAL: DeckProcessing = { semitones: 0, targetBpm: null };

export function soloPlan(
  side: Side,
  info: DeckInfo,
  anchor: number,
  processing: DeckProcessing = ORIGINAL,
): PlayPlan {
  return {
    kind: side,
    decks: [
      { side, spec: spec(info, anchor, SOLO_BARS * barSeconds(info.bpm), processing), delay: 0 },
    ],
  };
}

export function mashupPlan(
  a: DeckInfo,
  b: DeckInfo,
  anchors: { a: number; b: number },
  processing: { a: DeckProcessing; b: DeckProcessing },
): PlayPlan {
  return {
    kind: "mashup",
    decks: [
      {
        side: "a",
        spec: spec(a, anchors.a, MASHUP_BARS * barSeconds(a.bpm), processing.a),
        delay: 0,
      },
      {
        side: "b",
        spec: spec(b, anchors.b, MASHUP_BARS * barSeconds(b.bpm), processing.b),
        delay: 0,
      },
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
