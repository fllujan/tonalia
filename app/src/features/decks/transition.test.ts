import type { BeatGrid } from "../../lib/beats";
import { type DeckInfo, mixPlan } from "./segments";
import { deckFocus, laneTime, mixTimeline } from "./transition";

const grid = (bpm: number, first: number): BeatGrid => ({
  kind: "constant",
  bpm,
  first_downbeat: first,
});
const A: DeckInfo = {
  trackId: 1,
  bpm: 120, // 2 s bars
  duration: 300,
  grid: grid(120, 0.5),
  segments: [{ start: 256.5, end: 300, label: "outro", energy: 3 }],
  cues: [],
};
const B: DeckInfo = {
  trackId: 2,
  bpm: 125,
  duration: 280,
  grid: grid(125, 1.1),
  segments: [],
  cues: [],
};
const proc = {
  a: { semitones: 0, targetBpm: null },
  b: { semitones: 2, targetBpm: 120 },
};

describe("mix timeline", () => {
  it("lays A's outro over B's intro on the output clock of the mix", () => {
    const line = mixTimeline(mixPlan(A, B, 16, proc), A, B);
    // A plays 240.5 → 288.5 (48 s), B enters at 16 s, stretched to 120 BPM: 24 bars = 48 s.
    expect(line.a).toEqual({ from: 240.5, to: 288.5, start: 0, end: 48 });
    expect(line.b.from).toBeCloseTo(1.1);
    expect(line.b.to).toBeCloseTo(1.1 + 24 * (240 / 125), 6);
    expect(line.b.start).toBeCloseTo(16);
    expect(line.b.end).toBeCloseTo(64);
    expect(line.fade).toEqual({ start: 16, end: 48, bars: 16 });
    expect(line.total).toBeCloseTo(64);
  });

  it("maps each deck's playhead onto the lane", () => {
    const line = mixTimeline(mixPlan(A, B, 16, proc), A, B);
    expect(laneTime(line, { a: 256.5, b: null })).toBeCloseTo(16);
    // Once A has stopped, B's own clock places it: stretched to 120 BPM, one original
    // second of B lasts 125/120 s on the lane.
    expect(laneTime(line, { a: null, b: 1.1 + 12 })).toBeCloseTo(16 + 12.5);
    expect(laneTime(line, { a: null, b: null })).toBeNull();
  });

  it("brings forward A's outro and B's intro on the decks", () => {
    const focus = deckFocus(mixTimeline(mixPlan(A, B, 16, proc), A, B));
    expect(focus.a).toEqual({ start: 256.5, end: 288.5 });
    expect(focus.b.start).toBeCloseTo(1.1);
    expect(focus.b.end).toBeCloseTo(1.1 + 16 * (240 / 125), 6); // 16 bars of B
  });
});
