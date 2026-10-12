// A set shorter than asked (SPEC 2.17): the builder never pads with tracks that do not mix,
// so a small or half-analysed source gives a short set, and the screen has to say so.
export type Requested = { mode: "duration"; minutes: number } | { mode: "count"; count: number };

export interface Shortfall {
  mode: Requested["mode"];
  got: number;
  wanted: number;
}

/** Duration within 90 % of the minutes asked counts as reached (sets end on a track). */
const ENOUGH = 0.9;

export function shortfall(
  result: { duration: number; items: readonly unknown[] },
  requested: Requested | null,
): Shortfall | null {
  if (!requested) return null;
  if (requested.mode === "count") {
    const got = result.items.length;
    return got < requested.count ? { mode: "count", got, wanted: requested.count } : null;
  }
  const got = Math.round(result.duration / 60);
  return result.duration < requested.minutes * 60 * ENOUGH
    ? { mode: "duration", got, wanted: requested.minutes }
    : null;
}
