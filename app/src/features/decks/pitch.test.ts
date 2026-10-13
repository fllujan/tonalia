import { makeKey } from "../../lib/keys";
import type { SuggestReason } from "../../lib/rpc.types";
import { adjustReasons, clampShift, deckBShift, rescore, SHIFT_LIMIT } from "./pitch";

describe("deck pitch", () => {
  it("clamps every deck to ±6 semitones", () => {
    expect(SHIFT_LIMIT).toBe(6);
    expect(clampShift(9)).toBe(6);
    expect(clampShift(-7)).toBe(-6);
    expect(clampShift(3)).toBe(3);
  });

  it("adds the user's change to the idea's shift of B", () => {
    expect(deckBShift(-2, 0)).toBe(-2);
    expect(deckBShift(-2, 3)).toBe(1);
    expect(deckBShift(2, 6)).toBe(6);
  });

  it("rewrites the key and shift reasons for a manual change of B", () => {
    const reasons: SuggestReason[] = [
      { kind: "key", code: "same" },
      { kind: "shift", code: "b", value: -2 },
      { kind: "bpm", code: "same", value: 0 },
    ];
    // A = 8A; B = 10A shifted −2 is 8A (same). The user moves B to −1: 10A −1 = 3A, +7 on the wheel from 8A.
    const keyA = makeKey(9, "minor");
    const keyB = makeKey(11, "minor");
    expect(adjustReasons(reasons, keyA, keyB, -2)).toBe(reasons);
    expect(adjustReasons(reasons, keyA, keyB, -1)).toEqual([
      { kind: "key", code: "semitone_up" },
      { kind: "shift", code: "b", value: -1 },
      { kind: "bpm", code: "same", value: 0 },
    ]);
    expect(adjustReasons(reasons, keyA, keyB, 0)).toEqual([
      { kind: "key", code: "energy_boost" },
      { kind: "bpm", code: "same", value: 0 },
    ]);
    // A shift that was not there gets its chip after the key.
    expect(adjustReasons([{ kind: "key", code: "energy_boost" }], keyA, keyB, -2, 0)).toEqual([
      { kind: "key", code: "same" },
      { kind: "shift", code: "b", value: -2 },
    ]);
  });

  it("rescores B's manual key change with the engine's weights", () => {
    const weights = { keyWeight: 0.45, shiftPenalty: 0.05 };
    // A = 8A; B = 10A, which the idea plays −2 semitones (8A, "same") for a score of 90.
    const idea = { score: 90, shiftB: -2, scores: { key: 1 } };
    const keyA = makeKey(9, "minor");
    const keyB = makeKey(11, "minor");
    expect(rescore(idea, keyA, keyB, -2, weights)).toBe(90);
    // Back to 0: 10A is a +2 energy boost (0.55) and the shift penalty goes away.
    // 0.90 + 0.45 × (0.55 − 1) + 0.05 × 2 = 0.7975.
    expect(rescore(idea, keyA, keyB, 0, weights)).toBe(80);
    // +3: 10A + 3 semitones (+21 ≡ +9 on the wheel) is 7A, one step from 8A (0.9).
    // 0.90 + 0.45 × (0.9 − 1) − 0.05 × (3 − 2) = 0.805.
    expect(rescore(idea, keyA, keyB, 3, weights)).toBe(81);
    // Never below 0.
    expect(rescore({ score: 10, shiftB: 0, scores: { key: 1 } }, keyA, keyA, 6, weights)).toBe(0);
  });
});
