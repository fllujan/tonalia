// Simplified idea engine for the browser preview and component tests (the real one is
// engine/tonalia_engine/suggest.py): key + BPM scores with B shifted by up to ±2.
import { compatibility, makeKey, shift } from "../lib/keys";
import { playedWithin } from "./fakeHistory";
import type { SuggestParams, SuggestResult, Suggestion, TrackSummary } from "../lib/rpc.types";

// Like the engine's suggest_weights.json: the key weight per mode and the cost per semitone.
const KEY_WEIGHT = { mashup: 0.6, mix: 0.45 } as const;
const SHIFT_PENALTY = 0.05;
const ACAPELLA = /(^|[^\p{L}])a\s?cc?app?ellas?($|[^\p{L}])/iu;

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
  const playedRecently = pool.filter((t) => playedWithin(t, params.avoidPlayedDays)).length;
  const fresh = playedRecently
    ? pool.filter((t) => !playedWithin(t, params.avoidPlayedDays))
    : pool;
  const items: Suggestion[] = fresh.map((b) => {
    const original = makeKey(b.keyRoot as number, b.keyMode as "major" | "minor");
    let best = { score: -1, shiftB: 0, relation: compatibility(keyA, original) };
    for (const s of [0, 1, -1, 2, -2].filter((n) => Math.abs(n) <= maxShift)) {
      const c = compatibility(keyA, shift(original, s));
      const score = c.score - SHIFT_PENALTY * Math.abs(s);
      if (score > best.score) best = { score, shiftB: s, relation: c };
    }
    const delta = ((b.bpm as number) - (a.bpm as number)) / (a.bpm as number);
    const bpm = Math.max(0, 1 - Math.abs(delta) / tolerance);
    const keyScore = best.relation.score;
    // Like the engine: an acapella has nothing to mix into, so DJ Mix ranks it last.
    const acapella = mode === "mix" && ACAPELLA.test(`${b.title ?? ""} ${b.genre ?? ""}`);
    // Like the engine: DJ Mix prefers the energy step the DJ asked for (keep, up or down).
    const step = a.energy != null && b.energy != null ? b.energy - a.energy : null;
    const [low, high] = { keep: [0, 0], up: [0, 1], down: [-1, 0] }[
      params.energyDirection ?? "up"
    ] as [number, number];
    const energy =
      step == null
        ? 0.5
        : Math.max(0, 1 - (Math.max(low - step, 0) + Math.max(step - high, 0)) / 3);
    const total = Math.max(
      0,
      Math.round(
        100 *
          (KEY_WEIGHT[mode] * keyScore +
            (mode === "mashup" ? 0.4 * bpm : 0.35 * bpm + 0.2 * energy) -
            SHIFT_PENALTY * Math.abs(best.shiftB)) -
          (acapella ? 50 : 0),
      ),
    );
    const keyB = shift(original, best.shiftB);
    const reasons: Suggestion["reasons"] = [{ kind: "key", code: best.relation.relation }];
    if (best.shiftB) reasons.push({ kind: "shift", code: "b", value: best.shiftB });
    reasons.push({ kind: "bpm", code: "same", value: Math.round(delta * 1000) / 10 });
    // Like the engine: in a mashup an acapella is the voice, the other deck the music.
    const vocalA = ACAPELLA.test(`${a.title ?? ""} ${a.genre ?? ""}`);
    const vocalB = ACAPELLA.test(`${b.title ?? ""} ${b.genre ?? ""}`);
    if (mode === "mashup" && vocalA !== vocalB)
      reasons.push({ kind: "vocals", code: vocalA ? "a" : "b" });
    if (a.energy != null && b.energy != null) {
      const step = b.energy - a.energy;
      reasons.push({
        kind: "energy",
        code: step === 0 ? "same" : step > 0 ? "up" : "down",
        value: step,
      });
    }
    if (a.genre && a.genre === b.genre) reasons.push({ kind: "genre", code: "same" });
    if (acapella) reasons.push({ kind: "acapella", code: "mix" });
    return {
      track: b,
      score: total,
      shiftB: best.shiftB,
      keyB: { root: keyB.root, mode: keyB.mode },
      relation: best.relation.relation,
      bpmFactor: 1,
      scores: { key: keyScore, bpm, energy, vocal: 0, genre: 0 },
      reasons,
    };
  });
  items.sort((x, y) => y.score - x.score || x.track.id - y.track.id);
  return {
    mode,
    trackId: a.id,
    shiftA: params.shiftA ?? 0,
    candidates: fresh.length,
    playedRecently,
    items: items.slice(0, params.limit ?? 50),
    elapsedMs: 1,
    keyWeight: KEY_WEIGHT[mode],
    shiftPenalty: SHIFT_PENALTY,
  };
}
