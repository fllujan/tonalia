import { changedSpan, removedParts } from "./textDiff";

describe("changedSpan", () => {
  it("highlights only what a template put before the old comment", () => {
    expect(changedSpan("Nice track", "8A - Energy 7 - Nice track")).toEqual({
      prefix: "",
      changed: "8A - Energy 7 - ",
      suffix: "Nice track",
    });
  });

  it("keeps the unchanged start and end around an edit", () => {
    expect(changedSpan("Song (Original Mix)", "Song")).toEqual({
      prefix: "Song",
      changed: "",
      suffix: "",
    });
    expect(changedSpan("Artist ft. Guest", "Artist feat. Guest")).toEqual({
      prefix: "Artist f",
      changed: "ea",
      suffix: "t. Guest",
    });
  });

  it("marks everything when nothing is shared, and never splits an emoji", () => {
    expect(changedSpan("abc", "xyz").changed).toBe("xyz");
    expect(changedSpan("🎵 a", "🎶 a")).toEqual({ prefix: "", changed: "🎶", suffix: " a" });
  });
});

describe("pure deletions", () => {
  it("highlights nothing new when the cleaned value is a piece of the old one", () => {
    expect(changedSpan("01 MIDNIGHT BLOOM (Promo)", "MIDNIGHT BLOOM")).toEqual({
      prefix: "MIDNIGHT BLOOM",
      changed: "",
      suffix: "",
    });
  });

  it("marks what was removed from the old value instead", () => {
    expect(removedParts("01 MIDNIGHT BLOOM (Promo)", "MIDNIGHT BLOOM")).toEqual([
      { text: "01 ", removed: true },
      { text: "MIDNIGHT BLOOM", removed: false },
      { text: " (Promo)", removed: true },
    ]);
    // Nothing removed (only inserted): one kept piece.
    expect(removedParts("Artist ft. Guest", "Artist feat. Guest")).toEqual([
      { text: "Artist ft. Guest", removed: false },
    ]);
    expect(removedParts("Song (Original Mix)", "Song")).toEqual([
      { text: "Song", removed: false },
      { text: " (Original Mix)", removed: true },
    ]);
  });
});
