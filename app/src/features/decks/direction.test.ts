import { directionUnmet } from "./direction";

const ideas = (...energies: (number | null)[]) => energies.map((energy) => ({ track: { energy } }));

describe("directionUnmet", () => {
  it("says when no DJ Mix idea follows the energy direction", () => {
    expect(directionUnmet("mix", "up", 7, ideas(6, 7, 5))).toBe("up");
    expect(directionUnmet("mix", "down", 7, ideas(7, 8))).toBe("down");
    expect(directionUnmet("mix", "keep", 7, ideas(6, 8))).toBe("keep");
  });
  it("stays quiet when one idea does, in Mashup, or without energies", () => {
    expect(directionUnmet("mix", "up", 7, ideas(6, 8))).toBeNull();
    expect(directionUnmet("mashup", "up", 7, ideas(6))).toBeNull();
    expect(directionUnmet("mix", "up", null, ideas(6))).toBeNull();
    expect(directionUnmet("mix", "up", 7, ideas(null))).toBeNull();
  });
});
