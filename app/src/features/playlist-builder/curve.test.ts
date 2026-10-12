import { addPoint, movePoint, pointsOf, removePoint, TEMPLATES } from "./curve";

describe("energy curve editing", () => {
  const line = TEMPLATES.ascending;

  it("pins the ends to the start and the end of the set", () => {
    expect(movePoint(line, 0, 0.4, 6)).toEqual([
      { x: 0, energy: 6 },
      { x: 1, energy: 9 },
    ]);
    expect(movePoint(line, 1, 0.2, 12)[1]).toEqual({ x: 1, energy: 10 });
  });

  it("keeps inner points between their neighbours, in half steps of energy", () => {
    const arc = TEMPLATES.warmup_peak_cooldown;
    expect(movePoint(arc, 1, 0.95, 7.3)[1]).toEqual({ x: 0.84, energy: 7.5 });
    expect(movePoint(arc, 1, -1, 0)[1]).toEqual({ x: 0.01, energy: 1 });
  });

  it("adds and removes inner points only", () => {
    const added = addPoint(line, 0.5, 8.2);
    expect(added).toEqual([
      { x: 0, energy: 4 },
      { x: 0.5, energy: 8 },
      { x: 1, energy: 9 },
    ]);
    expect(addPoint(added, 0.51, 3)).toBe(added);
    expect(removePoint(added, 1)).toEqual(line);
    expect(removePoint(added, 0)).toEqual(added);
    expect(removePoint(line, 1)).toEqual(line);
  });

  it("draws a template until a point moves", () => {
    expect(pointsOf("ascending", [])).toBe(line);
    expect(pointsOf("custom", [{ x: 0, energy: 2 }])).toEqual([{ x: 0, energy: 2 }]);
  });
});
