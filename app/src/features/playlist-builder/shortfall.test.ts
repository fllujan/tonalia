import { shortfall } from "./shortfall";

const result = (minutes: number, tracks: number) => ({
  duration: minutes * 60,
  items: Array.from({ length: tracks }),
});

describe("shortfall", () => {
  it("says how much of the asked length the set covers", () => {
    expect(shortfall(result(17, 3), { mode: "duration", minutes: 60 })).toEqual({
      mode: "duration",
      got: 17,
      wanted: 60,
    });
    expect(shortfall(result(12, 12), { mode: "count", count: 20 })).toEqual({
      mode: "count",
      got: 12,
      wanted: 20,
    });
  });

  it("stays quiet when the set is long enough (a track more or less is fine)", () => {
    expect(shortfall(result(56, 12), { mode: "duration", minutes: 60 })).toBeNull();
    expect(shortfall(result(70, 20), { mode: "count", count: 20 })).toBeNull();
    expect(shortfall(result(10, 2), null)).toBeNull();
  });
});
