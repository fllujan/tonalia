// Simplified idea engine for the browser preview and component tests (the real one is
// engine/tonalia_engine/suggest.py): key + BPM scores with B shifted by up to ±2.
import { compatibility, makeKey, shift } from "../lib/keys";
import type { SuggestParams, SuggestResult, Suggestion, TrackSummary } from "../lib/rpc.types";

export function fakeSuggest(
  tracks: TrackSummary[],
  params: SuggestParams,
  mode: "mashup" | "mix",
): SuggestResult {
  const a = tracks.find((t) => t.id === params.trackId);
  if (!a || a.keyRoot == null || !a.keyMode || a.bpm == null)
    throw { code: -32602, message: "the track is not analysed yet (it needs a key and a BPM)" };
  const keyA = shift(makeKey(a.keyRoot, a.keyMode), params.shiftA ?? 0);
  const f = params.filters ?? {};
  const tolerance = mode === "mashup" ? 0.1 : 0.06;
  const maxShift = params.allowShift === false ? 0 : (params.maxShift ?? 2);
  const pool = tracks.filter(
    (t) =>
      t.id !== a.id &&
      t.keyRoot != null &&
      t.keyMode &&
      t.bpm != null &&
      !(params.exclude ?? []).includes(t.id) &&
      (f.energyMin == null || (t.energy ?? 0) >= f.energyMin) &&
      (f.energyMax == null || (t.energy ?? 99) <= f.energyMax) &&
      (f.bpmMin == null || (t.bpm ?? 0) >= f.bpmMin) &&
      (f.bpmMax == null || (t.bpm ?? 0) <= f.bpmMax) &&
      (!f.genres?.length ||
        f.genres.some((g) => g.toLowerCase() === (t.genre ?? "").toLowerCase())),
  );
  const items: Suggestion[] = pool.map((b) => {
    const original = makeKey(b.keyRoot as number, b.keyMode as "major" | "minor");
    let best = { score: -1, shiftB: 0, relation: compatibility(keyA, original) };
    for (const s of [0, 1, -1, 2, -2].filter((n) => Math.abs(n) <= maxShift)) {
      const c = compatibility(keyA, shift(original, s));
      const score = c.score - 0.05 * Math.abs(s);
      if (score > best.score) best = { score, shiftB: s, relation: c };
    }
    const delta = ((b.bpm as number) - (a.bpm as number)) / (a.bpm as number);
    const bpm = Math.max(0, 1 - Math.abs(delta) / tolerance);
    const keyScore = Math.max(0, best.score);
    const total = Math.round(
      100 * (mode === "mashup" ? 0.6 * keyScore + 0.4 * bpm : 0.55 * keyScore + 0.45 * bpm),
    );
    const keyB = shift(original, best.shiftB);
    const reasons: Suggestion["reasons"] = [{ kind: "key", code: best.relation.relation }];
    if (best.shiftB) reasons.push({ kind: "shift", code: "b", value: best.shiftB });
    reasons.push({ kind: "bpm", code: "same", value: Math.round(delta * 1000) / 10 });
    if (a.energy != null && b.energy != null) {
      const step = b.energy - a.energy;
      reasons.push({
        kind: "energy",
        code: step === 0 ? "same" : step > 0 ? "up" : "down",
        value: step,
      });
    }
    if (a.genre && a.genre === b.genre) reasons.push({ kind: "genre", code: "same" });
    return {
      track: b,
      score: total,
      shiftB: best.shiftB,
      keyB: { root: keyB.root, mode: keyB.mode },
      relation: best.relation.relation,
      bpmFactor: 1,
      scores: { key: keyScore, bpm, energy: 0.5, vocal: 0, genre: 0 },
      reasons,
    };
  });
  items.sort((x, y) => y.score - x.score || x.track.id - y.track.id);
  return {
    mode,
    trackId: a.id,
    shiftA: params.shiftA ?? 0,
    candidates: pool.length,
    items: items.slice(0, params.limit ?? 50),
    elapsedMs: 1,
  };
}
