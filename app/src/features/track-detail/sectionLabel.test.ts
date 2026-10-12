import { fitSectionLabel } from "./sectionLabel";

describe("fitSectionLabel", () => {
  it("keeps the full name when it fits", () => {
    expect(fitSectionLabel("Breakdown", "Brk", 120)).toBe("Breakdown");
  });
  it("falls back to the short name in a narrow section", () => {
    expect(fitSectionLabel("Breakdown", "Brk", 40)).toBe("Brk");
  });
  it("drops the name when not even the short one fits", () => {
    expect(fitSectionLabel("Breakdown", "Brk", 12)).toBeNull();
  });
});
