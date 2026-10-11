// Same test battery as engine/tests/test_keys.py, from the shared JSON cases.
import cases from "../../../engine/tests/data/keys_cases.json";
import {
  compatibility,
  formatKey,
  fromAlphanumeric,
  keysEqual,
  makeKey,
  type Mode,
  NOTATIONS,
  type Notation,
  parseKey,
  shift,
  wheelNumber,
} from "./keys";

const FIELD: Record<Notation, "alphanumeric" | "openKey" | "classical" | "classicalFlat"> = {
  alphanumeric: "alphanumeric",
  open_key: "openKey",
  classical: "classical",
  classical_flat: "classicalFlat",
};

describe("keys (shared cases)", () => {
  it.each(cases.notations)("notations of $alphanumeric", (c) => {
    const key = makeKey(c.root, c.mode as Mode);
    expect(fromAlphanumeric(c.alphanumeric)).toEqual(key);
    for (const notation of NOTATIONS) {
      expect(formatKey(key, notation)).toBe(c[FIELD[notation]]);
      expect(keysEqual(parseKey(c[FIELD[notation]]), key)).toBe(true);
    }
  });

  it("covers 24 distinct keys", () => {
    const set = new Set(cases.notations.map((c) => `${c.root}${c.mode}`));
    expect(set.size).toBe(24);
    const numbers = cases.notations
      .map((c) => wheelNumber(makeKey(c.root, c.mode as Mode)))
      .sort((a, b) => a - b);
    expect(numbers).toEqual([...Array(12).keys()].flatMap((i) => [i + 1, i + 1]));
  });

  it.each(cases.compatibility as [string, string, number, string][])(
    "%s -> %s = %d (%s)",
    (a, b, score, relation) => {
      const result = compatibility(fromAlphanumeric(a), fromAlphanumeric(b));
      expect(result.score).toBeCloseTo(score);
      expect(result.relation).toBe(relation);
    },
  );

  it.each(cases.shift as [string, number, string][])(
    "%s shifted %d -> %s",
    (key, semitones, expected) => {
      expect(formatKey(shift(fromAlphanumeric(key), semitones), "alphanumeric")).toBe(expected);
    },
  );

  it.each(cases.parse as [string, string | null][])("parses %j", (text, expected) => {
    const parsed = parseKey(text);
    expect(parsed ? formatKey(parsed, "alphanumeric") : null).toBe(expected);
  });

  it("shift composes and keeps the mode", () => {
    for (const c of cases.notations) {
      const key = makeKey(c.root, c.mode as Mode);
      for (let s = -12; s <= 12; s++) {
        expect(shift(key, s).mode).toBe(key.mode);
        expect(shift(shift(key, s), -s)).toEqual(key);
      }
    }
  });

  it("rejects invalid keys", () => {
    expect(() => makeKey(12, "major")).toThrow(RangeError);
    expect(() => fromAlphanumeric("13A")).toThrow(RangeError);
  });
});
