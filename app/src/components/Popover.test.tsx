// Popover placement: below its anchor, flipped above near the bottom, and lined up with
// the anchor's left or right edge.
import { render, screen } from "@testing-library/react";
import { Popover } from "./Popover";

function anchorAt(rect: Partial<DOMRect>) {
  const anchor = document.createElement("button");
  document.body.append(anchor);
  anchor.getBoundingClientRect = () =>
    ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, ...rect }) as DOMRect;
  return anchor;
}

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(224);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(160);
  window.innerWidth = 1200;
  window.innerHeight = 800;
});

afterEach(() => vi.restoreAllMocks());

describe("Popover", () => {
  it("opens below the anchor, from its left edge", () => {
    const anchor = anchorAt({ top: 100, bottom: 132, left: 300, right: 332 });
    render(
      <Popover anchor={anchor} label="Menu" onClose={() => undefined}>
        <button type="button">Item</button>
      </Popover>,
    );
    expect(screen.getByRole("dialog", { name: "Menu" })).toHaveStyle({
      top: "136px",
      left: "300px",
    });
  });

  it("lines up its right edge with the anchor's, above it near the bottom", () => {
    const anchor = anchorAt({ top: 740, bottom: 772, left: 900, right: 932 });
    render(
      <Popover anchor={anchor} align="end" label="Menu" onClose={() => undefined}>
        <button type="button">Item</button>
      </Popover>,
    );
    // right edge 932 - width 224 = 708; above: 740 - 160 - 4 = 576.
    expect(screen.getByRole("dialog", { name: "Menu" })).toHaveStyle({
      top: "576px",
      left: "708px",
    });
  });
});
