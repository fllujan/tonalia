import { asBeatGrid, beatTimes, downbeatTimes, snapToBeat } from "./beats";

const grid = { kind: "constant" as const, bpm: 120, first_downbeat: 0.75 };

describe("beat grid", () => {
  it("lists beats from the start, including the pickup before the first downbeat", () => {
    expect(beatTimes(grid, 3).map((t) => +t.toFixed(3))).toEqual([
      0.25, 0.75, 1.25, 1.75, 2.25, 2.75,
    ]);
  });

  it("finds bar starts on the downbeat phase", () => {
    expect(downbeatTimes(grid, 6).map((t) => +t.toFixed(3))).toEqual([0.75, 2.75, 4.75]);
    const variable = {
      kind: "variable" as const,
      bpm: 120,
      first_downbeat: 1,
      beats: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5],
    };
    expect(downbeatTimes(variable, 4)).toEqual([1, 3]);
  });

  it("snaps to the nearest beat", () => {
    expect(snapToBeat(grid, 1.6, 10)).toBeCloseTo(1.75);
    expect(snapToBeat(grid, 1.4, 10)).toBeCloseTo(1.25);
    expect(snapToBeat(null, 1.4, 10)).toBe(1.4);
  });

  it("validates grids coming from the engine", () => {
    expect(asBeatGrid(grid)).toEqual(grid);
    expect(asBeatGrid({ kind: "other" })).toBeNull();
    expect(asBeatGrid(null)).toBeNull();
  });
});
