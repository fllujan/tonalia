// Music theory for the verification piano (SPEC 2.13): scales, the tonic chord, note
// spelling and the computer-keyboard layout.
import type { Key, Notation } from "../../lib/keys";

/** First and last MIDI notes of the on-screen piano: C3–C5, two octaves. */
export const LOW = 48;
export const HIGH = 72;

const MAJOR = [0, 2, 4, 5, 7, 9, 11] as const;
const NATURAL_MINOR = [0, 2, 3, 5, 7, 8, 10] as const;

export const isBlack = (midi: number) => [1, 3, 6, 8, 10].includes(midi % 12);

/** Semitone offsets of the key's scale from its tonic (major or natural minor). */
export function scaleSteps(key: Key): readonly number[] {
  return key.mode === "major" ? MAJOR : NATURAL_MINOR;
}

/** Pitch classes (0 = C) of the key's scale, tonic first. */
export function scalePitchClasses(key: Key): number[] {
  return scaleSteps(key).map((s) => (key.root + s) % 12);
}

/** MIDI notes of the ascending scale, tonic to octave, inside the piano's range. */
export function scaleNotes(key: Key): number[] {
  const tonic = LOW + key.root;
  return [...scaleSteps(key).map((s) => tonic + s), tonic + 12];
}

/** Root-position tonic triad (major or minor third + fifth). */
export function tonicChord(key: Key): number[] {
  const tonic = LOW + key.root;
  return [tonic, tonic + (key.mode === "major" ? 4 : 3), tonic + 7];
}

// ---- spelling ----

const LETTERS = ["C", "D", "E", "F", "G", "A", "B"] as const;
const LETTER_PC = [0, 2, 4, 5, 7, 9, 11] as const;
const SHARP_TONIC = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6] as const; // letter index, C♯ = C
const FLAT_TONIC = [0, 1, 1, 2, 2, 3, 4, 4, 5, 5, 6, 6] as const; // letter index, D♭ = D

/** Ties go to the SPEC 2.3 table: D♭, E♭, A♭ and B♭ (major or minor), otherwise sharps. */
const FLAT_ROOTS = new Set([1, 3, 8, 10]);
const ACCIDENTAL: Record<number, string> = { [-2]: "𝄫", [-1]: "♭", 0: "", 1: "♯", 2: "𝄪" };

function spellFrom(key: Key, tonicLetter: number): { names: string[]; cost: number } {
  let cost = 0;
  const names = scaleSteps(key).map((step, degree) => {
    const letter = (tonicLetter + degree) % 7;
    const pc = (key.root + step) % 12;
    let diff = (pc - (LETTER_PC[letter] ?? 0) + 12) % 12;
    if (diff > 6) diff -= 12;
    cost += Math.abs(diff);
    return `${LETTERS[letter]}${ACCIDENTAL[diff] ?? "?"}`;
  });
  return { names, cost };
}

/**
 * Scale note names, one letter per degree. The classical notations keep the tonic as the
 * key is written (C♯ or D♭) unless that needs double accidentals; the others use the
 * spelling with the fewest accidentals.
 */
export function spellScale(key: Key, notation: Notation): string[] {
  const sharp = spellFrom(key, SHARP_TONIC[key.root] ?? 0);
  const flat = spellFrom(key, FLAT_TONIC[key.root] ?? 0);
  const hasDouble = (s: { names: string[] }) => s.names.some((n) => /[𝄫𝄪]/u.test(n));
  const preferred = notation === "classical" ? sharp : notation === "classical_flat" ? flat : null;
  if (preferred && !hasDouble(preferred)) return preferred.names;
  if (flat.cost !== sharp.cost) return (flat.cost < sharp.cost ? flat : sharp).names;
  return (FLAT_ROOTS.has(key.root) ? flat : sharp).names;
}

// ---- computer keyboard ----

/** Physical keys (KeyboardEvent.code) → semitones above the keyboard's base C. */
export const KEYBOARD: readonly (readonly [string, number])[] = [
  ["KeyA", 0],
  ["KeyW", 1],
  ["KeyS", 2],
  ["KeyE", 3],
  ["KeyD", 4],
  ["KeyF", 5],
  ["KeyT", 6],
  ["KeyG", 7],
  ["KeyY", 8],
  ["KeyH", 9],
  ["KeyU", 10],
  ["KeyJ", 11],
  ["KeyK", 12],
  ["KeyO", 13],
  ["KeyL", 14],
  ["KeyP", 15],
];

/** The keyboard starts at C3 or C4; Z and X move it down or up an octave. */
export const BASES = [LOW, LOW + 12] as const;

export function noteForCode(code: string, base: number): number | null {
  const entry = KEYBOARD.find(([c]) => c === code);
  if (!entry) return null;
  const midi = base + entry[1];
  return midi <= HIGH ? midi : null;
}

/** Letter printed on a piano key for the current keyboard octave. */
export function codeForNote(midi: number, base: number): string | null {
  const entry = KEYBOARD.find(([, offset]) => base + offset === midi);
  return entry ? entry[0].replace("Key", "") : null;
}
