// In-memory `builder.*` for the component tests and the browser preview: a simplified
// engine/tonalia_engine/playlist_builder.py (greedy instead of beam search) that answers
// with the same shapes — curve targets, DJ Mix transitions, clashes, alternatives.
import { compatibility, makeKey } from "../lib/keys";
import type {
  BuilderAlternative,
  BuilderAlternativesParams,
  BuilderGenerateParams,
  BuilderItem,
  BuilderResult,
  BuilderScoreParams,
  BuilderTransition,
  EnergyCurve,
  TrackSummary,
} from "../lib/rpc.types";

const fail = (message: string) => ({ code: -32602, message });

const ACAPELLA = /(^|[^\p{L}])a\s?cc?app?ellas?($|[^\p{L}])/iu;
const isAcapella = (t: TrackSummary) => ACAPELLA.test(`${t.title ?? ""} ${t.genre ?? ""}`);

const PRESETS: Record<string, [number, number][]> = {
  warmup_peak_cooldown: [
    [0, 4],
    [0.6, 9],
    [0.85, 9],
    [1, 6],
  ],
  ascending: [
    [0, 4],
    [1, 9],
  ],
};

export function fakeCurveTargets(curve: EnergyCurve | undefined, count: number, flat: number) {
  const preset = curve?.preset ?? "warmup_peak_cooldown";
  if (preset === "flat") return Array.from({ length: count }, () => flat);
  const points =
    preset === "custom"
      ? [...(curve?.points ?? [])]
          .map((p) => [p.x, p.energy] as [number, number])
          .sort((a, b) => a[0] - b[0])
      : (PRESETS[preset] ?? []);
  return Array.from({ length: count }, (_, i) => {
    const x = count > 1 ? i / (count - 1) : 0;
    const right = points.findIndex(([px]) => px >= x);
    if (right <= 0) return points[Math.max(0, right)]?.[1] ?? 6;
    const [x0, y0] = points[right - 1] as [number, number];
    const [x1, y1] = points[right] as [number, number];
    return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0 || 1);
  });
}

function transition(a: TrackSummary, b: TrackSummary): BuilderTransition {
  const ka = makeKey(a.keyRoot ?? 0, a.keyMode ?? "major");
  const kb = makeKey(b.keyRoot ?? 0, b.keyMode ?? "major");
  const { score: key, relation } = compatibility(ka, kb);
  const delta = a.bpm && b.bpm ? ((b.bpm - a.bpm) / a.bpm) * 100 : 0;
  const bpm = Math.max(0, 1 - Math.abs(delta) / 6);
  const energy =
    a.energy != null && b.energy != null ? Math.max(0, 1 - Math.abs(b.energy - a.energy) / 4) : 0.5;
  const genre = a.genre && a.genre === b.genre ? 1 : 0;
  const score = Math.round((0.4 * key + 0.3 * bpm + 0.2 * energy + 0.1 * genre) * 1e4) / 1e4;
  const clash = key <= 0;
  return {
    score,
    quality: clash || score < 0.4 ? "bad" : score >= 0.7 ? "good" : "fair",
    clash,
    relation,
    shift: 0,
    bpmFactor: 1,
    bpmDelta: Math.round(delta * 100) / 100,
    energyDelta: a.energy != null && b.energy != null ? b.energy - a.energy : null,
    scores: { key, bpm, energy, vocal: 0, genre },
  };
}

export function createFakeBuilder(
  getTracks: () => TrackSummary[],
  playlistTracks: (playlistId: number) => number[],
) {
  const analysed = (ids: number[]) =>
    ids
      .map((id) => getTracks().find((t) => t.id === id))
      .filter((t): t is TrackSummary => t != null && t.keyRoot != null && t.bpm != null);
  const median = (tracks: TrackSummary[]) => {
    const e = tracks
      .map((t) => t.energy)
      .filter((x): x is number => x != null)
      .sort((a, b) => a - b);
    return e.length ? (e[Math.floor(e.length / 2)] ?? 6) : 6;
  };

  const mixes = (a: TrackSummary, b: TrackSummary) => transition(a, b).scores.key > 0;
  const result = (
    order: TrackSummary[],
    curve: EnergyCurve | undefined,
    pool: TrackSummary[],
    skipped = 0,
    judgeClashes = false,
  ): BuilderResult => {
    const targets = fakeCurveTargets(curve, order.length, median(pool));
    // Like the engine: on a clash in a generated set, the pool tracks left out that would
    // mix with both neighbours (0 = unavoidable).
    const outside = pool.filter((t) => !order.includes(t));
    const items: BuilderItem[] = order.map((track, i) => {
      const prev = order[i - 1];
      if (!prev)
        return { track, targetEnergy: Math.round((targets[i] ?? 6) * 100) / 100, transition: null };
      const tr = transition(prev, track);
      const next = order[i + 1];
      if (tr.clash && judgeClashes)
        tr.mixableOutside = outside.filter(
          (c) => mixes(prev, c) && (!next || mixes(c, next)),
        ).length;
      return { track, targetEnergy: Math.round((targets[i] ?? 6) * 100) / 100, transition: tr };
    });
    const moves = items.flatMap((it) => (it.transition ? [it.transition] : []));
    return {
      items,
      meanScore: moves.length
        ? Math.round((moves.reduce((s, t) => s + t.score, 0) / moves.length) * 1e4) / 1e4
        : 0,
      clashes: moves.filter((t) => t.clash).length,
      duration: order.reduce((s, t) => s + (t.duration ?? 360), 0),
      poolSize: pool.length,
      skipped,
      elapsedMs: 3,
    };
  };

  const poolOf = (p: { playlistId?: number | null; trackIds?: number[] } | undefined) => {
    const ids = [
      ...(p?.trackIds ?? []),
      ...(p?.playlistId != null ? playlistTracks(p.playlistId) : []),
    ];
    return { ids: [...new Set(ids)], tracks: analysed([...new Set(ids)]) };
  };

  return {
    call(method: string, params: unknown): unknown {
      switch (method) {
        case "builder.generate": {
          const p = params as BuilderGenerateParams;
          const { ids, tracks } = poolOf(p.pool);
          if (!tracks.length) throw fail("the pool has no analysed tracks");
          const mean = tracks.reduce((s, t) => s + (t.duration ?? 360), 0) / tracks.length;
          const want = p.count ?? (p.durationMin ? Math.ceil((p.durationMin * 60) / mean) : 20);
          const count = Math.max(1, Math.min(want, tracks.length));
          const left = [...tracks];
          const first =
            p.startTrackId != null ? left.find((t) => t.id === p.startTrackId) : left[0];
          if (!first) throw fail("the first track is not an analysed track of the pool");
          const order = [first];
          left.splice(left.indexOf(first), 1);
          while (order.length < count && left.length) {
            const last = order[order.length - 1] as TrackSummary;
            // Like the engine: an acapella only fills a gap (nothing to mix in or out of).
            const rank = (t: TrackSummary) =>
              transition(last, t).score - (isAcapella(last) || isAcapella(t) ? 0.5 : 0);
            left.sort((a, b) => rank(b) - rank(a) || a.id - b.id);
            order.push(left.shift() as TrackSummary);
          }
          return result(order, p.curve, tracks, ids.length - tracks.length, true);
        }
        case "builder.score": {
          const p = params as BuilderScoreParams;
          const order = analysed(p.trackIds);
          if (order.length !== p.trackIds.length) throw fail("not an analysed track");
          return result(order, p.curve, order);
        }
        case "builder.alternatives": {
          const p = params as BuilderAlternativesParams;
          const order = analysed(p.trackIds);
          const at = p.position;
          if (at >= order.length) throw fail("position outside the set");
          const pool =
            p.pool?.trackIds?.length || p.pool?.playlistId != null
              ? poolOf(p.pool).tracks
              : analysed(getTracks().map((t) => t.id));
          const prev = order[at - 1];
          const next = order[at + 1];
          const local = (c: TrackSummary) =>
            (prev ? transition(prev, c).score : 0) + (next ? transition(c, next).score : 0);
          const current = local(order[at] as TrackSummary);
          const items: BuilderAlternative[] = pool
            .filter((c) => !p.trackIds.includes(c.id))
            .sort((a, b) => local(b) - local(a) || a.id - b.id)
            .slice(0, p.limit ?? 10)
            .map((c) => ({
              track: c,
              delta: Math.round((local(c) - current) * 1e4) / 1e4,
              into: prev ? transition(prev, c) : null,
              out: next ? transition(c, next) : null,
            }));
          return { items };
        }
        default:
          throw { code: -32601, message: `method not found: ${method}` };
      }
    },
  };
}
