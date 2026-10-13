// "Revisar calidad" is a to-do list (SPEC 2.7): a track needs review while it has a quality
// flag the user has not marked as reviewed. Mirrors the engine's QUALITY_PENDING.
import type { TrackSummary } from "../../lib/rpc.types";

type QualityFlag = NonNullable<TrackSummary["qualityFlags"]>[number];

export function pendingQuality(
  track: Pick<TrackSummary, "qualityFlags" | "qualityReviewed">,
): QualityFlag[] {
  const reviewed = track.qualityReviewed ?? [];
  return (track.qualityFlags ?? []).filter((f) => !reviewed.includes(f));
}
