// Musical keys: notations, harmonic-wheel compatibility and pitch shifting (SPEC 2.3).
// Mirror of engine/tonalia_engine/keys.py; both are tested against
// engine/tests/data/keys_cases.json. Keep them in sync.

export type Mode = "major" | "minor";
export type Notation = "alphanumeric" | "open_key" | "classical" | "classical_flat";
export type Relation =
  "same" | "adjacent" | "relative" | "diagonal" | "energy_boost" | "semitone_up" | "none";

export interface Key {
  readonly root: number; // pitch class, C = 0 … B = 11
  readonly mode: Mode;
}

export const NOTATIONS: readonly Notation[] = [
  "alphanumeric",
  "open_key",
  "classical",
  "classical_flat",
];

const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;
const FLAT_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"] as const;

export const SCORES: Readonly<Record<Relation, number>> = {
  same: 1.0,
  adjacent: 0.9,
  relative: 0.85,
  diagonal: 0.6,
  energy_boost: 0.55,
  semitone_up: 0.5,
  none: 0.0,
};

const mod = (n: number, m: number) => ((n % m) + m) % m;

export function makeKey(root: number, mode: Mode): Key {
  if (!Number.isInteger(root) || root < 0 || root > 11)
    throw new RangeError(`root must be 0-11, got ${root}`);
  return { root, mode };
}

export function keysEqual(a: Key | null, b: Key | null): boolean {
  return a === b || (!!a && !!b && a.root === b.root && a.mode === b.mode);
}

/** 1–12 position on the harmonic wheel (circle of fifths, 8 = C major / A minor). */
export function wheelNumber(key: Key): number {
  const majorRoot = key.mode === "major" ? key.root : mod(key.root + 3, 12);
  return mod(7 * majorRoot + 7, 12) + 1;
}

export function wheelLetter(key: Key): "A" | "B" {
  return key.mode === "major" ? "B" : "A";
}

export function fromWheel(n: number, letter: string): Key {
  const l = letter.toUpperCase();
  if (!Number.isInteger(n) || n < 1 || n > 12 || (l !== "A" && l !== "B")) {
    throw new RangeError(`invalid wheel position ${n}${letter}`);
  }
  const majorRoot = mod(7 * (n - 8), 12);
  return l === "B" ? makeKey(majorRoot, "major") : makeKey(mod(majorRoot + 9, 12), "minor");
}

export function fromAlphanumeric(text: string): Key {
  const m = /^\s*0?(\d{1,2})\s*([ABab])\s*$/.exec(text);
  if (!m) throw new RangeError(`not an alphanumeric key: ${text}`);
  return fromWheel(Number(m[1]), m[2] as string);
}

export function formatKey(key: Key, notation: Notation): string {
  const n = wheelNumber(key);
  switch (notation) {
    case "alphanumeric":
      return `${n}${wheelLetter(key)}`;
    case "open_key":
      return `${mod(n + 4, 12) + 1}${key.mode === "major" ? "d" : "m"}`;
    case "classical":
      return SHARP_NAMES[key.root] + (key.mode === "minor" ? "m" : "");
    case "classical_flat":
      return FLAT_NAMES[key.root] + (key.mode === "minor" ? "m" : "");
  }
}

const NOTE_VALUES: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const CLASSICAL = /^([A-Ga-g])\s*([#♯b♭]?)\s*(m|min|minor|maj|major|dur|moll)?$/i;

/** Parse a key written in any supported notation (as found in file tags). */
export function parseKey(text: string): Key | null {
  const s = text.trim();
  if (!s) return null;
  const alnum = /^0?(\d{1,2})\s*([ABab])$/.exec(s);
  if (alnum) {
    const n = Number(alnum[1]);
    return n >= 1 && n <= 12 ? fromWheel(n, alnum[2] as string) : null;
  }
  const open = /^0?(\d{1,2})\s*([mdMD])$/.exec(s);
  if (open) {
    const n = Number(open[1]);
    if (n < 1 || n > 12) return null;
    return fromWheel(mod(n - 6, 12) + 1, (open[2] as string).toLowerCase() === "m" ? "A" : "B");
  }
  const c = CLASSICAL.exec(s);
  if (!c) return null;
  const [, letter = "", accidental = "", quality] = c;
  let root = NOTE_VALUES[letter.toUpperCase()] ?? 0;
  if (accidental === "#" || accidental === "♯") root += 1;
  else if (accidental === "b" || accidental === "♭") root -= 1;
  const q = (quality ?? "").toLowerCase();
  // "CM" is the conventional shorthand for C major.
  const mode: Mode =
    q === "m" && quality === "M"
      ? "major"
      : ["m", "min", "minor", "moll"].includes(q)
        ? "minor"
        : "major";
  return makeKey(mod(root, 12), mode);
}

export interface Compatibility {
  score: number;
  relation: Relation;
}

/** Score for mixing from key `a` into key `b` (SPEC 2.3 table). */
export function compatibility(a: Key, b: Key): Compatibility {
  const step = mod(wheelNumber(b) - wheelNumber(a), 12);
  const sameLetter = a.mode === b.mode;
  let relation: Relation;
  if (sameLetter && step === 0) relation = "same";
  else if (sameLetter && (step === 1 || step === 11)) relation = "adjacent";
  else if (!sameLetter && step === 0) relation = "relative";
  else if (
    !sameLetter &&
    ((a.mode === "minor" && step === 1) || (a.mode === "major" && step === 11))
  )
    relation = "diagonal";
  else if (sameLetter && step === 2) relation = "energy_boost";
  else if (sameLetter && step === 7) relation = "semitone_up";
  else relation = "none";
  return { score: SCORES[relation], relation };
}

/** Transpose by `semitones`: +1 semitone moves +7 on the wheel, same letter. */
export function shift(key: Key, semitones: number): Key {
  return makeKey(mod(key.root + semitones, 12), key.mode);
}
