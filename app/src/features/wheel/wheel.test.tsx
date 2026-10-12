// Harmonic wheel (SPEC 6.1, DESIGN 5.11): geometry, relations, mouse and keyboard.
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import i18n from "../../i18n";
import { fromAlphanumeric, type Key, keysEqual, type Notation } from "../../lib/keys";
import {
  compatibleKeys,
  moveOnWheel,
  polar,
  segmentAngle,
  segmentPath,
  WHEEL_KEYS,
} from "./geometry";
import { HarmonicWheel } from "./HarmonicWheel";

const k = fromAlphanumeric;

beforeEach(async () => {
  await i18n.changeLanguage("es");
});

describe("geometry", () => {
  it("lays the wheel out like a clock, 12 on top and 3 on the right", () => {
    const top = polar(100, 100, 50, segmentAngle(12));
    const right = polar(100, 100, 50, segmentAngle(3));
    expect(top.x).toBeCloseTo(100);
    expect(top.y).toBeCloseTo(50);
    expect(right.x).toBeCloseTo(150);
    expect(right.y).toBeCloseTo(100);
  });

  it("draws closed annular sectors", () => {
    const d = segmentPath(100, 60, 90, 8, 2);
    expect(d).toMatch(/^M[\d.]+ [\d.]+ A90 90 0 0 1 .* L.* A60 60 0 0 0 .* Z$/);
  });

  it("has the 24 keys, each once", () => {
    expect(WHEEL_KEYS).toHaveLength(24);
    expect(new Set(WHEEL_KEYS.map((x) => `${x.root}${x.mode}`)).size).toBe(24);
  });

  it("lists the compatible keys of 8A in the order of the SPEC 2.3 table", () => {
    expect(compatibleKeys(k("8A")).map((c) => [c.key, c.relation])).toEqual([
      [k("8A"), "same"],
      [k("7A"), "adjacent"],
      [k("9A"), "adjacent"],
      [k("8B"), "relative"],
      [k("9B"), "diagonal"],
      [k("10A"), "energy_boost"],
      [k("3A"), "semitone_up"],
    ]);
  });

  it("moves around a ring and across rings", () => {
    expect(moveOnWheel(k("12A"), "clockwise")).toEqual(k("1A"));
    expect(moveOnWheel(k("1B"), "counterclockwise")).toEqual(k("12B"));
    expect(moveOnWheel(k("8A"), "outer")).toEqual(k("8B"));
    expect(moveOnWheel(k("8B"), "inner")).toEqual(k("8A"));
    expect(moveOnWheel(k("8B"), "outer")).toEqual(k("8B"));
  });
});

describe("HarmonicWheel", () => {
  const segment = (name: string) => screen.getByRole("button", { name: new RegExp(`^${name} `) });

  it("highlights the current key and its compatibles with the relation", () => {
    render(<HarmonicWheel current={k("8A")} notation="alphanumeric" onPick={() => undefined} />);
    expect(segment("8A")).toHaveAttribute("data-state", "current");
    expect(segment("8A")).toHaveAccessibleName("8A (menor) · Misma tonalidad");
    expect(segment("9B")).toHaveAttribute("data-state", "compatible");
    expect(segment("9B")).toHaveAccessibleName("9B (mayor) · Diagonal");
    expect(segment("10A")).toHaveAccessibleName("10A (menor) · +2 energía");
    expect(segment("5B")).toHaveAttribute("data-state", "dimmed");
    expect(segment("5B")).toHaveAccessibleName("5B (mayor)");
    // The key is always written, never only coloured.
    expect(segment("8A")).toHaveTextContent("8A");
  });

  it.each<[Notation, string, string]>([
    ["alphanumeric", "8A", "8B"],
    ["open_key", "1m", "1d"],
    ["classical", "Am", "C"],
    ["classical_flat", "Am", "C"],
  ])("labels the segments in %s notation", (notation, minor, major) => {
    render(<HarmonicWheel current={k("8A")} notation={notation} onPick={() => undefined} />);
    expect(segment(minor)).toHaveTextContent(minor);
    expect(segment(major)).toHaveTextContent(major);
  });

  it("writes flats or sharps as the notation asks", () => {
    const { unmount } = render(
      <HarmonicWheel current={null} notation="classical" onPick={() => undefined} />,
    );
    expect(segment("F#")).toBeInTheDocument();
    unmount();
    render(<HarmonicWheel current={null} notation="classical_flat" onPick={() => undefined} />);
    expect(segment("Gb")).toBeInTheDocument();
  });

  it("picks a key with the mouse", async () => {
    const onPick = vi.fn();
    render(<HarmonicWheel current={k("8A")} notation="alphanumeric" onPick={onPick} />);
    await userEvent.click(segment("3B"));
    expect(onPick).toHaveBeenCalledWith(k("3B"));
  });

  it("is fully usable with the keyboard (roving focus, arrows, Enter and Space)", async () => {
    const onPick = vi.fn();
    render(<HarmonicWheel current={k("8A")} notation="alphanumeric" onPick={onPick} />);
    const tabbable = screen
      .getAllByRole("button")
      .filter((b) => b.getAttribute("tabindex") === "0");
    expect(tabbable).toEqual([segment("8A")]);

    await userEvent.tab();
    expect(segment("8A")).toHaveFocus();
    await userEvent.keyboard("{ArrowRight}");
    expect(segment("9A")).toHaveFocus();
    await userEvent.keyboard("{ArrowUp}");
    expect(segment("9B")).toHaveFocus();
    await userEvent.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(segment("7B")).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}");
    expect(segment("7A")).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(onPick).toHaveBeenLastCalledWith(k("7A"));
    await userEvent.keyboard("{End}");
    expect(segment("12A")).toHaveFocus();
    await userEvent.keyboard("{Home}");
    expect(segment("1A")).toHaveFocus();
    await userEvent.keyboard(" ");
    expect(onPick).toHaveBeenLastCalledWith(k("1A"));
    expect(segment("1A")).toHaveAttribute("tabindex", "0");
  });

  it("supports several selected keys (filters) with aria-pressed", async () => {
    function Picker() {
      const [keys, setKeys] = useState<Key[]>([k("8A")]);
      return (
        <HarmonicWheel
          current={null}
          selected={keys}
          notation="alphanumeric"
          onPick={(key) =>
            setKeys((ks) =>
              ks.some((x) => keysEqual(x, key))
                ? ks.filter((x) => !keysEqual(x, key))
                : [...ks, key],
            )
          }
        />
      );
    }
    render(<Picker />);
    expect(segment("8A")).toHaveAttribute("aria-pressed", "true");
    expect(segment("9A")).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(segment("9A"));
    expect(segment("9A")).toHaveAttribute("aria-pressed", "true");
    expect(segment("10A")).toHaveAttribute("data-state", "dimmed");
    fireEvent.keyDown(segment("8A"), { key: "Enter" });
    expect(segment("8A")).toHaveAttribute("aria-pressed", "false");
  });

  it("shows the compatibles legend in English too", async () => {
    await i18n.changeLanguage("en");
    render(
      <HarmonicWheel current={k("8A")} notation="alphanumeric" onPick={() => undefined} legend />,
    );
    const legend = screen.getByRole("list", { name: "Compatible keys" });
    expect(legend).toHaveTextContent("8BRelative");
    expect(legend).toHaveTextContent("10A+2 energy boost");
  });

  it("can light up the compatibles of the selected keys", () => {
    render(
      <HarmonicWheel
        current={null}
        selected={[k("8A")]}
        highlightCompatibles
        notation="alphanumeric"
        onPick={() => undefined}
      />,
    );
    expect(segment("8A")).toHaveAttribute("data-state", "selected");
    expect(segment("10A")).toHaveAttribute("data-state", "compatible");
    expect(segment("5B")).toHaveAttribute("data-state", "dimmed");
  });
});
