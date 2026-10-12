import { remainingSeconds, stageProgress } from "./analysisStore";

describe("remainingSeconds", () => {
  it("projects the pace so far", () => {
    // A quarter done in a minute: three more minutes.
    expect(remainingSeconds(25, 60_000)).toBeCloseTo(180);
    expect(remainingSeconds(50, 10_000)).toBeCloseTo(10);
  });

  it("waits for enough to go on", () => {
    expect(remainingSeconds(0.5, 60_000)).toBeNull();
    expect(remainingSeconds(40, 2_000)).toBeNull();
    expect(remainingSeconds(100, 60_000)).toBeNull();
  });
});

describe("stageProgress", () => {
  it("is how many of the seven stages are behind", () => {
    expect(stageProgress("decoding")).toBe(0);
    expect(stageProgress("tempo")).toBeCloseTo(2 / 7);
  });
});
