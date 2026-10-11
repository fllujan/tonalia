import type { TrackFilter } from "../../lib/rpc.types";

/** True when the filter has at least one condition. */
export function hasConditions(f: TrackFilter): boolean {
  return Boolean(
    f.keys?.length ||
    f.bpmMin != null ||
    f.bpmMax != null ||
    f.energyMin != null ||
    f.energyMax != null ||
    f.genres?.length ||
    f.statuses?.length ||
    f.qualityIssues != null ||
    f.favorites,
  );
}
