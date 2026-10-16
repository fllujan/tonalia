// The cue review methods (SPEC 12.5) for the browser preview and the tests, in memory and
// with the same answers as engine/tonalia_engine/cue_review.py.
import type {
  CueReviewItem,
  CueReviewQueue,
  CueReviewReport,
  CueReviewSetParams,
  CueReviewSetResult,
  TrackDetail,
  TrackSummary,
} from "../lib/rpc.types";

interface Review {
  id: number;
  trackId: number;
  slot: number | null;
  label: string | null;
  verdict: "ok" | "wrong" | "missing";
  position: number;
}

const ORDER = ["intro", "build", "drop", "breakdown", "build2", "drop2", "verse", "outro"];

export function createFakeCueReview(host: {
  tracks: () => TrackSummary[];
  detail: (trackId: number) => TrackDetail;
}) {
  let reviews: Review[] = [];
  let nextId = 1;

  const report = (): CueReviewReport => {
    const stats = new Map<string, { reviewed: number; wrong: number; missing: number }>();
    const row = (label: string) => {
      if (!stats.has(label)) stats.set(label, { reviewed: 0, wrong: 0, missing: 0 });
      return stats.get(label) as { reviewed: number; wrong: number; missing: number };
    };
    let reviewed = 0;
    let correct = 0;
    let missing = 0;
    for (const r of reviews) {
      const s = row(r.label ?? "unknown");
      if (r.verdict === "missing") {
        missing++;
        s.missing++;
        continue;
      }
      reviewed++;
      s.reviewed++;
      if (r.verdict === "ok") correct++;
      else s.wrong++;
    }
    const rank = (l: string) => (ORDER.includes(l) ? ORDER.indexOf(l) : ORDER.length);
    return {
      analysisVersion: "3.0",
      tracks: new Set(reviews.map((r) => r.trackId)).size,
      reviewedCues: reviewed,
      correct,
      accuracy: reviewed ? correct / reviewed : null,
      missing,
      bySection: [...stats]
        .sort(([a], [b]) => rank(a) - rank(b))
        .map(([label, s]) => ({ label, ...s })),
    };
  };

  const item = (trackId: number): CueReviewItem => {
    const d = host.detail(trackId);
    const cues = (d.cues ?? [])
      .filter((c) => c.source === "auto")
      .sort((a, b) => a.positionSec - b.positionSec);
    const mine = reviews.filter((r) => r.trackId === trackId);
    return {
      track: d,
      cues,
      segments: d.segments ?? [],
      barSeconds: d.bpm ? 240 / d.bpm : 0,
      verdicts: Object.fromEntries(
        mine.filter((r) => r.verdict !== "missing").map((r) => [String(r.slot), r.verdict]),
      ),
      missing: mine.filter((r) => r.verdict === "missing").map((r) => r.position),
    };
  };

  function call(method: string, params: unknown): unknown {
    switch (method) {
      case "cueReview.queue": {
        const { n = 20, trackIds = null } = (params ?? {}) as {
          n?: number;
          trackIds?: number[] | null;
        };
        const ids =
          trackIds ??
          host
            .tracks()
            .filter((t) => t.status === "ready")
            .map((t) => t.id)
            .filter((id) => {
              const autos = (host.detail(id).cues ?? []).filter((c) => c.source === "auto");
              return autos.some(
                (c) =>
                  !reviews.some(
                    (r) => r.trackId === id && r.slot === c.slot && r.verdict !== "missing",
                  ),
              );
            });
        return {
          items: ids.slice(0, n).map(item),
          report: report(),
        } satisfies CueReviewQueue;
      }
      case "cueReview.set": {
        const p = params as CueReviewSetParams;
        const d = host.detail(p.trackId);
        if (p.verdict === "missing") {
          const at = p.positionSec ?? 0;
          const seg = (d.segments ?? []).find((s) => s.start <= at && at < s.end);
          const id = nextId++;
          reviews.push({
            id,
            trackId: p.trackId,
            slot: null,
            label: seg?.label ?? null,
            verdict: "missing",
            position: at,
          });
          return { reviewId: id, report: report() } satisfies CueReviewSetResult;
        }
        const cue = (d.cues ?? []).find((c) => c.slot === p.slot);
        if (!cue) throw { code: -32602, message: "no cue in that slot" };
        reviews = reviews.filter(
          (r) => !(r.trackId === p.trackId && r.slot === p.slot && r.verdict !== "missing"),
        );
        const id = nextId++;
        reviews.push({
          id,
          trackId: p.trackId,
          slot: cue.slot,
          label: cue.label ?? null,
          verdict: p.verdict,
          position: cue.positionSec,
        });
        return { reviewId: id, report: report() } satisfies CueReviewSetResult;
      }
      case "cueReview.delete": {
        const { reviewId } = params as { reviewId: number };
        reviews = reviews.filter((r) => r.id !== reviewId);
        return report();
      }
      case "cueReview.report":
        return report();
      default:
        throw { code: -32601, message: `method not found: ${method}` };
    }
  }
  return { call };
}
