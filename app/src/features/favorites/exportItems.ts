// The two files of a favorite for the DAW (SPEC 2.15 and 2.16).
import type { StemExportItem } from "../../lib/rpc.types";
import type { ExportCombination } from "./favoritesStore";

/** Deck A and deck B as files: processed = key changes applied and B at A's tempo. */
export function exportItems(
  c: ExportCombination,
  processed: boolean,
): [StemExportItem, StemExportItem] {
  const factor = c.bpmFactor ?? 1;
  return [
    {
      trackId: c.trackA,
      source: c.stemA ?? "mix",
      semitones: processed ? (c.shiftA ?? 0) : 0,
      targetBpm: null,
    },
    {
      trackId: c.trackB,
      source: c.stemB ?? "mix",
      semitones: processed ? (c.shiftB ?? 0) : 0,
      targetBpm: processed && c.bpmA ? Math.round((c.bpmA / factor) * 1000) / 1000 : null,
    },
  ];
}
