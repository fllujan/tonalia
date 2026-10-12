// `library.stats` for the component tests and the browser preview, from track summaries
// (engine/tonalia_engine/library.py: Library.stats).
import type { LibraryStats, TrackSummary } from "../lib/rpc.types";

export function fakeLibraryStats(tracks: TrackSummary[]): LibraryStats {
  const keys = new Map<string, { root: number; mode: "major" | "minor"; count: number }>();
  const energy = Array.from({ length: 10 }, () => 0);
  let analysed = 0;
  for (const t of tracks) {
    if (t.keyRoot != null || t.bpm != null) analysed++;
    if (t.keyRoot != null && t.keyMode) {
      const id = `${t.keyRoot}${t.keyMode}`;
      const entry = keys.get(id) ?? { root: t.keyRoot, mode: t.keyMode, count: 0 };
      entry.count++;
      keys.set(id, entry);
    }
    if (t.energy != null && t.energy >= 1 && t.energy <= 10)
      energy[t.energy - 1] = (energy[t.energy - 1] ?? 0) + 1;
  }
  return {
    total: tracks.length,
    analysed,
    keys: [...keys.values()].sort((a, b) => b.count - a.count),
    energy,
  };
}
