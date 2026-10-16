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

/**
 * A spectrogram (SPEC 13.5) for the browser preview and the tests: noise up to the cut-off,
 * dark above it. Fake lossless files ("fake_hq") stop at 16 kHz, MP3 at their low-pass.
 */
export function fakeSpectrogram(t: {
  id: number;
  format: string | null;
  bitrate: number | null;
  qualityFlags?: string[] | null;
  duration: number | null;
}) {
  const rows = 128;
  const columns = 240;
  const fake = (t.qualityFlags ?? []).includes("fake_hq");
  const kbps = t.bitrate ?? 320;
  const cutoff = fake ? 16031 : t.format === "mp3" && kbps < 256 ? 17000 : 20800;
  const maxHz = 22050;
  const bytes = new Uint8Array(rows * columns);
  for (let r = 0; r < rows; r++) {
    const hz = (r / rows) * maxHz;
    for (let c = 0; c < columns; c++) {
      const beat = c % 8 < 2 ? 30 : 0;
      const level = hz < cutoff ? 200 - (hz / maxHz) * 110 + beat - ((r * 7 + c * 13) % 23) : 4;
      bytes[r * columns + c] = Math.max(0, Math.min(255, Math.round(level)));
    }
  }
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  const lossless = ["flac", "wav", "aiff", "aif", "alac"].includes((t.format ?? "").toLowerCase());
  const likely = cutoff <= 17200 ? 128 : null;
  return {
    trackId: t.id,
    rows,
    columns,
    maxHz,
    duration: t.duration ?? 300,
    data: btoa(binary),
    cutoffHz: cutoff,
    likelyKbps: likely,
    format: t.format,
    bitrate: lossless ? null : t.bitrate,
    fakeHq: fake,
  };
}
