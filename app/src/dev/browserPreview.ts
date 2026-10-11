// Dev-only browser preview: run `pnpm dev` and open http://localhost:1420 in a normal
// browser to see the UI without Tauri. The engine is simulated with Tauri's IPC mocks.
// Query params: `?empty` (first-run screen), `?big` (12 480 tracks), `?down` (engine off).
// Never imported in production builds (see main.tsx).
import { emit } from "@tauri-apps/api/event";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { fromAlphanumeric } from "../lib/keys";
import type {
  LibraryQuery,
  Settings,
  SettingsUpdate,
  TrackSummary,
  TrackUpdateParams,
} from "../lib/rpc.types";

// DESIGN.md 8 sample data: title, artist, genre, key, BPM.
const SAMPLES: [string, string, string, string, number][] = [
  ["Midnight Bloom", "Lumen Drift", "Melodic House", "8A", 124],
  ["Golden Hour Tide", "Sora Vela", "Deep House", "9A", 124],
  ["Neon Cathedral", "Kairo", "Techno", "8B", 126],
  ["Velvet Static", "Mara Ion", "Organic House", "7A", 122],
  ["Heatwave Protocol", "Duo Arcadia", "Tech House", "10A", 128],
  ["Paper Satellites", "Ines Halo", "Downtempo", "3B", 120],
  ["Run The Signal (Acapella)", "Nova Reign", "Acapella", "8A", 124],
  ["Sunset Engine", "The Quiet Orbit", "Progressive", "11B", 125],
  ["Cobalt Rain", "Eli Marsh", "Drum & Bass", "5A", 174],
  ["Last Train To Lisbon", "Amaro", "Afro House", "12A", 118],
];

function makeTracks(count: number): TrackSummary[] {
  return Array.from({ length: count }, (_, i) => {
    const [title, artist, genre, alnum, bpm] = SAMPLES[i % SAMPLES.length] as [
      string,
      string,
      string,
      string,
      number,
    ];
    const status = i === 4 ? "error" : i === 2 ? "analyzing" : i === 5 ? "pending" : "ready";
    const key = status === "ready" ? fromAlphanumeric(alnum) : null;
    const suffix = count > SAMPLES.length ? ` ${Math.floor(i / SAMPLES.length) + 1}` : "";
    return {
      id: i + 1,
      path: `/Users/dj/Música/${artist}/${title}${suffix}.flac`,
      title: `${title}${suffix}`,
      artist,
      album: null,
      genre,
      year: 2024,
      duration: 300 + ((i * 37) % 180),
      format: "flac",
      bitrate: 900,
      status,
      error: i === 4 ? "cannot decode Heatwave Protocol.flac: Invalid data" : null,
      addedAt: new Date(Date.UTC(2026, 9, 11) - i * 3_600_000).toISOString(),
      artworkPath: null,
      keyRoot: key?.root ?? null,
      keyMode: key?.mode ?? null,
      keyConfidence: key ? (i === 3 ? 0.42 : 0.9) : null,
      bpm: key ? bpm : null,
      energy: null,
      cueCount: 0,
      editedFields: [],
    } satisfies TrackSummary;
  });
}

function sortValue(t: TrackSummary, sort: string): string | number {
  switch (sort) {
    case "title":
      return t.title ?? "";
    case "genre":
      return t.genre ?? "";
    case "duration":
      return t.duration ?? 0;
    case "status":
      return t.status;
    default:
      return t.addedAt;
  }
}

export function installBrowserPreview(): void {
  const params = new URLSearchParams(window.location.search);
  let tracks = params.has("empty") ? [] : makeTracks(params.has("big") ? 12_480 : SAMPLES.length);
  const engineDown = params.has("down");
  let cancelled = false;
  let settings: Required<Settings> = { notation: "alphanumeric", bpmDecimals: 2 };

  const runImport = async (jobId: string) => {
    cancelled = false;
    const total = 240;
    for (let done = 0; done <= total; done += 12) {
      if (cancelled) break;
      await emit("engine://progress", {
        jobId,
        stage: "importing",
        percent: (done / total) * 100,
        done,
        total,
      });
      await new Promise((r) => setTimeout(r, 120));
    }
    if (!cancelled) tracks = [...makeTracks(total), ...tracks].map((t, i) => ({ ...t, id: i + 1 }));
    await emit("engine://event", {
      type: "job.finished",
      payload: {
        jobId,
        kind: "library.addPaths",
        status: cancelled ? "cancelled" : "done",
        result: cancelled
          ? null
          : { added: total, updated: 0, moved: 0, unchanged: 0, duplicates: 2, failed: [] },
        error: null,
      },
    });
  };

  mockWindows("main");
  mockIPC(
    (cmd, payload) => {
      if (cmd === "plugin:dialog|open") return ["/Users/dj/Música"];
      if (cmd !== "engine_request") return null;
      if (engineDown) throw { code: -32000, message: "engine not running" };
      const { method, params: p } = payload as { method: string; params: unknown };
      switch (method) {
        case "engine.ping":
          return { pong: true };
        case "library.list": {
          const q = (p ?? {}) as LibraryQuery;
          const s = q.search?.toLowerCase();
          let rows = s
            ? tracks.filter((t) => `${t.title} ${t.artist} ${t.path}`.toLowerCase().includes(s))
            : tracks;
          const sort = q.sort ?? "added_at";
          const dir = q.descending === false ? 1 : -1;
          rows = [...rows].sort((a, b) => {
            const av = sortValue(a, sort);
            const bv = sortValue(b, sort);
            return (av < bv ? -1 : av > bv ? 1 : 0) * dir;
          });
          const offset = q.offset ?? 0;
          return { total: rows.length, items: rows.slice(offset, offset + (q.limit ?? 200)) };
        }
        case "library.addPaths": {
          const jobId = `preview-${Date.now()}`;
          void runImport(jobId);
          return { jobId };
        }
        case "job.cancel":
          cancelled = true;
          return { cancelled: true };
        case "settings.get":
          return settings;
        case "settings.set": {
          const u = p as SettingsUpdate;
          settings = {
            notation: u.notation ?? settings.notation,
            bpmDecimals: u.bpmDecimals ?? settings.bpmDecimals,
          };
          return settings;
        }
        case "track.update": {
          const u = p as TrackUpdateParams;
          tracks = tracks.map((t) => {
            if (t.id !== u.trackId) return t;
            const edited = new Set(t.editedFields ?? []);
            const next = { ...t };
            if ("key" in u) {
              Object.assign(next, {
                keyRoot: u.key?.root ?? null,
                keyMode: u.key?.mode ?? null,
                keyConfidence: null,
              });
              edited.add("key");
            }
            if ("bpm" in u) {
              next.bpm = u.bpm ?? null;
              edited.add("bpm");
            }
            return { ...next, editedFields: [...edited] };
          });
          return tracks.find((t) => t.id === u.trackId);
        }
        default:
          throw { code: -32601, message: `method not found: ${method}` };
      }
    },
    { shouldMockEvents: true },
  );
}
