import type { TrackFilter } from "../../lib/rpc.types";

export type FilterCondition =
  | "keys"
  | "bpm"
  | "energy"
  | "genres"
  | "statuses"
  | "qualityIssues"
  | "favorites"
  | "playlistId"
  | "played"
  | "minPlays";

/** Active conditions in display order (one chip each). */
export function activeConditions(f: TrackFilter): FilterCondition[] {
  const out: FilterCondition[] = [];
  if (f.keys?.length) out.push("keys");
  if (f.bpmMin != null || f.bpmMax != null) out.push("bpm");
  if (f.energyMin != null || f.energyMax != null) out.push("energy");
  if (f.genres?.length) out.push("genres");
  if (f.statuses?.length) out.push("statuses");
  if (f.qualityIssues != null) out.push("qualityIssues");
  if (f.favorites) out.push("favorites");
  if (f.playlistId != null) out.push("playlistId");
  if (f.notPlayedDays != null || f.playedDays != null) out.push("played");
  if (f.minPlays != null) out.push("minPlays");
  return out;
}

/** The filter without one condition (and the options that only make sense with it). */
export function withoutCondition(f: TrackFilter, condition: FilterCondition): TrackFilter {
  const next = { ...f };
  switch (condition) {
    case "keys":
      delete next.keys;
      delete next.compatible;
      break;
    case "bpm":
      delete next.bpmMin;
      delete next.bpmMax;
      delete next.bpmHalfDouble;
      break;
    case "energy":
      delete next.energyMin;
      delete next.energyMax;
      break;
    case "genres":
      delete next.genres;
      break;
    case "statuses":
      delete next.statuses;
      break;
    case "qualityIssues":
      delete next.qualityIssues;
      break;
    case "favorites":
      delete next.favorites;
      break;
    case "playlistId":
      delete next.playlistId;
      break;
    case "played":
      delete next.notPlayedDays;
      delete next.playedDays;
      break;
    case "minPlays":
      delete next.minPlays;
      break;
  }
  return next;
}

/** True when the filter has at least one condition. */
export function hasConditions(f: TrackFilter): boolean {
  return activeConditions(f).length > 0;
}
