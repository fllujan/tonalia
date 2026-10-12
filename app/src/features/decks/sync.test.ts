// Click test for the deck sync (SPEC 8 acceptance: downbeat offset < 5 ms). Two click
// tracks whose first downbeats sit at different places in their buffers are scheduled
// with `alignStarts` and mixed on one timeline at 44.1 kHz; every downbeat click of B
// must land on a downbeat click of A.
import { alignStarts, crossfadeGains, fadeCurve } from "./sync";
import { clockPosition } from "./syncPlayer";

const SR = 44_100;

/** Mono click buffer: a click on every beat from `first`, louder on downbeats. */
function clicks(bpm: number, first: number, seconds: number): Float32Array {
  const out = new Float32Array(Math.round(seconds * SR));
  const period = 60 / bpm;
  for (let i = 0, t = first; t < seconds - 0.01; i++, t += period) {
    const at = Math.round(t * SR);
    const level = i % 4 === 0 ? 1 : 0.4;
    for (let k = 0; k < 64 && at + k < out.length; k++) out[at + k] = level * Math.exp(-k / 8);
  }
  return out;
}

/** Downbeat onsets (seconds on the timeline) of a buffer started at `start`. */
function downbeatOnsets(buffer: Float32Array, start: number): number[] {
  const found: number[] = [];
  for (let i = 0; i < buffer.length; i++) {
    if ((buffer[i] ?? 0) > 0.9 && (i === 0 || (buffer[i - 1] ?? 0) < 0.9)) {
      found.push(start + i / SR);
      i += SR / 10;
    }
  }
  return found;
}

/** Start times quantized to the sample, as an AudioBufferSourceNode plays them. */
const quantize = (t: number) => Math.round(t * SR) / SR;

describe("alignStarts", () => {
  it("lines up the first downbeats and starts nothing in the past", () => {
    const now = 12.345;
    const [a, b] = alignStarts([0.37, 1.03], [0, 0], now) as [number, number];
    expect(a + 0.37).toBeCloseTo(b + 1.03, 9);
    expect(Math.min(a, b)).toBeGreaterThanOrEqual(now + 0.12 - 1e-9);
    // The later of the two starts right at now + lead.
    expect(Math.min(a, b)).toBeCloseTo(now + 0.12, 9);
  });

  it("delays a deck by whole bars (the mix entry)", () => {
    const entry = 8 * (240 / 124);
    const [a, b] = alignStarts([0.02, 0.5], [0, entry], 3) as [number, number];
    expect(b + 0.5 - (a + 0.02)).toBeCloseTo(entry, 9);
    expect(a).toBeCloseTo(3.12, 9);
  });

  it.each([
    [124, 0.37, 1.03],
    [128, 0.0, 1.874],
    [174, 0.911, 0.004],
  ])("keeps every downbeat of B within 5 ms of A over 16 bars (%s BPM)", (bpm, firstA, firstB) => {
    const seconds = 16 * (240 / bpm) + 2;
    const deckA = clicks(bpm, firstA, seconds);
    const deckB = clicks(bpm, firstB, seconds); // B already rendered at A's tempo
    const [startA, startB] = alignStarts([firstA, firstB], [0, 0], 100.0021).map(quantize) as [
      number,
      number,
    ];
    const onA = downbeatOnsets(deckA, startA);
    const onB = downbeatOnsets(deckB, startB);
    expect(onB.length).toBeGreaterThanOrEqual(15);
    const errors = onB
      .filter((t) => t <= (onA.at(-1) ?? 0))
      .map((t) => Math.min(...onA.map((u) => Math.abs(u - t))));
    expect(errors.length).toBeGreaterThanOrEqual(15);
    expect(Math.max(...errors)).toBeLessThan(0.005);
  });
});

describe("crossfade", () => {
  it("keeps equal power across the crossfader", () => {
    for (const x of [0, 0.1, 0.25, 0.5, 0.8, 1]) {
      const { a, b } = crossfadeGains(x);
      expect(a * a + b * b).toBeCloseTo(1, 9);
    }
    expect(crossfadeGains(0)).toEqual({ a: 1, b: 0 });
    expect(crossfadeGains(1).a).toBeCloseTo(0, 9);
    expect(crossfadeGains(-1)).toEqual(crossfadeGains(0));
  });

  it("fades out from 1 to 0 and in from 0 to 1", () => {
    const out = fadeCurve("out", 16);
    const into = fadeCurve("in", 16);
    expect(out[0]).toBe(1);
    expect(out[15]).toBeCloseTo(0, 6);
    expect(into[0]).toBe(0);
    expect(into[15]).toBeCloseTo(1, 6);
  });
});

describe("deck clock", () => {
  it("follows the render and wraps inside a loop", () => {
    const clock = { segStart: 64.5, ratio: 1.5, startAt: 10, length: 12.4 };
    expect(clockPosition(clock, 9)).toBe(64.5);
    expect(clockPosition(clock, 13)).toBeCloseTo(66.5);
    expect(clockPosition(clock, 40)).toBeCloseTo(64.5 + 12.4 / 1.5);
    // An 8 s loop played at 1.5x length: 12 output seconds, then back to the start.
    const looped = { ...clock, loop: 12 };
    expect(clockPosition(looped, 25)).toBeCloseTo(64.5 + 3 / 1.5);
  });
});
