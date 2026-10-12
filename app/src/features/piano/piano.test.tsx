// Verification piano (SPEC 2.13, DESIGN 5.12): scale, chord, spelling, mouse and keyboard.
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import i18n from "../../i18n";
import { fromAlphanumeric, type Key, NOTATIONS, type Notation, parseKey } from "../../lib/keys";
import {
  codeForNote,
  HIGH,
  LOW,
  noteForCode,
  scaleNotes,
  scalePitchClasses,
  spellScale,
  tonicChord,
} from "./music";
import { Piano } from "./Piano";
import type { Synth } from "./synth";

const k = fromAlphanumeric;

function fakeSynth() {
  const released: number[] = [];
  const synth = {
    start: vi.fn((midi: number) => () => released.push(midi)),
    play: vi.fn(),
  } satisfies Synth;
  return { synth, released };
}

beforeEach(async () => {
  await i18n.changeLanguage("es");
});

describe("music", () => {
  it("builds major and natural minor scales", () => {
    expect(scalePitchClasses(k("8B"))).toEqual([0, 2, 4, 5, 7, 9, 11]); // C major
    expect(scalePitchClasses(k("8A"))).toEqual([9, 11, 0, 2, 4, 5, 7]); // A minor
    expect(scalePitchClasses(k("10B"))).toEqual([2, 4, 6, 7, 9, 11, 1]); // D major
  });

  it("keeps the relative major and minor on the same notes", () => {
    for (let n = 1; n <= 12; n++) {
      const minor = new Set(scalePitchClasses(k(`${n}A`)));
      expect(new Set(scalePitchClasses(k(`${n}B`)))).toEqual(minor);
    }
  });

  it("plays the scale and the tonic chord inside the two octaves", () => {
    for (let n = 1; n <= 12; n++) {
      for (const l of ["A", "B"]) {
        const key = k(`${n}${l}`);
        const notes = [...scaleNotes(key), ...tonicChord(key)];
        expect(Math.min(...notes)).toBeGreaterThanOrEqual(LOW);
        expect(Math.max(...notes)).toBeLessThanOrEqual(HIGH);
      }
    }
    expect(scaleNotes(k("8A"))).toEqual([57, 59, 60, 62, 64, 65, 67, 69]);
    expect(tonicChord(k("8A"))).toEqual([57, 60, 64]); // A C E
    expect(tonicChord(k("8B"))).toEqual([48, 52, 55]); // C E G
  });

  it("spells each scale with one letter per degree", () => {
    expect(spellScale(k("7B"), "alphanumeric")).toEqual(["F", "G", "A", "B♭", "C", "D", "E"]);
    expect(spellScale(k("10B"), "alphanumeric")).toEqual(["D", "E", "F♯", "G", "A", "B", "C♯"]);
    expect(spellScale(k("2A"), "alphanumeric")).toEqual(["E♭", "F", "G♭", "A♭", "B♭", "C♭", "D♭"]);
    // The classical notations keep the tonic as the key is written...
    expect(spellScale(k("12A"), "classical")[0]).toBe("C♯");
    expect(spellScale(k("3B"), "classical_flat")[0]).toBe("D♭");
    expect(spellScale(k("3B"), "classical")[0]).toBe("C♯");
    // ...unless it needs double accidentals (D♭ minor has B𝄫).
    expect(spellScale(k("12A"), "classical_flat")).toEqual([
      "C♯", "D♯", "E", "F♯", "G♯", "A", "B",
    ]); // prettier-ignore
    for (let n = 1; n <= 12; n++) {
      for (const l of ["A", "B"]) {
        const names = spellScale(k(`${n}${l}`), "alphanumeric");
        expect(new Set(names.map((x) => x[0])).size).toBe(7);
      }
    }
  });

  it("maps the computer keyboard from the base C", () => {
    expect(noteForCode("KeyA", 48)).toBe(48);
    expect(noteForCode("KeyW", 48)).toBe(49);
    expect(noteForCode("KeyP", 48)).toBe(63);
    expect(noteForCode("KeyP", 60)).toBeNull(); // above C5
    expect(noteForCode("KeyK", 60)).toBe(72);
    expect(noteForCode("KeyQ", 48)).toBeNull();
    expect(codeForNote(50, 48)).toBe("S");
    expect(codeForNote(50, 60)).toBeNull();
  });
});

describe("Piano", () => {
  const pianoKey = (name: string) =>
    screen.getByRole("button", { name: new RegExp(`^${name}\\b`) });
  const scaleKeys = () =>
    screen
      .getAllByRole("button")
      .filter((b) => b.dataset.scale)
      .map((b) => b.getAttribute("aria-label")?.split(" ")[0])
      .sort();

  it("has two octaves, white and black keys", () => {
    const { synth } = fakeSynth();
    render(<Piano musicalKey={k("8A")} notation="alphanumeric" synth={synth} />);
    const group = screen.getByRole("group", { name: "Piano" });
    expect(within(group).getAllByRole("button", { name: /^[A-G]\d/ })).toHaveLength(15);
    expect(within(group).getAllByRole("button", { name: /^[A-G]♯\d/ })).toHaveLength(10);
  });

  it.each(NOTATIONS)("highlights the key's scale whatever the notation (%s)", (notation) => {
    const { synth } = fakeSynth();
    const written: Record<Notation, string> = {
      alphanumeric: "10B",
      open_key: "3d",
      classical: "D",
      classical_flat: "D",
    };
    const key = parseKey(written[notation]) as Key;
    render(<Piano musicalKey={key} notation={notation} synth={synth} />);
    // D major over C3–C5: every D E F♯ G A B C♯ in range.
    expect(scaleKeys()).toEqual([
      "C♯3", "D3", "E3", "F♯3", "G3", "A3", "B3", "C♯4", "D4", "E4", "F♯4", "G4", "A4", "B4",
    ].sort()); // prettier-ignore
    expect(pianoKey("D3")).toHaveAttribute("data-scale", "tonic");
    expect(pianoKey("E3")).toHaveAttribute("data-scale", "note");
    expect(screen.getByText("D E F♯ G A B C♯")).toBeInTheDocument();
  });

  it("plays notes with the mouse while held", () => {
    const { synth, released } = fakeSynth();
    render(<Piano musicalKey={k("8A")} notation="alphanumeric" synth={synth} />);
    fireEvent.pointerDown(pianoKey("A3"));
    expect(synth.start).toHaveBeenCalledWith(57);
    expect(pianoKey("A3")).toHaveAttribute("data-pressed", "true");
    fireEvent.pointerUp(pianoKey("A3"));
    expect(released).toEqual([57]);
    expect(pianoKey("A3")).not.toHaveAttribute("data-pressed");
  });

  it("plays with the computer keyboard when focused, Z/X change octave", async () => {
    const user = userEvent.setup();
    const { synth, released } = fakeSynth();
    render(<Piano musicalKey={k("8A")} notation="alphanumeric" synth={synth} />);
    expect(pianoKey("C3")).toHaveTextContent("A");
    screen.getByRole("group", { name: "Piano" }).focus();
    await user.keyboard("{a>}");
    expect(synth.start).toHaveBeenLastCalledWith(48);
    expect(pianoKey("C3")).toHaveAttribute("data-pressed", "true");
    await user.keyboard("{/a}");
    expect(released).toEqual([48]);
    await user.keyboard("x");
    expect(pianoKey("C4")).toHaveTextContent("A");
    await user.keyboard("w");
    expect(synth.start).toHaveBeenLastCalledWith(61);
    await user.keyboard("z");
    expect(pianoKey("C3")).toHaveTextContent("A");
  });

  it("each key is also a button for keyboard users (Enter plays it)", async () => {
    const { synth } = fakeSynth();
    render(<Piano musicalKey={k("8A")} notation="alphanumeric" synth={synth} />);
    pianoKey("E3").focus();
    await userEvent.keyboard("{Enter}");
    expect(synth.play).toHaveBeenCalledWith(52, 0, expect.any(Number));
  });

  it("plays the tonic chord and the scale", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { synth } = fakeSynth();
    render(<Piano musicalKey={k("8A")} notation="alphanumeric" synth={synth} />);
    await userEvent.click(screen.getByRole("button", { name: "Tocar acorde" }));
    expect(synth.play.mock.calls.map((c) => c[0])).toEqual([57, 60, 64]);
    expect(pianoKey("C4")).toHaveAttribute("data-pressed", "true");
    synth.play.mockClear();
    await userEvent.click(screen.getByRole("button", { name: "Tocar escala" }));
    expect(synth.play.mock.calls.map((c) => [c[0], c[1]])).toEqual(
      [57, 59, 60, 62, 64, 65, 67, 69].map((m, i) => [m, expect.closeTo(i * 0.32, 5)]),
    );
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getAllByRole("button").filter((b) => b.dataset.pressed)).toHaveLength(0);
    vi.useRealTimers();
  });

  it("can start the track to play along", async () => {
    const { synth } = fakeSynth();
    const onChange = vi.fn();
    render(
      <Piano
        musicalKey={k("8A")}
        notation="alphanumeric"
        synth={synth}
        withTrack={{ checked: false, onChange }}
      />,
    );
    await userEvent.click(screen.getByRole("switch", { name: "Tocar con el tema" }));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("works without a key (no scale) and in English", async () => {
    await i18n.changeLanguage("en");
    const { synth } = fakeSynth();
    render(<Piano musicalKey={null} notation="alphanumeric" synth={synth} />);
    expect(scaleKeys()).toEqual([]);
    expect(screen.getByRole("button", { name: "Play chord" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Play scale" })).toBeDisabled();
  });
});
