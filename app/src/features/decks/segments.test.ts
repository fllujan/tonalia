import type { BeatGrid } from "../../lib/beats";
import {
  barLoop,
  type DeckInfo,
  defaultAnchor,
  LOOP_MARGIN,
  moveFreeEdge,
  mashupPlan,
  mixPlan,
  outroStart,
  soloPlan,
} from "./segments";

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
  segments: [
    { start: 0.5, end: 64.5, label: "intro", energy: 4 },
    { start: 256.5, end: 300, label: "outro", energy: 3 },
  ],
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

describe("segments", () => {
  it("anchors on the first downbeat", () => {
    expect(defaultAnchor(A)).toBeCloseTo(0.5);
    expect(defaultAnchor({ grid: null, duration: 10 })).toBe(0);
  });

  it("plays both decks 16 bars from their anchors, B stretched and shifted", () => {
    const plan = mashupPlan(A, B, { a: 64.5, b: 1.1 }, proc);
    expect(plan.kind).toBe("mashup");
    expect(plan.decks.map((d) => d.spec)).toEqual([
      { trackId: 1, source: "mix", start: 64.5, duration: 32, semitones: 0, targetBpm: null },
      { trackId: 2, source: "mix", start: 1.1, duration: 30.72, semitones: 2, targetBpm: 120 },
    ]);
    expect(plan.decks.every((d) => d.delay === 0 && !d.fade)).toBe(true);
  });

  it("clamps a segment to the end of the track", () => {
    const plan = soloPlan("a", A, 290);
    expect(plan.decks[0]?.spec).toMatchObject({ start: 290, duration: 10 });
  });

  it("finds the outro from the sections, the cues or the end", () => {
    expect(outroStart(A, 16)).toBeCloseTo(256.5);
    const byCue = {
      ...A,
      segments: [],
      cues: [{ slot: 7, positionSec: 240.6, label: "outro", color: null, source: "auto" as const }],
    };
    expect(outroStart(byCue, 16)).toBeCloseTo(240.5); // snapped to the bar
    expect(outroStart({ ...A, segments: [] }, 16)).toBeCloseTo(268.5); // 300 − 32 s, on a bar
  });

  it("mixes from 8 bars before A's outro into B's intro with a 16-bar crossfade", () => {
    const plan = mixPlan(A, B, 16, proc);
    const [a, b] = plan.decks;
    // A: 8 bars (16 s) before the outro at 256.5, through the 16-bar crossfade (32 s).
    expect(a?.spec).toMatchObject({ start: 240.5, duration: 48, targetBpm: null });
    expect(a?.fade).toEqual({ direction: "out", at: 16, length: 32 });
    // B enters on A's outro from its first downbeat and plays 16 + 8 bars of itself.
    expect(b?.delay).toBeCloseTo(16);
    expect(b?.spec).toMatchObject({ start: 1.1, semitones: 2, targetBpm: 120 });
    expect(b?.spec.duration).toBeCloseTo(24 * (240 / 125), 3);
    expect(b?.fade).toEqual({ direction: "in", at: 16, length: 32 });
  });

  it("moves a 32-bar crossfade earlier when the outro is too short for it", () => {
    // The outro (256.5) leaves 43.5 s; 32 bars need 64 s, so the crossfade starts at the
    // last bar that fits (≤ 236 s → 234.5) and A plays 8 bars before it.
    const plan = mixPlan(A, B, 32, proc);
    const [a, b] = plan.decks;
    expect(a?.spec).toMatchObject({ start: 218.5, duration: 80 });
    expect((a?.spec.start ?? 0) + (a?.spec.duration ?? 0)).toBeLessThanOrEqual(A.duration);
    expect(a?.fade).toEqual({ direction: "out", at: 16, length: 64 });
    expect(b?.delay).toBeCloseTo(16);
    expect(b?.spec.duration).toBeCloseTo(40 * (240 / 125), 3);
  });

  it("loops whole bars from the downbeat nearest to the anchor", () => {
    expect(barLoop(A, 64.9, 4)).toEqual({ start: 64.5, end: 72.5 });
    expect(barLoop(A, 0, 1)).toEqual({ start: 0.5, end: 2.5 });
    // Clamped to the end of the track.
    expect(barLoop(A, 296.5, 32)).toEqual({ start: 296.5, end: 300 });
    expect(barLoop({ ...A, grid: null }, 10, 2)).toEqual({ start: 10, end: 14 });
  });

  it("moves the nearer edge of a free loop to the beat, at least one beat long", () => {
    const loop = { start: 64.5, end: 72.5 };
    // Beats every 0.5 s from 0.5: 70.2 snaps to 70.0 and moves the end.
    expect(moveFreeEdge(A, loop, 70.2)).toEqual({ start: 64.5, end: 70 });
    expect(moveFreeEdge(A, loop, 63.1)).toEqual({ start: 63, end: 72.5 });
    expect(moveFreeEdge(A, { start: 64.5, end: 65 }, 64.6)).toEqual({ start: 64.5, end: 65 });
  });

  it("renders a looped deck from the loop start and loops its length", () => {
    const solo = soloPlan(
      "a",
      A,
      0,
      { semitones: 0, targetBpm: null, source: "vocals" },
      {
        start: 64.5,
        end: 72.5,
      },
    );
    expect(solo.decks[0]).toEqual({
      side: "a",
      spec: {
        trackId: 1,
        source: "vocals",
        start: 64.5,
        duration: 8 + LOOP_MARGIN,
        semitones: 0,
        targetBpm: null,
      },
      delay: 0,
      loop: 8,
    });
    const plan = mashupPlan(
      A,
      B,
      { a: 0.5, b: 1.1 },
      { a: proc.a, b: { ...proc.b, source: "instrumental" } },
      { a: { start: 64.5, end: 72.5 } },
    );
    expect(plan.decks[0]).toMatchObject({ spec: { start: 64.5, source: "mix" }, loop: 8 });
    expect(plan.decks[1]).toMatchObject({
      spec: { start: 1.1, duration: 30.72, source: "instrumental" },
    });
    expect(plan.decks[1]?.loop).toBeUndefined();
  });
});
