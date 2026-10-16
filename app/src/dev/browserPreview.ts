// Dev-only browser preview: run `pnpm dev` and open http://localhost:1420 in a normal
// browser to see the UI without Tauri. The engine is simulated with Tauri's IPC mocks.
// Query params: `?empty` (first-run screen), `?big` (12 480 tracks), `?down` (engine off),
// `?slow` (the engine answers after 8 s, like on a first start), `?gpu` (Windows with an
// NVIDIA GPU: Settings → Stems offers the CUDA download).
// Never imported in production builds (see main.tsx).
import { fakeLibraryStats, fakeSpectrogram } from "./fakeStats";
import { ANALYSIS_STAGES } from "../features/library/analysisStore";
import { DEFAULT_SETTINGS, DEFAULT_TAG_OPTIONS } from "../features/settings/api";
import { emit } from "@tauri-apps/api/event";
import { mockConvertFileSrc, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { formatKey, fromAlphanumeric, makeKey } from "../lib/keys";
import { createFakeBuilder } from "./fakeBuilder";
import { fakeMixPoints } from "./fakeMix";
import { createFakeEnergy } from "./fakeEnergy";
import { createFakeGrid } from "./fakeGrid";
import { createFakeCueReview } from "./fakeCueReview";
import { createFakeDjImport } from "./fakeDjImport";
import { createFakeDuplicates } from "./fakeDuplicates";
import { createFakeHistory } from "./fakeHistory";
import { createFakeFavorites } from "./fakeFavorites";
import { createFakePlaylists } from "./fakePlaylists";
import { fakeSuggest } from "./fakeSuggest";
import { previewRender, previewRenderWav, previewTrackAudio } from "./previewRender";
import { setPlaybackSource } from "../features/player/playerStore";
import type {
  MixPointsParams,
  Cue,
  CueSetParams,
  CueSlotParams,
  ConvertOptions,
  HistoryImportParams,
  ImportOptions,
  LibraryQuery,
  TrackDetail,
  Settings,
  SettingsUpdate,
  RenderSpec,
  StemExportParams,
  SuggestParams,
  TagBatchInfo,
  TagOptions,
  QualityReviewParams,
  TrackSummary,
  TrackUpdateParams,
} from "../lib/rpc.types";
import { pendingQuality } from "../features/library/quality";

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

const PREVIEW_EXPORT_PATHS: Record<string, string> = {
  "export.rekordbox": "/Users/dj/Library/Application Support/org.tonalia.app/exports/rekordbox.xml",
  "export.traktor": "/Users/dj/Documents/Native Instruments/Traktor 3.11.1/collection.nml",
  "export.serato": "",
  "export.virtualdj": "/Users/dj/Library/Application Support/VirtualDJ/database.xml",
  "export.engineDj": "/Users/dj/Music/Engine Library/Database2/m.db",
};

function makeTracks(count: number): TrackSummary[] {
  return Array.from({ length: count }, (_, i) => {
    const [title, artist, genre, alnum, bpm] = SAMPLES[i % SAMPLES.length] as [
      string,
      string,
      string,
      string,
      number,
    ];
    // No track starts "analyzing": the engine puts interrupted ones back to pending on
    // start (queue.recover_interrupted), so the Analyse count always matches the rows.
    const status = i === 4 ? "error" : i === 2 || i === 5 ? "pending" : "ready";
    const key = status === "ready" ? fromAlphanumeric(alnum) : null;
    const suffix = count > SAMPLES.length ? ` ${Math.floor(i / SAMPLES.length) + 1}` : "";
    // The low-bitrate track is a 128 kbps MP3; the rest are lossless at varied rates.
    const lossy = i % SAMPLES.length === 6;
    return {
      id: i + 1,
      path: `/Users/dj/Música/${artist}/${title}${suffix}.${lossy ? "mp3" : "flac"}`,
      title: `${title}${suffix}`,
      artist,
      album: null,
      genre,
      year: 2024,
      duration: 300 + ((i * 37) % 180),
      format: lossy ? "mp3" : "flac",
      bitrate: lossy ? 128 : 780 + ((i * 97) % 340),
      status,
      error: i === 4 ? "cannot decode Heatwave Protocol.flac: Invalid data" : null,
      errorInfo:
        i === 4
          ? { reason: "decode_failed" as const, params: { name: "Heatwave Protocol.flac" } }
          : null,
      addedAt: new Date(Date.UTC(2026, 9, 11) - i * 3_600_000).toISOString(),
      artworkPath: null,
      keyRoot: key?.root ?? null,
      keyMode: key?.mode ?? null,
      keyConfidence: key ? (i === 3 ? 0.42 : 0.9) : null,
      bpm: key ? bpm : null,
      energy: status === "ready" ? ([7, 6, 8, 5, 9, 4, 6, 7, 8, 5][i % 10] ?? 6) : null,
      cueCount: status === "ready" ? 6 : 0,
      editedFields: [],
      // ReplayGain to -18 LUFS (SPEC 13.6): loud club masters, a quieter one now and then.
      replaygainDb: status === "ready" ? -([9.8, 8.4, 10.6, 6.2, 11.1, 3.5][i % 6] ?? 9) : null,
      qualityFlags:
        status !== "ready" ? [] : lossy ? ["low_bitrate"] : i === 8 ? ["clipping", "quiet"] : [],
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
    // Like the engine: two alternatives, here a fifth up and the relative key.
    keyAlternatives:
      t.keyRoot == null
        ? []
        : [
            { root: (t.keyRoot + 7) % 12, mode: t.keyMode ?? "minor" },
            t.keyMode === "major"
              ? { root: (t.keyRoot + 9) % 12, mode: "minor" }
              : { root: (t.keyRoot + 3) % 12, mode: "major" },
          ],
    keySecondary: null,
    keySecondaryStart: null,
    tuningHz: 440,
    bpmConfidence: 0.9,
    beatGrid: t.bpm ? { kind: "constant", bpm: t.bpm, first_downbeat: first } : null,
    energyCurve,
    segments: t.status === "ready" ? segments : [],
    loudnessLufs: t.replaygainDb != null ? -18 - t.replaygainDb : -8.2,
    peakDb: -0.3,
    truePeakDb: 0.4,
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
    case "times_played":
      return t.timesPlayed ?? 0;
    case "last_played":
      return t.lastPlayed ?? "";
    case "replaygain":
      return t.replaygainDb ?? -99;
    default:
      return t.addedAt;
  }
}

export function installBrowserPreview(): void {
  const params = new URLSearchParams(window.location.search);
  let tracks = params.has("empty") ? [] : makeTracks(params.has("big") ? 12_480 : SAMPLES.length);
  const engineDown = params.has("down");
  const readyAt = params.has("slow") ? Date.now() + 8_000 : 0;
  let gpuState: "not_installed" | "active" | null = params.has("gpu") ? "not_installed" : null;
  const gpuRuntime = () =>
    gpuState && {
      gpu: { name: "NVIDIA GeForce RTX 4070", driver: "572.16" },
      state: gpuState,
      totalBytes: 2_596_413_186,
      downloadedBytes: 0,
      installedBytes: gpuState === "active" ? 3_412_000_000 : 0,
      minDriver: "560.76",
      restartRequired: false,
      detail: null,
    };
  let cancelled = false;
  const cueStore = new Map<number, Cue[]>();
  const cuesOf = (t: TrackSummary) => {
    if (!cueStore.has(t.id)) cueStore.set(t.id, autoCues(t));
    return cueStore.get(t.id) ?? [];
  };
  // Like the engine: a table row counts the track's cues and carries their colours.
  const withCues = (t: TrackSummary): TrackSummary => {
    const cues = cuesOf(t);
    return {
      ...t,
      cueCount: cues.length,
      cueDots: cues.map((c) => ({ slot: c.slot, color: c.color ?? null })),
    };
  };
  // The library player cannot reach files here: it plays a click track at the track's BPM.
  setPlaybackSource((playable) => {
    const t = tracks.find((x) => x.id === playable.id);
    return t ? Promise.resolve(previewTrackAudio(t)) : Promise.reject(new Error("unsupported"));
  });
  // Tag write history: one earlier batch, then whatever is written in the preview.
  const tagHistory: TagBatchInfo[] = tracks.length
    ? [
        {
          batchId: "preview-0",
          kind: "results",
          createdAt: new Date(Date.now() - 26 * 3600_000).toISOString(),
          written: tracks.length,
          undoneAt: null,
          undoable: tracks.length,
          fields: ["key", "bpm", "comment"],
          titles: tracks.slice(0, 3).map((t) => t.title ?? ""),
        },
      ]
    : [];
  const realFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const match = /waveforms%2F(\d+)\.twf|waveforms\/(\d+)\.twf/.exec(url);
    const t = match ? tracks.find((x) => x.id === Number(match[1] ?? match[2])) : undefined;
    if (t) return Promise.resolve(new Response(syntheticWaveform(t)));
    const wav = previewRenderWav(url);
    return wav ? Promise.resolve(new Response(wav)) : realFetch(input, init);
  };
  let settings: Required<Settings> = {
    ...DEFAULT_SETTINGS,
    watchedFolders: ["/Users/dj/Descargas/Promos"],
  };
  // Stems: the model starts missing; downloads and separations are simulated.
  const stemModels = { htdemucs_ft: false, htdemucs: false };
  const stemSets = new Map<number, string>();
  const stemsStatus = () => ({
    models: [
      {
        model: "htdemucs",
        installed: stemModels.htdemucs,
        totalBytes: 84_141_911,
        missingBytes: stemModels.htdemucs ? 0 : 84_141_911,
        secondsPerMinute: 9.5,
        estimateMeasured: true,
      },
      {
        model: "htdemucs_ft",
        installed: stemModels.htdemucs_ft,
        totalBytes: 336_565_084,
        missingBytes: stemModels.htdemucs_ft ? 0 : 336_565_084,
        secondsPerMinute: 36.6,
        estimateMeasured: false,
      },
    ],
    accelerator: gpuState === "active" ? "cuda" : gpuState ? null : "mps",
    cache: { bytes: stemSets.size * 210_000_000, tracks: stemSets.size },
    gpuRuntime: gpuRuntime(),
  });
  const simulateJob = (
    jobId: string,
    kind: string,
    stage: string,
    result: () => unknown,
    trackId: number | null = null,
  ) => {
    void (async () => {
      for (let percent = 0; percent <= 100; percent += 5) {
        await emit("engine://progress", { jobId, stage, percent, trackId });
        await new Promise((r) => setTimeout(r, 90));
      }
      await emit("engine://event", {
        type: "job.finished",
        payload: { jobId, kind, status: "done", error: null, result: result() },
      });
    })();
  };

  const runAnalysis = async (jobId: string, ids: number[]) => {
    cancelled = false;
    const setTrack = (id: number, patch: Partial<TrackSummary>) =>
      (tracks = tracks.map((t) => (t.id === id ? { ...t, ...patch } : t)));
    await emit("engine://event", { type: "job.started", payload: { jobId, kind: "analysis" } });
    const total = ids.length;
    let done = 0;
    for (const id of ids) {
      if (cancelled) break;
      setTrack(id, { status: "analyzing", error: null });
      for (const [s, stage] of ANALYSIS_STAGES.entries()) {
        if (cancelled) break;
        await emit("engine://progress", {
          jobId,
          trackId: id,
          stage,
          percent: ((done + s / ANALYSIS_STAGES.length) / total) * 100,
          done,
          total,
        });
        await new Promise((r) => setTimeout(r, 450));
      }
      if (cancelled) {
        setTrack(id, { status: "pending" });
        break;
      }
      const t = tracks.find((x) => x.id === id);
      const sample = SAMPLES.find(([title]) => t?.title?.startsWith(title));
      const key = sample ? fromAlphanumeric(sample[3]) : null;
      setTrack(id, {
        status: "ready",
        keyRoot: key?.root ?? null,
        keyMode: key?.mode ?? null,
        keyConfidence: key ? 0.88 : null,
        bpm: sample?.[4] ?? 124,
        energy: 3 + (id % 7),
        cueCount: 6,
      });
      done++;
      await emit("engine://event", {
        type: "analysis.trackDone",
        payload: { trackId: id, status: "ready", error: null },
      });
    }
    await emit("engine://event", {
      type: "job.finished",
      payload: {
        jobId,
        kind: "analysis",
        status: cancelled ? "cancelled" : "done",
        error: null,
        result: { analyzed: done, failed: 0, cancelled: total - done },
      },
    });
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
  const favorites = createFakeFavorites(() => tracks);
  const energy = createFakeEnergy(
    () => tracks,
    (update) => (tracks = update(tracks)),
  );
  // Grid edits (SPEC 12.4) on top of the generated detail.
  const gridDetails = new Map<number, Partial<TrackDetail>>();
  const fullDetail = (id: number): TrackDetail => {
    const t = tracks.find((x) => x.id === id);
    if (!t) throw { code: -32602, message: "unknown track" };
    return { ...detailOf(t, cuesOf(t)), ...gridDetails.get(id) };
  };
  const grid = createFakeGrid({
    detail: fullDetail,
    patch: (id, fields, cues) => {
      gridDetails.set(id, { ...gridDetails.get(id), ...fields });
      if (cues) cueStore.set(id, cues);
    },
  });
  const cueReview = createFakeCueReview({ tracks: () => tracks, detail: fullDetail });
  const djImport = createFakeDjImport({ tracks: () => tracks });
  const duplicates = createFakeDuplicates();
  const history = createFakeHistory(
    () => tracks,
    (playlistId) => ({
      name: "",
      trackIds:
        playlists.select({ playlistId } as LibraryQuery, tracks)?.rows.map((t) => t.id) ?? [],
    }),
  );
  const builder = createFakeBuilder(
    () => tracks,
    (playlistId) =>
      playlists.select({ playlistId } as LibraryQuery, tracks)?.rows.map((t) => t.id) ?? [],
  );
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
    // Play history (DESIGN 6.22): a Traktor session two days ago and a set marked by hand.
    history.add("traktor", null, Date.now() - 2 * 86_400_000, [1, 2, 3, 5, 1]);
    history.add(null, "Bolo sábado · Warm-up Ibiza", Date.now() - 9 * 86_400_000, [2, 4, 1]);
    // A few mashup favorites (DESIGN 6.11).
    favorites.save({
      trackA: 7,
      trackB: 1,
      mode: "mashup",
      stemA: "vocals",
      stemB: "instrumental",
      rating: 5,
      notes: "La acapella entra perfecta en el drop.",
    });
    favorites.save({ trackA: 1, trackB: 2, mode: "mix", rating: 4, notes: "Cierre del warm-up." });
    favorites.save({ trackA: 4, trackB: 10, mode: "mashup", shiftB: 1, rating: 3 });
  }

  // The list generated by scripts/gen-third-party, when it exists (git-ignored).
  const generated = import.meta.glob("../../src-tauri/binaries/licenses/third-party.json", {
    import: "default",
  });
  const previewLicenses = async () => {
    const load = Object.values(generated)[0];
    if (!load) throw "third-party list not found (run scripts/gen-third-party)";
    return load();
  };

  mockWindows("main");
  mockConvertFileSrc("macos");
  mockIPC(
    (cmd, payload) => {
      if (cmd === "plugin:dialog|open") return ["/Users/dj/Música"];
      if (cmd === "plugin:dialog|save") return "/Users/dj/Desktop/playlist.m3u8";
      if (cmd === "third_party_licenses") return previewLicenses();
      if (cmd !== "engine_request") return null;
      if (engineDown || Date.now() < readyAt) throw { code: -32000, message: "engine not running" };
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
            rows = rows.filter((t) => pendingQuality(t).length > 0 === q.qualityIssues);
          }
          const filter = q.filter;
          if (filter) rows = rows.filter((t) => playlists.matches(t, filter));
          if (q.sessionId != null) {
            const played = history.sessionTracks(q.sessionId);
            if (!played)
              throw { code: -32602, message: "no session", data: { reason: "session_not_found" } };
            const ids = new Set(rows.map((t) => t.id));
            const ordered = played.filter((t) => ids.has(t.id));
            if (q.sort === "position") {
              const start = q.offset ?? 0;
              const list = q.descending ? [...ordered].reverse() : ordered;
              return {
                total: list.length,
                items: list.slice(start, start + (q.limit ?? 200)).map(withCues),
              };
            }
            rows = ordered;
          }
          const inPlaylist = playlists.select(q, rows);
          if (inPlaylist?.ordered && q.sort === "position") {
            const ordered = q.descending ? [...inPlaylist.rows].reverse() : inPlaylist.rows;
            const start = q.offset ?? 0;
            return {
              total: ordered.length,
              items: ordered.slice(start, start + (q.limit ?? 200)).map(withCues),
            };
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
          return {
            total: rows.length,
            items: rows.slice(offset, offset + (q.limit ?? 200)).map(withCues),
          };
        }
        case "library.addPaths": {
          const jobId = `preview-${Date.now()}`;
          void runImport(jobId);
          return { jobId };
        }
        // A simulated queue: each track walks the engine's stages, then gets its sample data.
        case "analysis.start":
        case "analysis.reanalyze": {
          const asked = (p as { trackIds?: number[] | null } | null)?.trackIds;
          const ids = (
            asked?.length
              ? tracks.filter((t) => asked.includes(t.id))
              : tracks.filter((t) => t.status === "pending")
          ).map((t) => t.id);
          if (!ids.length) return { jobId: null, queued: 0 };
          const jobId = `analysis-${Date.now()}`;
          void runAnalysis(jobId, ids);
          return { jobId, queued: ids.length };
        }
        case "library.stats":
          return fakeLibraryStats(tracks);
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
        case "library.get":
          return fullDetail((p as { trackId: number }).trackId);
        case "mix.points": {
          const q = p as MixPointsParams;
          return fakeMixPoints(q, fullDetail(q.trackA), fullDetail(q.trackB));
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
              const gain =
                q.options?.writeReplaygain && t?.replaygainDb != null
                  ? [
                      {
                        field: "replaygain_track_gain",
                        before: null,
                        after: `${t.replaygainDb > 0 ? "+" : ""}${t.replaygainDb.toFixed(2)} dB`,
                      },
                      { field: "replaygain_track_peak", before: null, after: "1.047129" },
                    ]
                  : [];
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
                  ].filter(
                    ({ field }) =>
                      (field !== "key" || q.options?.writeKey !== false) &&
                      (field !== "bpm" || q.options?.writeBpm !== false) &&
                      (field !== "comment" || q.options?.writeComment !== false),
                  )
                : [];
              return { trackId, path: t?.path ?? "", changes: [...changes, ...gain], error: null };
            }),
          };
        }
        case "tags.cleanPreview":
        case "tags.editPreview": {
          const q = p as {
            trackIds: number[];
            values?: Record<string, string>;
            rules?: { fixCaps?: boolean };
          };
          return {
            items: q.trackIds.map((trackId, i) => {
              const t = tracks.find((x) => x.id === trackId);
              const title = t?.title ?? "";
              const changes = q.values
                ? Object.entries(q.values).map(([field, after]) => {
                    const before = (t as Record<string, unknown> | undefined)?.[field];
                    return { field, before: before == null ? null : String(before), after };
                  })
                : i % 3 === 0
                  ? [
                      {
                        field: "title",
                        before: `0${i + 1} - ${title.toUpperCase()} [Free Download]`,
                        // Capitals → Title Case is off by default, as in the engine.
                        after: q.rules?.fixCaps ? title : title.toUpperCase(),
                      },
                      { field: "comment", before: "www.promo-site.com", after: "" },
                    ]
                  : [];
              return { trackId, path: t?.path ?? "", changes, error: null };
            }),
          };
        }
        case "tags.history":
          return { items: tagHistory.filter((b) => b.written > 0) };
        case "tags.clean":
        case "tags.edit":
        case "tags.write":
        case "tags.undo": {
          const jobId = `preview-tags-${Date.now()}`;
          const kind = method === "tags.undo" ? method : "tags.write";
          const ids = (p as { trackIds?: number[] }).trackIds ?? [];
          const batchId =
            method === "tags.undo"
              ? (p as { batchId: string }).batchId
              : `preview-${tagHistory.length}`;
          const undone = tagHistory.find((b) => b.batchId === batchId);
          if (method === "tags.undo" && undone) {
            undone.undoneAt = new Date().toISOString();
            undone.undoable = 0;
          } else if (method !== "tags.undo") {
            tagHistory.unshift({
              batchId,
              kind: method === "tags.write" ? "results" : method.slice(5),
              createdAt: new Date().toISOString(),
              written: ids.length,
              undoneAt: null,
              undoable: ids.length,
              fields:
                method === "tags.write"
                  ? ["key", "bpm", "comment"]
                  : method === "tags.clean"
                    ? ["title", "comment"]
                    : Object.keys((p as { values?: object }).values ?? {}),
              titles: ids.slice(0, 3).map((id) => tracks.find((t) => t.id === id)?.title ?? ""),
            });
          }
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
                    ? { batchId, written: ids.length, unchanged: 0, failed: [] }
                    : { batchId, restored: undone?.written ?? 0, skipped: [] },
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
            bpmRange: u.bpmRange ?? settings.bpmRange,
            analysisWorkers: u.analysisWorkers ?? settings.analysisWorkers,
            cueColors: u.cueColors ?? settings.cueColors,
            checkUpdates: u.checkUpdates ?? settings.checkUpdates,
            tagOptions: { ...DEFAULT_TAG_OPTIONS, ...(u.tagOptions ?? settings.tagOptions) },
            watchedFolders: u.watchedFolders ?? settings.watchedFolders,
            stemModel: u.stemModel ?? settings.stemModel,
            stemDevice: u.stemDevice ?? settings.stemDevice,
            dawFolder: u.dawFolder ?? settings.dawFolder,
            stemExportFormat: u.stemExportFormat ?? settings.stemExportFormat,
            stemExportTemplate: u.stemExportTemplate ?? settings.stemExportTemplate,
            importPolicy: u.importPolicy ?? settings.importPolicy,
            historyAvoidDays: u.historyAvoidDays ?? settings.historyAvoidDays,
            mixPointStyle: u.mixPointStyle ?? settings.mixPointStyle,
          };
          return settings;
        }
        case "quality.spectrogram": {
          const { trackId } = p as { trackId: number };
          const found = tracks.find((x) => x.id === trackId);
          if (!found)
            throw { code: -32602, message: "unknown track", data: { reason: "track_not_found" } };
          return fakeSpectrogram(found);
        }
        case "quality.review": {
          const { trackIds, reviewed } = p as QualityReviewParams;
          let updated = 0;
          tracks = tracks.map((t) => {
            if (!trackIds.includes(t.id) || t.status !== "ready") return t;
            updated += 1;
            return { ...t, qualityReviewed: reviewed === false ? [] : [...(t.qualityFlags ?? [])] };
          });
          return { updated };
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
        case "export.virtualdjStatus":
          return { collectionPath: null, running: true };
        case "export.engineDjStatus":
          return {
            collectionPath: "/Users/dj/Music/Engine Library/Database2/m.db",
            running: false,
          };
        case "stems.status":
          return stemsStatus();
        case "stems.get": {
          const id = (p as { trackId: number }).trackId;
          const model = stemSets.get(id);
          if (!model) return { stems: null };
          const dir = `/Users/dj/Library/Caches/org.tonalia.app/stems/${id}-${model}`;
          return {
            stems: {
              trackId: id,
              model,
              createdAt: new Date().toISOString(),
              vocals: `${dir}/vocals.flac`,
              drums: `${dir}/drums.flac`,
              bass: `${dir}/bass.flac`,
              other: `${dir}/other.flac`,
              instrumental: `${dir}/instrumental.flac`,
            },
          };
        }
        case "stems.clearCache":
          stemSets.clear();
          return { bytes: 0, tracks: 0 };
        case "stems.downloadGpu": {
          const jobId = `preview-gpu-${Date.now()}`;
          simulateJob(jobId, "stems.downloadGpu", "download", () => {
            gpuState = "active";
            return gpuRuntime();
          });
          return { jobId };
        }
        case "stems.removeGpu":
          gpuState = "not_installed";
          return stemsStatus();
        case "stems.downloadModel": {
          const jobId = `preview-stems-${Date.now()}`;
          const model = (p as { model: "htdemucs_ft" | "htdemucs" }).model;
          simulateJob(jobId, "stems.download", "download", () => {
            stemModels[model] = true;
            return { model, downloadedBytes: 1 };
          });
          return { jobId };
        }
        case "stems.separate": {
          const jobId = `preview-stems-${Date.now()}`;
          const ids = (p as { trackIds: number[] }).trackIds;
          simulateJob(
            jobId,
            "stems.separate",
            "stems",
            () => {
              for (const id of ids) stemSets.set(id, settings.stemModel);
              return {
                model: settings.stemModel,
                device: "mps",
                separated: ids,
                cached: [],
                failed: [],
              };
            },
            ids[0] ?? null,
          );
          return { jobId };
        }
        case "stems.exportPreview": {
          const e = p as StemExportParams;
          const folder = e.destination ?? settings.dawFolder;
          if (!folder) throw { code: -32602, message: "choose a destination folder" };
          const ext = e.format ?? settings.stemExportFormat;
          const names = e.items.map((item) => {
            const t = tracks.find((x) => x.id === item.trackId);
            const label = e.stemLabels?.[item.source ?? "mix"] ?? item.source ?? "mix";
            const key =
              t?.keyRoot != null && t.keyMode
                ? formatKey(makeKey(t.keyRoot, t.keyMode), settings.notation)
                : "";
            return `${t?.artist ?? ""} - ${t?.title ?? "?"} (${label}) [${key} ${t?.bpm ?? ""}].${ext}`;
          });
          return { folder, names };
        }
        case "render.preview": {
          const spec = p as RenderSpec;
          const t = tracks.find((x) => x.id === spec.trackId);
          if (!t) throw { code: -32602, message: "unknown track" };
          return previewRender(t, spec);
        }
        case "suggest.mashups":
        case "suggest.mixouts":
          return fakeSuggest(
            tracks,
            p as SuggestParams,
            method === "suggest.mashups" ? "mashup" : "mix",
          );
        case "stems.export": {
          const jobId = `preview-export-${Date.now()}`;
          const e = p as StemExportParams;
          const folder = e.destination ?? settings.dawFolder;
          simulateJob(jobId, "stems.export", "export", () => ({
            folder,
            files: e.items.map((item, i) => ({
              trackId: item.trackId,
              source: item.source ?? "mix",
              path: `${folder}/export-${i + 1}.${e.format ?? settings.stemExportFormat}`,
            })),
            failed: [],
          }));
          return { jobId };
        }
        case "export.traktorStatus":
          return {
            collectionPath: "/Users/dj/Documents/Native Instruments/Traktor 4.0.2/collection.nml",
            running: false,
          };
        case "export.traktor":
        case "export.serato":
        case "export.virtualdj":
        case "export.engineDj":
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
                  // Each target writes its own file (the collection it found, or its export).
                  path: o.path ?? PREVIEW_EXPORT_PATHS[method] ?? "",
                  tracks: tracks.length,
                  cues: tracks.reduce((sum, t) => sum + cuesOf(t).length, 0),
                  playlists: 8,
                  skipped: 1,
                  backupPath:
                    o.simulate === false
                      ? "/Users/dj/…/backups/rekordbox/20261011-rekordbox.xml"
                      : null,
                  items: tracks.slice(0, 8).map((t, i) => ({
                    trackId: t.id,
                    title: t.title ?? "",
                    action:
                      method === "export.rekordbox" ? "exported" : i % 3 ? "updated" : "added",
                    cues: 4 + (i % 4),
                  })),
                  // Like the engine: every track still to analyse goes out with a warning.
                  warnings: [
                    { code: "unsupported_format", trackId: 3, path: "/Users/dj/Música/demo.ogg" },
                    ...tracks
                      .filter((t) => t.status !== "ready")
                      .map((t) => ({ code: "not_analyzed", trackId: t.id, path: null })),
                  ],
                },
              },
            });
          }, 600);
          return { jobId };
        }
        default:
          if (method.startsWith("playlists.")) return playlists.call(method, p);
          if (method.startsWith("favorites.")) return favorites.call(method, p);
          if (method.startsWith("builder.")) return builder.call(method, p);
          if (method.startsWith("energy.")) return energy.call(method, p);
          if (method.startsWith("grid.")) return grid.call(method, p);
          if (method.startsWith("cueReview.")) return cueReview.call(method, p);
          if (method === "import.preview" || method === "import.apply") {
            const jobId = `preview-import-${Date.now()}`;
            const o = p as ImportOptions;
            setTimeout(() => {
              void emit("engine://event", {
                type: "job.finished",
                payload: {
                  jobId,
                  kind: method,
                  status: "done",
                  error: null,
                  result: method === "import.apply" ? djImport.apply(o) : djImport.report(o, true),
                },
              });
            }, 700);
            return { jobId };
          }
          if (method === "duplicates.scan") {
            const jobId = `preview-duplicates-${Date.now()}`;
            [20, 55, 85].forEach((percent, i) =>
              setTimeout(
                () => {
                  void emit("engine://progress", {
                    jobId,
                    stage: percent > 80 ? "grouping" : "fingerprints",
                    percent,
                  });
                },
                300 * (i + 1),
              ),
            );
            setTimeout(() => {
              void emit("engine://event", {
                type: "job.finished",
                payload: {
                  jobId,
                  kind: method,
                  status: "done",
                  error: null,
                  result: duplicates.scan(),
                },
              });
            }, 1300);
            return { jobId };
          }
          if (method.startsWith("duplicates.")) return duplicates.call(method, p);
          if (method === "history.import") {
            const jobId = `preview-history-${Date.now()}`;
            setTimeout(() => {
              void emit("engine://event", {
                type: "job.finished",
                payload: {
                  jobId,
                  kind: method,
                  status: "done",
                  error: null,
                  result: history.importHistory(p as HistoryImportParams),
                },
              });
            }, 800);
            return { jobId };
          }
          if (method.startsWith("history.")) return history.call(method, p);
          if (method === "convert.plan" || method === "convert.apply") {
            const jobId = `preview-convert-${Date.now()}`;
            const o = p as ConvertOptions;
            setTimeout(() => {
              void emit("engine://event", {
                type: "job.finished",
                payload: {
                  jobId,
                  kind: method,
                  status: "done",
                  error: null,
                  result: djImport.convert(o, method === "convert.plan"),
                },
              });
            }, 900);
            return { jobId };
          }
          if (method.startsWith("import.")) return djImport.call(method, p);
          throw { code: -32601, message: `method not found: ${method}` };
      }
    },
    { shouldMockEvents: true },
  );
}
