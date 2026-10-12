import { makeKey } from "../../lib/keys";
import type { SuggestReason } from "../../lib/rpc.types";
import { adjustReasons, clampShift, deckBShift, SHIFT_LIMIT } from "./pitch";

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
});
