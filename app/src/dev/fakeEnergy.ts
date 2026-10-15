// Browser preview of the personal energy methods (SPEC 12.2): ratings kept in memory, a
// queue over the sample tracks and a calibration that "fits" by nudging levels towards the
// ratings, so the whole screen can be tried without the engine.
import type {
  EnergyCalibrateResult,
  EnergyImportPreview,
  EnergyRatingQueue,
  EnergyStatus,
  TrackSummary,
} from "../lib/rpc.types";

const NEEDED = 30;

export function createFakeEnergy(
  getTracks: () => TrackSummary[],
  setTracks: (update: (tracks: TrackSummary[]) => TrackSummary[]) => void,
) {
  const ratings = new Map<number, number>();
  const original = new Map<number, number | null>();
  let model: "default" | "personal" = "default";
  let report: EnergyStatus["calibration"] = null;
  // ?ratings=29 starts the preview with that many ratings (to see the calibrate step).
  const seed = Number(new URLSearchParams(window.location.search).get("ratings") ?? 0);
  getTracks()
    .filter((t) => t.status === "ready" && t.energy != null)
    .slice(0, seed)
    .forEach((t, i) => ratings.set(t.id, Math.min(10, Math.max(1, (t.energy ?? 5) + (i % 3) - 1))));

  const ready = () => getTracks().filter((t) => t.status === "ready" && t.energy != null);
  const status = (): EnergyStatus => {
    const histogram = Array.from({ length: 10 }, () => 0);
    ratings.forEach((r) => (histogram[r - 1] = (histogram[r - 1] ?? 0) + 1));
    return {
      ratings: ratings.size,
      usable: ratings.size,
      needed: NEEDED,
      model,
      calibration: report,
      histogram,
      needsReanalysis: 0,
    };
  };
  const mae = () => {
    const errors = [...ratings].map(([id, r]) => {
      const t = getTracks().find((x) => x.id === id);
      return Math.abs((original.get(id) ?? t?.energy ?? r) - r);
    });
    return errors.length ? errors.reduce((a, b) => a + b, 0) / errors.length : 0;
  };
  const recompute = (personal: boolean) => {
    setTracks((tracks) =>
      tracks.map((t) => {
        if (t.energy == null || t.editedFields?.includes("energy")) return t;
        if (!original.has(t.id)) original.set(t.id, t.energy);
        const base = original.get(t.id) ?? t.energy;
        const rated = ratings.get(t.id);
        const energy = personal && rated != null ? rated : base;
        return { ...t, energy };
      }),
    );
    return ready().length;
  };

  function call(method: string, p: unknown): unknown {
    switch (method) {
      case "energy.status":
        return status();
      case "energy.ratingQueue": {
        const n = (p as { n?: number } | null)?.n ?? 20;
        const items = ready()
          .filter((t) => !ratings.has(t.id))
          .slice(0, n)
          .map((track) => ({ track, start: 60, energy: track.energy ?? 5 }));
        return { items, status: status() } satisfies EnergyRatingQueue;
      }
      case "energy.rate": {
        const { trackId, rating } = p as { trackId: number; rating: number | null };
        if (rating == null) ratings.delete(trackId);
        else ratings.set(trackId, rating);
        return status();
      }
      case "energy.calibrate": {
        if (ratings.size < NEEDED)
          throw {
            code: -32602,
            message: "not enough ratings",
            data: {
              reason: "not_enough_ratings",
              params: { count: String(ratings.size), needed: String(NEEDED) },
            },
          };
        const apply = (p as { apply?: boolean } | null)?.apply ?? false;
        const before = Math.max(0.6, mae());
        const after = Math.round(before * 55) / 100;
        let updated = 0;
        if (apply) {
          model = "personal";
          report = {
            tracks: ratings.size,
            maeBefore: before,
            maeAfter: after,
            calibratedAt: new Date().toISOString(),
          };
          updated = recompute(true);
        }
        return {
          tracks: ratings.size,
          maeBefore: before,
          maeAfter: after,
          applied: apply,
          updated,
          status: status(),
        } satisfies EnergyCalibrateResult;
      }
      case "energy.revert":
        model = "default";
        return { updated: recompute(false), status: status() };
      case "energy.importPreview": {
        const items = ready()
          .slice(0, 4)
          .map((t, i) => ({
            trackId: t.id,
            title: t.title,
            artist: t.artist,
            field: i % 2 ? ("grouping" as const) : ("comment" as const),
            text: i % 2 ? `E${t.energy ?? 5}` : `Energy ${t.energy ?? 5} · warm-up`,
            rating: t.energy ?? 5,
            existing: ratings.get(t.id) ?? null,
          }));
        return {
          items,
          scanned: getTracks().length,
          writtenByTonalia: 1,
          unreadable: 0,
        } satisfies EnergyImportPreview;
      }
      case "energy.import": {
        const { items, overwrite } = p as {
          items: { trackId: number; rating: number }[];
          overwrite?: boolean;
        };
        let stored = 0;
        for (const { trackId, rating } of items) {
          if (ratings.has(trackId) && !overwrite) continue;
          ratings.set(trackId, rating);
          stored += 1;
        }
        return { stored, status: status() };
      }
      default:
        throw { code: -32601, message: `method not found: ${method}` };
    }
  }
  return { call };
}
