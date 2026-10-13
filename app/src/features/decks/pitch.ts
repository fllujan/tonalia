// Key change per deck (SPEC 2.15, task 8.4). Deck A's semitones go to the idea engine
// (`shiftA`), so the ideas are recalculated for A's shifted key. Deck B plays the idea's
// shift plus the user's own change; the "why" chips follow that manual change.
import { compatibility, type Key, shift } from "../../lib/keys";
import type { SuggestReason, Suggestion } from "../../lib/rpc.types";

export const SHIFT_LIMIT = 6;

export function clampShift(semitones: number): number {
  return Math.max(-SHIFT_LIMIT, Math.min(SHIFT_LIMIT, Math.round(semitones)));
}

/** Semitones B plays at: the idea's shift plus the user's change, within ±6. */
export function deckBShift(ideaShift: number, offset: number): number {
  return clampShift(ideaShift + offset);
}

/**
 * The idea's reasons with B at `shiftB` semitones instead of the idea's own shift: the key
 * relation (from A's shifted key) and the shift chip are recomputed, the rest is kept.
 */
export function adjustReasons(
  reasons: SuggestReason[],
  keyA: Key,
  keyB: Key,
  shiftB: number,
  ideaShift = reasons.find((r) => r.kind === "shift")?.value ?? 0,
): SuggestReason[] {
  if (shiftB === ideaShift) return reasons;
  const relation = compatibility(keyA, shift(keyB, shiftB)).relation;
  const out: SuggestReason[] = [];
  for (const r of reasons) {
    if (r.kind === "shift") continue;
    if (r.kind === "key") {
      out.push({ kind: "key", code: relation });
      if (shiftB) out.push({ kind: "shift", code: "b", value: shiftB });
    } else out.push(r);
  }
  return out;
}

/** The engine's weights behind an idea's score (`SuggestResult`). */
export interface ScoreWeights {
  keyWeight: number;
  shiftPenalty: number;
}

/**
 * The idea's score with B at `shiftB` semitones instead of the idea's own shift: only the key
 * score and the shift penalty change, so the rest of the engine's score is kept as it was.
 */
export function rescore(
  idea: Pick<Suggestion, "score" | "shiftB"> & { scores: Pick<Suggestion["scores"], "key"> },
  keyA: Key,
  keyB: Key,
  shiftB: number,
  { keyWeight, shiftPenalty }: ScoreWeights,
): number {
  if (shiftB === idea.shiftB) return idea.score;
  const key = compatibility(keyA, shift(keyB, shiftB)).score;
  const total =
    idea.score / 100 +
    keyWeight * (key - idea.scores.key) -
    shiftPenalty * (Math.abs(shiftB) - Math.abs(idea.shiftB));
  return Math.max(0, Math.round(total * 100));
}
