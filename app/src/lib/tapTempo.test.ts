import { currentRun, tapBpm } from "./tapTempo";

const taps = (bpm: number, n: number, start = 0) =>
  Array.from({ length: n }, (_, i) => start + (i * 60000) / bpm);

describe("tap tempo", () => {
  it("needs three taps", () => {
    expect(tapBpm([])).toBeNull();
    expect(tapBpm(taps(124, 2))).toBeNull();
    expect(tapBpm(taps(124, 3))).toBe(124);
  });

  it("averages the whole run, so uneven taps settle", () => {
    expect(tapBpm([0, 480, 980, 1450, 1935])).toBeCloseTo(124, 0);
  });

  it("starts over after a long pause", () => {
    const run = [...taps(90, 4), ...taps(128, 4, 10_000)];
    expect(currentRun(run)).toHaveLength(4);
    expect(tapBpm(run)).toBe(128);
  });

  it("keeps only the latest taps", () => {
    expect(currentRun(taps(120, 40))).toHaveLength(16);
  });
});
