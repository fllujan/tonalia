import {
  COLUMNS,
  gridTemplate,
  QUEUE_COLUMNS,
  REVIEW_COLUMNS,
  visibleColumns,
  withPlays,
} from "./columns";

const ids = (width: number) => visibleColumns(width).map((c) => c.id);

describe("visibleColumns", () => {
  it("shows every column at the design width and when the width is unknown", () => {
    expect(ids(1200)).toEqual(COLUMNS.map((c) => c.id)); // 1440 px window − sidebar
    expect(ids(0)).toEqual(COLUMNS.map((c) => c.id));
  });

  it("hides the added date, then duration, then genre as the table narrows", () => {
    expect(ids(1100)).not.toContain("added");
    expect(ids(1100)).toContain("duration");
    // The 1200 px minimum window leaves the table about 960 px.
    expect(ids(960)).toEqual(
      COLUMNS.map((c) => c.id).filter((id) => id !== "added" && id !== "duration"),
    );
    expect(ids(800)).not.toContain("genre");
    expect(ids(800)).toContain("key");
  });

  it("builds a grid template with a flexible title", () => {
    expect(gridTemplate(visibleColumns(960))).toBe(
      "36px 28px minmax(0,1fr) 84px 64px 92px 80px 112px 64px",
    );
  });

  it("gives the Analyse view a wide status and keeps its title readable at 1200 px", () => {
    const queue = (width: number) => visibleColumns(width, QUEUE_COLUMNS).map((c) => c.id);
    expect(queue(0)).toEqual(["number", "cover", "title", "genre", "duration", "status", "added"]);
    // 1200 px window − sidebar − the 280 px live summary.
    expect(queue(680)).toEqual(["number", "cover", "title", "status"]);
    expect(QUEUE_COLUMNS.find((c) => c.id === "status")?.width).toBe(184);
  });

  it("gives Revisar calidad a problem column that stays at 1200 px", () => {
    const review = visibleColumns(960, REVIEW_COLUMNS).map((c) => c.id);
    expect(review).toEqual(["number", "cover", "title", "key", "bpm", "energy", "problems"]);
  });

  it("adds the play columns before the added date, and they step aside first", () => {
    const played = withPlays(COLUMNS);
    expect(played.map((c) => c.id).slice(-3)).toEqual(["plays", "lastPlayed", "added"]);
    const at = (width: number) => visibleColumns(width, played).map((c) => c.id);
    expect(at(0)).toContain("lastPlayed");
    // The 1200 px minimum window: the last play goes after the added date; the count stays.
    expect(at(960)).not.toContain("lastPlayed");
    expect(at(960)).not.toContain("added");
    expect(at(1400)).toEqual(played.map((c) => c.id));
    expect(at(960)).toContain("plays");
  });
});
