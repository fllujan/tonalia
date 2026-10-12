// In-memory stand-in for the engine used by component tests. It answers the JSON-RPC
// methods the UI calls through `invoke("engine_request")` and lets tests emit events.
import { DEFAULT_SETTINGS, DEFAULT_TAG_OPTIONS } from "../features/settings/api";
import { QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { createFakeBuilder } from "../dev/fakeBuilder";
import { createFakeFavorites } from "../dev/fakeFavorites";
import { createFakePlaylists } from "../dev/fakePlaylists";
import { fakeSuggest } from "../dev/fakeSuggest";
import { fileStem } from "../lib/format";
import type { ThirdPartyListing, ThirdPartyPackage } from "../lib/system";
import { createQueryClient } from "../lib/queryClient";
import type {
  Cue,
  CueSetParams,
  CueSlotParams,
  LibraryQuery,
  TrackDetail,
  Settings,
  SettingsUpdate,
  RenderSpec,
  StemExportParams,
  SuggestParams,
  TrackSummary,
  TrackUpdateParams,
  StemModelStatus,
  StemSet,
  StemsCacheInfo,
  TagBatchInfo,
} from "../lib/rpc.types";

type Listener = (ev: { payload: unknown }) => void;

export const listeners = new Map<string, Listener>();
export const calls: { method: string; params: unknown }[] = [];
export const revealed: string[] = [];
/** Rust-core commands other than engine requests (e.g. "open_logs_folder"). */
export const commands: string[] = [];

export const engine = {
  connected: true,
  tracks: [] as TrackSummary[],
  nextJobId: 1,
  settings: {
    notation: "alphanumeric",
    bpmDecimals: 2,
    cueCount: 8,
    bpmRange: [70, 180],
    analysisWorkers: 0,
    cueColors: DEFAULT_SETTINGS.cueColors,
    tagOptions: DEFAULT_TAG_OPTIONS,
    watchedFolders: [],
    stemModel: "htdemucs_ft",
    stemDevice: "auto",
    dawFolder: "",
    stemExportFormat: "wav",
    stemExportTemplate: "{artist} - {title} ({stem}) [{key} {bpm}]",
    checkUpdates: true,
  } as Required<Settings>,
  /** What tags.history returns. */
  tagHistory: [] as TagBatchInfo[],
  /** Extra detail fields per track id (merged into library.get). */
  details: new Map<number, Partial<TrackDetail>>(),
  cues: new Map<number, Cue[]>(),
  traktorStatus: { collectionPath: null as string | null, running: false },
  engineDjStatus: { collectionPath: null as string | null, running: false },
  stems: freshStems(),
  /** When set, render.preview fails with this message. */
  renderError: null as string | null,
  /** The generated attributions (null: the list was never generated). */
  thirdParty: freshThirdParty() as ThirdPartyListing | null,
};

function freshThirdParty(): ThirdPartyListing {
  const pkg = (
    name: string,
    license: string,
    component: ThirdPartyPackage["component"],
    note = "",
  ): ThirdPartyPackage => ({ name, version: "1.0.0", license, component, url: "", note });
  return {
    version: 1,
    target: "aarch64-apple-darwin",
    packages: [
      pkg("FFmpeg", "GPL-3.0-or-later", "bundled", "ffmpeg"),
      pkg("numpy", "BSD-3-Clause", "engine"),
      pkg("react", "MIT", "app"),
      pkg("serde", "MIT OR Apache-2.0", "core"),
    ],
    acknowledgements: [{ key: "keyProfiles" }],
  };
}

function freshStems() {
  return {
    models: [
      {
        model: "htdemucs_ft",
        installed: false,
        totalBytes: 336_565_084,
        missingBytes: 336_565_084,
      },
      { model: "htdemucs", installed: false, totalBytes: 84_141_911, missingBytes: 84_141_911 },
    ] as StemModelStatus[],
    accelerator: "mps" as "mps" | "cuda" | null,
    cache: { bytes: 0, tracks: 0 } as StemsCacheInfo,
    sets: new Map<number, StemSet>(),
  };
}

/** A complete stem set for a track (what stems.get returns after a separation). */
export function stemSet(trackId: number, model: StemSet["model"] = "htdemucs_ft"): StemSet {
  const dir = `/cache/stems/${trackId}-${model}`;
  return {
    trackId,
    model,
    vocals: `${dir}/vocals.flac`,
    drums: `${dir}/drums.flac`,
    bass: `${dir}/bass.flac`,
    other: `${dir}/other.flac`,
    instrumental: `${dir}/instrumental.flac`,
    createdAt: "2026-10-12T10:00:00Z",
  };
}

function detail(trackId: number): TrackDetail {
  const t = engine.tracks.find((x) => x.id === trackId);
  if (!t) throw { code: -32602, message: `unknown track ${trackId}` };
  const cues = engine.cues.get(trackId) ?? [];
  return { ...t, cueCount: cues.length, cues, ...engine.details.get(trackId) } as TrackDetail;
}

function setCue(p: CueSetParams): Cue {
  const cue: Cue = {
    slot: p.slot,
    positionSec: p.positionSec,
    label: p.label ?? null,
    color: p.color ?? null,
    source: "user",
  };
  const list = (engine.cues.get(p.trackId) ?? []).filter((c) => c.slot !== p.slot);
  engine.cues.set(
    p.trackId,
    [...list, cue].sort((a, b) => a.slot - b.slot),
  );
  return cue;
}

function updateTrack(p: TrackUpdateParams) {
  const t = engine.tracks.find((x) => x.id === p.trackId);
  if (!t) throw { code: -32602, message: `unknown track ${p.trackId}` };
  const edited = new Set(t.editedFields ?? []);
  if ("key" in p) {
    t.keyRoot = p.key?.root ?? null;
    t.keyMode = p.key?.mode ?? null;
    t.keyConfidence = null;
    edited.add("key");
  }
  if ("bpm" in p) {
    t.bpm = p.bpm ?? null;
    edited.add("bpm");
  }
  t.editedFields = [...edited].sort();
  return t;
}

export const fakePlaylists = createFakePlaylists(() => engine.tracks);
export const addPlaylist = fakePlaylists.add;
export const fakeFavorites = createFakeFavorites(() => engine.tracks);
const fakeBuilder = createFakeBuilder(
  () => engine.tracks,
  (playlistId) =>
    fakePlaylists.select({ playlistId } as LibraryQuery, engine.tracks)?.rows.map((t) => t.id) ??
    [],
);

export function track(id: number, overrides: Partial<TrackSummary> = {}): TrackSummary {
  return {
    id,
    path: `/Users/dj/Música/Track ${id}.flac`,
    title: `Track ${id}`,
    artist: "Lumen Drift",
    album: null,
    genre: "Melodic House",
    year: 2024,
    duration: 372,
    format: "flac",
    bitrate: 900,
    status: "pending",
    error: null,
    addedAt: "2026-10-11T09:30:00.000Z",
    artworkPath: null,
    keyRoot: null,
    keyMode: null,
    keyConfidence: null,
    bpm: null,
    energy: null,
    cueCount: 0,
    editedFields: [],
    qualityFlags: [],
    ...overrides,
  };
}

function list(q: LibraryQuery) {
  let rows = engine.tracks;
  const filter = q.filter;
  if (filter) rows = rows.filter((r) => fakePlaylists.matches(r, filter));
  const inPlaylist = fakePlaylists.select(q, rows);
  if (inPlaylist) {
    rows = inPlaylist.rows;
    if (inPlaylist.ordered && q.sort === "position") {
      if (q.descending) rows = [...rows].reverse();
      const offset = q.offset ?? 0;
      return { total: rows.length, items: rows.slice(offset, offset + (q.limit ?? 200)) };
    }
  }
  if (q.qualityIssues != null) {
    rows = rows.filter((r) => (r.qualityFlags?.length ?? 0) > 0 === q.qualityIssues);
  }
  if (q.search) {
    const s = q.search.toLowerCase();
    rows = rows.filter((r) => `${r.title} ${r.artist} ${r.path}`.toLowerCase().includes(s));
  }
  const key = q.sort ?? "added_at";
  const field = key === "added_at" ? "addedAt" : key;
  // Like the engine: titles sort by the tag, or by the file name when untagged.
  const value = (r: TrackSummary) =>
    field === "title"
      ? (r.title ?? fileStem(r.path))
      : String((r as unknown as Record<string, unknown>)[field] ?? "");
  rows = [...rows].sort((a, b) => {
    const av = value(a);
    const bv = value(b);
    return av.localeCompare(bv, undefined, { numeric: true }) * (q.descending === false ? 1 : -1);
  });
  const offset = q.offset ?? 0;
  return { total: rows.length, items: rows.slice(offset, offset + (q.limit ?? 200)) };
}

export async function invoke(cmd: string, args: { method: string; params: unknown }) {
  if (cmd === "allow_playback") return null;
  if (cmd === "third_party_licenses") {
    if (!engine.thirdParty) throw "third-party list not found (binaries/licenses/third-party.json)";
    return engine.thirdParty;
  }
  if (cmd === "open_logs_folder" || cmd === "open_third_party_notices") {
    commands.push(cmd);
    return null;
  }
  if (cmd === "reveal_file") {
    revealed.push((args as unknown as { path: string }).path);
    return null;
  }
  calls.push(args);
  if (!engine.connected) throw { code: -32000, message: "engine not running" };
  switch (args.method) {
    case "engine.ping":
      return { pong: true };
    case "engine.version":
      return { protocol: 1, python: "3.11.9", version: "0.1.0" };
    case "library.list":
      return list((args.params ?? {}) as LibraryQuery);
    case "library.addPaths":
      return { jobId: `job-${engine.nextJobId++}` };
    case "job.cancel":
      return { cancelled: true };
    case "analysis.start":
      return { jobId: null, queued: 0 };
    case "analysis.reanalyze":
      return { jobId: null, queued: 0 };
    case "settings.get":
      return engine.settings;
    case "settings.set": {
      const update = args.params as SettingsUpdate;
      engine.settings = {
        notation: update.notation ?? engine.settings.notation,
        bpmDecimals: update.bpmDecimals ?? engine.settings.bpmDecimals,
        cueCount: update.cueCount ?? engine.settings.cueCount,
        bpmRange: update.bpmRange ?? engine.settings.bpmRange,
        analysisWorkers: update.analysisWorkers ?? engine.settings.analysisWorkers,
        cueColors: update.cueColors ?? engine.settings.cueColors,
        checkUpdates: update.checkUpdates ?? engine.settings.checkUpdates,
        tagOptions: {
          ...DEFAULT_TAG_OPTIONS,
          ...(update.tagOptions ?? engine.settings.tagOptions),
        },
        watchedFolders: update.watchedFolders ?? engine.settings.watchedFolders,
        stemModel: update.stemModel ?? engine.settings.stemModel,
        stemDevice: update.stemDevice ?? engine.settings.stemDevice,
        dawFolder: update.dawFolder ?? engine.settings.dawFolder,
        stemExportFormat: update.stemExportFormat ?? engine.settings.stemExportFormat,
        stemExportTemplate: update.stemExportTemplate ?? engine.settings.stemExportTemplate,
      };
      return engine.settings;
    }
    case "library.genres":
      return {
        genres: [
          { name: "Melodic House", count: 3 },
          { name: "Techno", count: 1 },
        ],
      };
    case "library.get":
      return detail((args.params as { trackId: number }).trackId);
    case "cues.list":
      return { cues: engine.cues.get((args.params as { trackId: number }).trackId) ?? [] };
    case "cues.set":
      return setCue(args.params as CueSetParams);
    case "cues.delete": {
      const p = args.params as CueSlotParams;
      const list = engine.cues.get(p.trackId) ?? [];
      engine.cues.set(
        p.trackId,
        list.filter((c) => c.slot !== p.slot),
      );
      return { deleted: list.some((c) => c.slot === p.slot) };
    }
    case "cues.resetAuto": {
      const id = (args.params as { trackId: number }).trackId;
      const auto = (engine.cues.get(id) ?? []).filter((c) => c.source === "auto");
      engine.cues.set(id, auto);
      return { cues: auto };
    }
    case "tags.preview": {
      const p = args.params as { trackIds: number[]; options?: { commentTemplate?: string } };
      return {
        items: p.trackIds.map((trackId) => {
          const t = engine.tracks.find((x) => x.id === trackId);
          return {
            trackId,
            path: t?.path ?? "",
            changes: [
              { field: "key", before: null, after: "8A" },
              {
                field: "comment",
                before: "Free download",
                after: `${p.options?.commentTemplate ?? ""} | Free download`,
              },
            ],
            error: null,
          };
        }),
      };
    }
    case "tags.cleanPreview":
    case "tags.editPreview": {
      const p = args.params as { trackIds: number[]; values?: Record<string, string> };
      return {
        items: p.trackIds.map((trackId) => ({
          trackId,
          path: engine.tracks.find((x) => x.id === trackId)?.path ?? "",
          changes: p.values
            ? Object.entries(p.values).map(([field, after]) => ({ field, before: "old", after }))
            : [{ field: "title", before: "01 - MIDNIGHT BLOOM", after: "Midnight Bloom" }],
          error: null,
        })),
      };
    }
    case "export.traktorStatus":
      return engine.traktorStatus;
    case "export.virtualdjStatus":
      return { collectionPath: null, running: false };
    case "export.engineDjStatus":
      return engine.engineDjStatus;
    case "export.rekordbox":
    case "export.traktor":
    case "export.serato":
    case "export.virtualdj":
    case "export.engineDj":
    case "tags.clean":
    case "tags.edit":
    case "tags.write":
    case "tags.undo":
      return { jobId: `job-${engine.nextJobId++}` };
    case "tags.history":
      return { items: engine.tagHistory };
    case "stems.status":
      return {
        models: engine.stems.models,
        accelerator: engine.stems.accelerator,
        cache: engine.stems.cache,
      };
    case "stems.get": {
      const p = args.params as { trackId: number };
      return { stems: engine.stems.sets.get(p.trackId) ?? null };
    }
    case "stems.clearCache":
      engine.stems.sets.clear();
      engine.stems.cache = { bytes: 0, tracks: 0 };
      return engine.stems.cache;
    case "stems.exportPreview":
      return exportPreview(args.params as StemExportParams);
    case "stems.downloadModel":
    case "stems.separate":
    case "stems.export":
      return { jobId: `job-${engine.nextJobId++}` };
    case "render.preview": {
      if (engine.renderError) throw { code: -32602, message: engine.renderError };
      const spec = args.params as RenderSpec;
      const t = engine.tracks.find((x) => x.id === spec.trackId);
      const source = spec.source ?? "mix";
      if (source !== "mix" && !engine.stems.sets.has(spec.trackId))
        throw { code: -32602, message: "the stems of this track are not separated yet" };
      const ratio = spec.targetBpm && t?.bpm ? t.bpm / spec.targetBpm : 1;
      const duration = (spec.duration ?? 30) * ratio;
      return {
        result: {
          path: `/data/cache/render/${spec.trackId}-${source}-${spec.start ?? 0}-${spec.semitones ?? 0}-${spec.duration ?? 0}.wav`,
          sampleRate: 44100,
          frames: Math.round(duration * 44100),
          duration,
          bpm: spec.targetBpm ?? t?.bpm ?? null,
          timeRatio: ratio,
          // A different first downbeat per track, so the sync has something to do.
          firstDownbeat: Math.round(((spec.trackId * 0.173) % 1) * 44100),
          cached: true,
        },
      };
    }
    case "suggest.mashups":
    case "suggest.mixouts":
      return fakeSuggest(
        engine.tracks,
        args.params as SuggestParams,
        args.method === "suggest.mashups" ? "mashup" : "mix",
      );
    case "track.update":
      return updateTrack(args.params as TrackUpdateParams);
    default:
      if (args.method.startsWith("playlists.")) return fakePlaylists.call(args.method, args.params);
      if (args.method.startsWith("favorites.")) return fakeFavorites.call(args.method, args.params);
      if (args.method.startsWith("builder.")) return fakeBuilder.call(args.method, args.params);
      throw { code: -32601, message: `method not found: ${args.method}` };
  }
}

const STEM_LABELS: Record<string, string> = {
  mix: "Track",
  vocals: "Vocals",
  drums: "Drums",
  bass: "Bass",
  other: "Other",
  instrumental: "Instrumental",
};

/** Simplified stems.exportPreview: "<title> (<stem>).<ext>" in the chosen folder. */
function exportPreview(p: StemExportParams) {
  const folder = p.destination ?? engine.settings.dawFolder;
  if (!folder) throw { code: -32602, message: "choose a destination folder" };
  const ext = p.format ?? engine.settings.stemExportFormat;
  const names = p.items.map((item) => {
    const t = engine.tracks.find((x) => x.id === item.trackId);
    const source = item.source ?? "mix";
    const label = p.stemLabels?.[source] ?? STEM_LABELS[source];
    return `${t?.title ?? "?"} (${label}).${ext}`;
  });
  return { folder, names };
}

export function emit(channel: string, payload: unknown) {
  listeners.get(channel)?.({ payload });
}

export function resetEngine() {
  listeners.clear();
  calls.length = 0;
  revealed.length = 0;
  commands.length = 0;
  engine.connected = true;
  engine.tracks = [];
  engine.nextJobId = 1;
  engine.settings = { ...DEFAULT_SETTINGS };
  engine.stems = freshStems();
  engine.details.clear();
  engine.tagHistory = [];
  engine.renderError = null;
  engine.thirdParty = freshThirdParty();
  engine.cues.clear();
  fakePlaylists.reset();
  fakeFavorites.reset();
  engine.traktorStatus = { collectionPath: null, running: false };
  engine.engineDjStatus = { collectionPath: null, running: false };
}

export function renderWithQuery(ui: ReactElement) {
  return render(<QueryClientProvider client={createQueryClient()}>{ui}</QueryClientProvider>);
}
