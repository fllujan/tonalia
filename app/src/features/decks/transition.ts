// The DJ Mix transition lane (DESIGN 6.10): what "Try mix" plays, on one clock. A's outro
// over B's intro, with the crossfade zone between them. Everything comes from the same
// plan the player gets (segments.mixPlan), so the drawing is the mix that will sound.
import type { DeckInfo, PlayPlan } from "./segments";

/** One deck on the lane: original seconds `from`–`to`, drawn at lane seconds `start`–`end`. */
export interface LaneDeck {
  from: number;
  to: number;
  start: number;
  end: number;
}

export interface MixTimeline {
  a: LaneDeck;
  b: LaneDeck;
  /** The crossfade, in lane seconds, and its length in bars. */
  fade: { start: number; end: number; bars: number };
  total: number;
}

/** Lane seconds per original second of a deck played at `targetBpm`. */
const stretch = (info: DeckInfo, targetBpm: number | null | undefined) =>
  targetBpm ? info.bpm / targetBpm : 1;

export function mixTimeline(plan: PlayPlan, a: DeckInfo, b: DeckInfo): MixTimeline {
  const deckA = plan.decks.find((d) => d.side === "a");
  const deckB = plan.decks.find((d) => d.side === "b");
  const lane = (info: DeckInfo, deck: typeof deckA): LaneDeck => {
    const from = deck?.spec.start ?? 0;
    const length = deck?.spec.duration ?? 0;
    const start = deck?.delay ?? 0;
    return {
      from,
      to: from + length,
      start,
      end: start + length * stretch(info, deck?.spec.targetBpm),
    };
  };
  const laneA = lane(a, deckA);
  const laneB = lane(b, deckB);
  const fade = deckA?.fade ?? { at: laneB.start, length: 0 };
  const barA = 240 / (deckA?.spec.targetBpm ?? a.bpm);
  return {
    a: laneA,
    b: laneB,
    fade: {
      start: fade.at,
      end: fade.at + fade.length,
      bars: Math.round(fade.length / barA),
    },
    total: Math.max(laneA.end, laneB.end),
  };
}

/** Where the playheads of the decks (original seconds) fall on the lane. */
export function laneTime(
  line: MixTimeline,
  times: { a: number | null; b: number | null },
): number | null {
  const at = (deck: LaneDeck, time: number) =>
    deck.start + ((time - deck.from) * (deck.end - deck.start)) / (deck.to - deck.from || 1);
  // A's clock until A's part is over, then B's.
  if (times.a != null && (times.a <= line.a.to || times.b == null)) return at(line.a, times.a);
  if (times.b != null) return at(line.b, times.b);
  return null;
}

/** Original seconds of a deck at lane second `s`. */
function original(deck: LaneDeck, s: number): number {
  return deck.from + ((s - deck.start) * (deck.to - deck.from)) / (deck.end - deck.start || 1);
}

/** What each deck brings forward: A from its outro to its end, B's intro through the fade. */
export function deckFocus(line: MixTimeline): Record<"a" | "b", { start: number; end: number }> {
  return {
    a: { start: original(line.a, line.fade.start), end: line.a.to },
    b: { start: line.b.from, end: original(line.b, line.fade.end) },
  };
}
