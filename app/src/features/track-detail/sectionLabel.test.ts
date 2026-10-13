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
  it("measures the name as it is drawn, so a wide one does not run into the next", () => {
    // 9 characters at the rough 7.6 px would be 68 px; drawn, "BREAKDOWN" is wider.
    const drawn = (text: string) => text.length * 8.6;
    expect(fitSectionLabel("Breakdown", "Brk", 72)).toBe("Breakdown");
    expect(fitSectionLabel("Breakdown", "Brk", 72, drawn)).toBe("Brk");
  });
});
