// In-memory stand-in for the engine used by component tests. It answers the JSON-RPC
// methods the UI calls through `invoke("engine_request")` and lets tests emit events.
import { QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { fileStem } from "../lib/format";
import { createQueryClient } from "../lib/queryClient";
import type {
  LibraryQuery,
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
  settings: { notation: "alphanumeric", bpmDecimals: 2, cueCount: 8 } as Required<Settings>,
};

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
    ...overrides,
  };
}

function list(q: LibraryQuery) {
  let rows = engine.tracks;
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

export async function invoke(_cmd: string, args: { method: string; params: unknown }) {
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
      };
      return engine.settings;
    }
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
  engine.settings = { notation: "alphanumeric", bpmDecimals: 2, cueCount: 8 };
}

export function renderWithQuery(ui: ReactElement) {
  return render(<QueryClientProvider client={createQueryClient()}>{ui}</QueryClientProvider>);
}
