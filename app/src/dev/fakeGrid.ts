// The beatgrid editor's engine methods (SPEC 12.4) for the browser preview and the tests:
// the same answers as engine/tonalia_engine/grid.py, kept in memory.
import { type BeatGrid, beatTimes } from "../lib/beats";
import { toBeatGrid } from "../lib/gridEdit";
import type { Cue, GridResult, GridSpec, TrackDetail } from "../lib/rpc.types";

export interface FakeGridHost {
  detail: (trackId: number) => TrackDetail;
  /** Store these detail fields (and, when given, the cues) for the track. */
  patch: (trackId: number, fields: Partial<TrackDetail>, cues?: Cue[]) => void;
}

const ON_BEAT = 0.005;

function nearest(grid: BeatGrid, duration: number, at: number): number {
  let best = at;
  let distance = Infinity;
  for (const b of beatTimes(grid, duration)) {
    const d = Math.abs(b - at);
    if (d < distance) [distance, best] = [d, b];
  }
  return best;
}

export function createFakeGrid(host: FakeGridHost) {
  const auto = new Map<
    number,
    { beatGrid: NonNullable<TrackDetail["beatGrid"]> | null; bpm: number | null }
  >();
  const result = (trackId: number): GridResult => {
    const track = host.detail(trackId);
    const grid = track.beatGrid as BeatGrid | null;
    const duration = track.duration ?? 0;
    const offBeat = grid
      ? (track.cues ?? [])
          .filter((c) => c.source === "user")
          .filter((c) => Math.abs(nearest(grid, duration, c.positionSec) - c.positionSec) > ON_BEAT)
          .map((c) => c.slot)
      : [];
    return { track, offBeat };
  };
  const analysed = (trackId: number) => {
    const track = host.detail(trackId);
    if (!track.beatGrid)
      throw {
        code: -32602,
        message: "not analysed",
        data: { reason: "not_analysed", params: {}, detail: "", fields: null },
      };
    return track;
  };

  function call(method: string, params: unknown): GridResult | undefined {
    switch (method) {
      case "grid.update": {
        const { trackId, grid } = params as { trackId: number; grid: GridSpec };
        const track = analysed(trackId);
        if (!auto.has(trackId))
          auto.set(trackId, { beatGrid: track.beatGrid ?? null, bpm: track.bpm ?? null });
        const drawn = toBeatGrid(
          { bpm: grid.bpm, firstDownbeat: grid.firstDownbeat, anchors: grid.anchors ?? [] },
          track.duration ?? 600,
        );
        host.patch(trackId, {
          beatGrid: drawn as unknown as NonNullable<TrackDetail["beatGrid"]>,
          bpm: Math.round(drawn.bpm * 100) / 100,
          gridSource: "user",
          gridLocked: true,
        });
        return result(trackId);
      }
      case "grid.reset": {
        const { trackId } = params as { trackId: number };
        analysed(trackId);
        const saved = auto.get(trackId);
        auto.delete(trackId);
        host.patch(trackId, {
          ...(saved ? { beatGrid: saved.beatGrid, bpm: saved.bpm } : {}),
          gridSource: "auto",
          gridLocked: false,
        });
        return result(trackId);
      }
      case "grid.lock": {
        const { trackId, locked } = params as { trackId: number; locked: boolean };
        analysed(trackId);
        host.patch(trackId, { gridLocked: locked });
        return result(trackId);
      }
      case "grid.snapCues": {
        const { trackId, slots } = params as { trackId: number; slots: number[] };
        const track = analysed(trackId);
        const grid = track.beatGrid as unknown as BeatGrid;
        const cues = (track.cues ?? []).map((c) =>
          c.source === "user" && slots.includes(c.slot)
            ? { ...c, positionSec: nearest(grid, track.duration ?? 0, c.positionSec) }
            : c,
        );
        host.patch(trackId, {}, cues);
        return result(trackId);
      }
      default:
        return undefined;
    }
  }
  return { call };
}
