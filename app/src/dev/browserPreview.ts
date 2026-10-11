// Dev-only browser preview: run `pnpm dev` and open http://localhost:1420 in a normal
// browser to see the UI without Tauri. The engine is simulated with Tauri's IPC mocks.
// Query params: `?empty` (first-run screen), `?big` (12 480 tracks), `?down` (engine off).
// Never imported in production builds (see main.tsx).
import { DEFAULT_TAG_OPTIONS } from "../features/settings/api";
import { emit } from "@tauri-apps/api/event";
import { mockConvertFileSrc, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { formatKey, fromAlphanumeric, makeKey } from "../lib/keys";
import { createFakePlaylists } from "./fakePlaylists";
import type {
  Cue,
  CueSetParams,
  CueSlotParams,
  LibraryQuery,
  TrackDetail,
  Settings,
  SettingsUpdate,
  TagOptions,
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
      energy: status === "ready" ? ([7, 6, 8, 5, 9, 4, 6, 7, 8, 5][i % 10] ?? 6) : null,
      cueCount: status === "ready" ? 6 : 0,
      editedFields: [],
      qualityFlags:
        status !== "ready" ? [] : i === 6 ? ["low_bitrate"] : i === 8 ? ["clipping", "quiet"] : [],
    } satisfies TrackSummary;
  });
}

// Synthetic arrangement for the detail view: (label, bars, energy level).
const PLAN: [string, number, number][] = [
  ["intro", 16, 4],
  ["build", 8, 6],
  ["drop", 16, 8],
  ["breakdown", 16, 3],
  ["build", 8, 6],
  ["drop", 16, 9],
  ["outro", 16, 4],
];
const CUE_COLORS: Record<string, string> = {
  intro: "#4CC3FF",
  build: "#3DDC97",
  drop: "#FF5F8A",
  breakdown: "#FFB547",
  drop2: "#FF7A3D",
  outro: "#8A879E",
};

function layout(t: TrackSummary) {
  const bar = 240 / (t.bpm ?? 124);
  const first = 0.3;
  let at = first;
  const segments = PLAN.map(([label, bars, energy], i) => {
    const start = i === 0 ? 0 : at;
    at += bars * bar;
    return { start, end: i === PLAN.length - 1 ? (t.duration ?? at) : at, label, energy };
  });
  return { bar, first, segments };
}

function detailOf(t: TrackSummary, cues: Cue[]): TrackDetail {
  const { bar, first, segments } = layout(t);
  const energyCurve = segments.flatMap((s) => {
    const blocks = [];
    for (let a = s.start; a < s.end - 1; a += 8 * bar) {
      blocks.push({
        start: a,
        end: Math.min(s.end, a + 8 * bar),
        level: s.energy + (a > s.start ? 0.4 : 0),
      });
    }
    return blocks;
  });
  return {
    ...t,
    cues,
    cueCount: cues.length,
    sampleRate: 44100,
    label: "Nocturne Records",
    comment: null,
    fileHash: null,
    size: null,
    analyzedAt: t.addedAt,
    analysisVersion: "2.7",
    keyAlternatives:
      t.keyRoot == null ? [] : [{ root: (t.keyRoot + 7) % 12, mode: t.keyMode ?? "minor" }],
    keySecondary: null,
    keySecondaryStart: null,
    tuningHz: 440,
    bpmConfidence: 0.9,
    beatGrid: t.bpm ? { kind: "constant", bpm: t.bpm, first_downbeat: first } : null,
    energyCurve,
    segments: t.status === "ready" ? segments : [],
    loudnessLufs: -8.2,
    peakDb: -0.3,
    clippingRatio: t.qualityFlags?.includes("clipping") ? 0.004 : 0,
    cutoffHz: 19800,
    silenceStart: 0,
    silenceEnd: 0,
    waveformPath: t.status === "ready" ? `/preview/waveforms/${t.id}.twf` : null,
  } as TrackDetail;
}

function autoCues(t: TrackSummary): Cue[] {
  if (t.status !== "ready") return [];
  const { segments } = layout(t);
  let drops = 0;
  const picks = segments.filter((s) => s.label !== "build");
  return picks.map((s, slot) => {
    const label = s.label === "drop" && ++drops > 1 ? "drop2" : s.label;
    return {
      slot,
      positionSec: slot === 0 ? 0.3 : s.start,
      label,
      color: CUE_COLORS[label] ?? null,
      source: "auto",
    };
  });
}

/** TWF1 bytes shaped by the synthetic arrangement (the asset protocol does not exist here). */
function syntheticWaveform(t: TrackSummary): ArrayBuffer {
  const pps = 150;
  const points = Math.floor((t.duration ?? 300) * pps);
  const { bar, segments } = layout(t);
  const beat = bar / 4;
  const buf = new ArrayBuffer(16 + points * 3);
  const view = new DataView(buf);
  [..."TWF1"].forEach((c, i) => view.setUint8(i, c.charCodeAt(0)));
  view.setUint16(4, 1, true);
  view.setUint16(6, pps, true);
  view.setUint32(8, points, true);
  view.setUint8(12, 3);
  const data = new Uint8Array(buf, 16);
  let seg = 0;
  for (let i = 0; i < points; i++) {
    const time = i / pps;
    while (seg < segments.length - 1 && time >= (segments[seg]?.end ?? 0)) seg++;
    const s = segments[seg];
    const level = (s?.energy ?? 5) / 10;
    const phase = (time % beat) / beat;
    const kick = s?.label === "breakdown" ? 0.1 : Math.exp(-phase * 6);
    const noise = 0.75 + 0.25 * Math.sin(i * 12.9898) ** 2;
    data[i * 3] = Math.round(255 * Math.min(1, level * (0.35 + 0.65 * kick)) * noise);
    data[i * 3 + 1] = Math.round(255 * Math.min(1, level * 0.75) * noise);
    data[i * 3 + 2] = Math.round(
      255 * Math.min(1, level * 0.45 * (0.6 + 0.4 * Math.exp(-((phase + 0.5) % 1) * 8))),
    );
  }
  return buf;
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
  const cueStore = new Map<number, Cue[]>();
  const cuesOf = (t: TrackSummary) => {
    if (!cueStore.has(t.id)) cueStore.set(t.id, autoCues(t));
    return cueStore.get(t.id) ?? [];
  };
  const realFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const match = /waveforms%2F(\d+)\.twf|waveforms\/(\d+)\.twf/.exec(url);
    const t = match ? tracks.find((x) => x.id === Number(match[1] ?? match[2])) : undefined;
    return t ? Promise.resolve(new Response(syntheticWaveform(t))) : realFetch(input, init);
  };
  let settings: Required<Settings> = {
    notation: "alphanumeric",
    bpmDecimals: 2,
    cueCount: 8,
    tagOptions: DEFAULT_TAG_OPTIONS,
    watchedFolders: ["/Users/dj/Descargas/Promos"],
  };

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

  const playlists = createFakePlaylists(() => tracks);
  if (tracks.length) {
    // DESIGN.md 8 sample playlists.
    const gigs = playlists.add("Bolos", { isFolder: true, emoji: "📁" });
    playlists.add("Warm-up Ibiza", { parentId: gigs.id, emoji: "🌅" }, [2, 4, 1]);
    playlists.add("Peak time", { parentId: gigs.id, emoji: "🔥" }, [3, 5, 9]);
    playlists.add("Cierre", { parentId: gigs.id, emoji: "🌙" }, [10, 6]);
    const radio = playlists.add("Radio", { isFolder: true, emoji: "📁" });
    playlists.add("Show semanal", { parentId: radio.id, emoji: "🎙️" }, [1, 8]);
    playlists.add("Por probar", { emoji: "🧪" }, [7]);
    playlists.add("Vinilos digitalizados", { emoji: "💿" }, []);
    playlists.add("Compatibles con 8A", {
      emoji: "🔮",
      smart: { keys: [{ root: 9, mode: "minor" }], compatible: true },
    });
    playlists.add("Energía 8+", { emoji: "🔥", smart: { energyMin: 8 } });
    playlists.add("Sin analizar", { emoji: "🕓", smart: { statuses: ["pending"] } });
  }

  mockWindows("main");
  mockConvertFileSrc("macos");
  mockIPC(
    (cmd, payload) => {
      if (cmd === "plugin:dialog|open") return ["/Users/dj/Música"];
      if (cmd === "plugin:dialog|save") return "/Users/dj/Desktop/playlist.m3u8";
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
          if (q.qualityIssues != null) {
            rows = rows.filter((t) => (t.qualityFlags?.length ?? 0) > 0 === q.qualityIssues);
          }
          const filter = q.filter;
          if (filter) rows = rows.filter((t) => playlists.matches(t, filter));
          const inPlaylist = playlists.select(q, rows);
          if (inPlaylist?.ordered && q.sort === "position") {
            const ordered = q.descending ? [...inPlaylist.rows].reverse() : inPlaylist.rows;
            const start = q.offset ?? 0;
            return { total: ordered.length, items: ordered.slice(start, start + (q.limit ?? 200)) };
          }
          if (inPlaylist) rows = inPlaylist.rows;
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
        case "library.genres": {
          const counts = new Map<string, number>();
          tracks.forEach((t) => t.genre && counts.set(t.genre, (counts.get(t.genre) ?? 0) + 1));
          return {
            genres: [...counts]
              .map(([name, count]) => ({ name, count }))
              .sort((a, b) => b.count - a.count),
          };
        }
        case "library.get": {
          const t = tracks.find((x) => x.id === (p as { trackId: number }).trackId);
          if (!t) throw { code: -32602, message: "unknown track" };
          return detailOf(t, cuesOf(t));
        }
        case "cues.set": {
          const c = p as CueSetParams;
          const t = tracks.find((x) => x.id === c.trackId);
          if (!t) throw { code: -32602, message: "unknown track" };
          const cue: Cue = {
            slot: c.slot,
            positionSec: c.positionSec,
            label: c.label ?? null,
            color: c.color ?? null,
            source: "user",
          };
          cueStore.set(
            t.id,
            [...cuesOf(t).filter((x) => x.slot !== c.slot), cue].sort((a, b) => a.slot - b.slot),
          );
          return cue;
        }
        case "cues.delete": {
          const c = p as CueSlotParams;
          const t = tracks.find((x) => x.id === c.trackId);
          if (!t) throw { code: -32602, message: "unknown track" };
          cueStore.set(
            t.id,
            cuesOf(t).filter((x) => x.slot !== c.slot),
          );
          return { deleted: true };
        }
        case "cues.resetAuto": {
          const t = tracks.find((x) => x.id === (p as { trackId: number }).trackId);
          if (!t) throw { code: -32602, message: "unknown track" };
          cueStore.set(t.id, autoCues(t));
          return { cues: cuesOf(t) };
        }
        case "tags.preview": {
          const q = p as { trackIds: number[]; options?: TagOptions };
          return {
            items: q.trackIds.map((trackId) => {
              const t = tracks.find((x) => x.id === trackId);
              const key =
                t?.keyRoot != null && t.keyMode
                  ? formatKey(makeKey(t.keyRoot, t.keyMode), q.options?.notation ?? "alphanumeric")
                  : null;
              const template = (q.options?.commentTemplate ?? "{key} - Energy {energy}")
                .replace("{key}", key ?? "")
                .replace("{energy}", String(t?.energy ?? ""))
                .replace("{bpm}", t?.bpm?.toFixed(2) ?? "");
              const changes = key
                ? [
                    { field: "key", before: null, after: key },
                    { field: "bpm", before: "124", after: t?.bpm?.toFixed(2) ?? "" },
                    {
                      field: "comment",
                      before: "Free download",
                      after:
                        q.options?.commentPosition === "replace"
                          ? template
                          : `${template} | Free download`,
                    },
                  ]
                : [];
              return { trackId, path: t?.path ?? "", changes, error: null };
            }),
          };
        }
        case "tags.cleanPreview":
        case "tags.editPreview": {
          const q = p as { trackIds: number[]; values?: Record<string, string> };
          return {
            items: q.trackIds.map((trackId, i) => {
              const t = tracks.find((x) => x.id === trackId);
              const changes = q.values
                ? Object.entries(q.values).map(([field, after]) => ({
                    field,
                    before: t?.genre ?? null,
                    after,
                  }))
                : i % 3 === 0
                  ? [
                      {
                        field: "title",
                        before: `0${i + 1} - ${(t?.title ?? "").toUpperCase()} [Free Download]`,
                        after: t?.title ?? "",
                      },
                      { field: "comment", before: "www.promo-site.com", after: "" },
                    ]
                  : [];
              return { trackId, path: t?.path ?? "", changes, error: null };
            }),
          };
        }
        case "tags.clean":
        case "tags.edit":
        case "tags.write":
        case "tags.undo": {
          const jobId = `preview-tags-${Date.now()}`;
          const kind = method;
          const ids = (p as { trackIds?: number[] }).trackIds ?? [];
          void (async () => {
            for (let i = 1; i <= Math.max(ids.length, 1); i++) {
              await emit("engine://progress", {
                jobId,
                stage: "writing",
                percent: (100 * i) / Math.max(ids.length, 1),
                done: i,
                total: ids.length,
              });
              await new Promise((r) => setTimeout(r, 80));
            }
            await emit("engine://event", {
              type: "job.finished",
              payload: {
                jobId,
                kind,
                status: "done",
                result:
                  kind === "tags.write"
                    ? { batchId: "preview", written: ids.length, unchanged: 0, failed: [] }
                    : { batchId: "preview", restored: 3, skipped: [] },
                error: null,
              },
            });
          })();
          return { jobId };
        }
        case "settings.get":
          return settings;
        case "settings.set": {
          const u = p as SettingsUpdate;
          settings = {
            notation: u.notation ?? settings.notation,
            bpmDecimals: u.bpmDecimals ?? settings.bpmDecimals,
            cueCount: u.cueCount ?? settings.cueCount,
            tagOptions: { ...DEFAULT_TAG_OPTIONS, ...(u.tagOptions ?? settings.tagOptions) },
            watchedFolders: u.watchedFolders ?? settings.watchedFolders,
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
        case "export.traktorStatus":
          return {
            collectionPath: "/Users/dj/Documents/Native Instruments/Traktor 4.0.2/collection.nml",
            running: false,
          };
        case "export.traktor":
        case "export.serato":
        case "export.rekordbox": {
          const jobId = `preview-export-${Date.now()}`;
          const o = (p ?? {}) as { simulate?: boolean; path?: string | null };
          setTimeout(() => {
            void emit("engine://event", {
              type: "job.finished",
              payload: {
                jobId,
                kind: method,
                status: "done",
                error: null,
                result: {
                  target: method.split(".")[1],
                  simulated: o.simulate ?? true,
                  path:
                    o.path ??
                    "/Users/dj/Library/Application Support/org.tonalia.app/exports/rekordbox.xml",
                  tracks: tracks.length,
                  cues: tracks.length * 6,
                  playlists: 8,
                  skipped: 1,
                  backupPath:
                    o.simulate === false
                      ? "/Users/dj/…/backups/rekordbox/20261011-rekordbox.xml"
                      : null,
                  warnings: [
                    { code: "unsupported_format", trackId: 3, path: "/Users/dj/Música/demo.ogg" },
                    { code: "not_analyzed", trackId: 6, path: null },
                  ],
                },
              },
            });
          }, 600);
          return { jobId };
        }
        default:
          if (method.startsWith("playlists.")) return playlists.call(method, p);
          throw { code: -32601, message: `method not found: ${method}` };
      }
    },
    { shouldMockEvents: true },
  );
}
