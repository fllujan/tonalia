import { sectionColor, sectionKinds } from "./sections";

describe("sectionKinds", () => {
  it("makes the second drop and build the palette's 2nd drop and build", () => {
    expect(
      sectionKinds(["intro", "build", "drop", "breakdown", "build", "drop", "drop", "outro"]),
    ).toEqual(["intro", "build", "drop", "breakdown", "build2", "drop2", "drop2", "outro"]);
    expect(sectionColor("drop2")).toBe("var(--color-cue-6)");
  });
});
