import { COLUMNS, gridTemplate, QUEUE_COLUMNS, visibleColumns } from "./columns";

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
});
