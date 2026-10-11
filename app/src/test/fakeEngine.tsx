// In-memory stand-in for the engine used by component tests. It answers the JSON-RPC
// methods the UI calls through `invoke("engine_request")` and lets tests emit events.
import { DEFAULT_TAG_OPTIONS } from "../features/settings/api";
import { QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { fileStem } from "../lib/format";
import { createQueryClient } from "../lib/queryClient";
import type {
  Cue,
  CueSetParams,
  CueSlotParams,
  LibraryQuery,
  TrackDetail,
  Settings,
  SettingsUpdate,
  TrackSummary,
  TrackUpdateParams,
} from "../lib/rpc.types";

type Listener = (ev: { payload: unknown }) => void;

export const listeners = new Map<string, Listener>();
export const calls: { method: string; params: unknown }[] = [];

export const engine = {
  connected: true,
  tracks: [] as TrackSummary[],
  nextJobId: 1,
  settings: {
    notation: "alphanumeric",
    bpmDecimals: 2,
    cueCount: 8,
    tagOptions: DEFAULT_TAG_OPTIONS,
  } as Required<Settings>,
  /** Extra detail fields per track id (merged into library.get). */
  details: new Map<number, Partial<TrackDetail>>(),
  cues: new Map<number, Cue[]>(),
};

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
  calls.push(args);
  if (!engine.connected) throw { code: -32000, message: "engine not running" };
  switch (args.method) {
    case "engine.ping":
      return { pong: true };
    case "library.list":
      return list((args.params ?? {}) as LibraryQuery);
    case "library.addPaths":
      return { jobId: `job-${engine.nextJobId++}` };
    case "job.cancel":
      return { cancelled: true };
    case "settings.get":
      return engine.settings;
    case "settings.set": {
      const update = args.params as SettingsUpdate;
      engine.settings = {
        notation: update.notation ?? engine.settings.notation,
        bpmDecimals: update.bpmDecimals ?? engine.settings.bpmDecimals,
        cueCount: update.cueCount ?? engine.settings.cueCount,
        tagOptions: {
          ...DEFAULT_TAG_OPTIONS,
          ...(update.tagOptions ?? engine.settings.tagOptions),
        },
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
    case "tags.clean":
    case "tags.edit":
    case "tags.write":
    case "tags.undo":
      return { jobId: `job-${engine.nextJobId++}` };
    case "track.update":
      return updateTrack(args.params as TrackUpdateParams);
    default:
      throw { code: -32601, message: `method not found: ${args.method}` };
  }
}

export function emit(channel: string, payload: unknown) {
  listeners.get(channel)?.({ payload });
}

export function resetEngine() {
  listeners.clear();
  calls.length = 0;
  engine.connected = true;
  engine.tracks = [];
  engine.nextJobId = 1;
  engine.settings = {
    notation: "alphanumeric",
    bpmDecimals: 2,
    cueCount: 8,
    tagOptions: DEFAULT_TAG_OPTIONS,
  };
  engine.details.clear();
  engine.cues.clear();
}

export function renderWithQuery(ui: ReactElement) {
  return render(<QueryClientProvider client={createQueryClient()}>{ui}</QueryClientProvider>);
}
