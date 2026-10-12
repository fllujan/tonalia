import { COLUMNS, gridTemplate, visibleColumns } from "./columns";

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
});
