import { changedSpan } from "./textDiff";

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
