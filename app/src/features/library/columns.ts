// Library table columns (DESIGN 6.2). The title takes whatever width is left; when the
// window is narrow (down to the 1200 px minimum), the least useful columns for mixing
// step aside — added date first, then the last play, duration, genre, the gain (a column
// the DJ switched on) and the play count — so titles stay readable.
import type { SortColumn } from "./store";

export interface Column {
  id: string;
  label: string;
  sort?: SortColumn;
  /** Fixed width in px; `null` is the flexible title column. */
  width: number | null;
}

export const COLUMNS: Column[] = [
  { id: "number", label: "number", width: 36 },
  { id: "cover", label: "", width: 28 },
  { id: "title", label: "title", sort: "title", width: null },
  { id: "key", label: "key", sort: "key", width: 84 },
  { id: "bpm", label: "bpm", sort: "bpm", width: 64 },
  { id: "energy", label: "energy", sort: "energy", width: 92 },
  { id: "cues", label: "cues", width: 80 },
  { id: "genre", label: "genre", sort: "genre", width: 112 },
  { id: "duration", label: "duration", sort: "duration", width: 64 },
  { id: "status", label: "status", sort: "status", width: 64 },
  { id: "added", label: "added", sort: "added_at", width: 84 },
];

/** Play history (SPEC 13.4): "Times played" and "Last played", once something was played. */
const PLAY_COLUMNS: Column[] = [
  { id: "plays", label: "plays", sort: "times_played", width: 92 },
  { id: "lastPlayed", label: "lastPlayed", sort: "last_played", width: 92 },
];

/** ReplayGain (SPEC 13.6): an optional column, switched on in Settings → General. */
const GAIN_COLUMN: Column = { id: "gain", label: "gain", sort: "replaygain", width: 76 };

function beforeAdded(columns: Column[], extra: Column[]): Column[] {
  const at = columns.findIndex((c) => c.id === "added");
  return at < 0
    ? [...columns, ...extra]
    : [...columns.slice(0, at), ...extra, ...columns.slice(at)];
}

/** `columns` with the play history columns, before the added date (or at the end). */
export function withPlays(columns: Column[]): Column[] {
  return beforeAdded(columns, PLAY_COLUMNS);
}

/** `columns` with the gain column, before the added date (after the play columns). */
export function withGain(columns: Column[]): Column[] {
  return beforeAdded(columns, [GAIN_COLUMN]);
}

/**
 * The Analyse view (DESIGN 6.4): its tracks have no key, BPM or energy yet, so those
 * columns give way to a wide status that shows the stage each track is at.
 */
export const QUEUE_COLUMNS: Column[] = [
  ...COLUMNS.filter((c) => ["number", "cover", "title", "genre", "duration"].includes(c.id)),
  { id: "status", label: "status", sort: "status", width: 184 },
  ...COLUMNS.filter((c) => c.id === "added"),
];

/**
 * Revisar calidad: a wide "Problem" column says what is wrong with each file (DESIGN
 * 6.2, critique 2026-10-12) instead of a warning icon; cue counts give way to it.
 */
export const REVIEW_COLUMNS: Column[] = [
  ...COLUMNS.filter((c) => !["cues", "status", "added"].includes(c.id)),
  { id: "problems", label: "problems", width: 240 },
  ...COLUMNS.filter((c) => c.id === "added"),
];

/** Order in which columns step aside when the title would get too narrow. */
export const HIDE_ORDER = ["added", "lastPlayed", "duration", "genre", "gain", "plays"] as const;
/** Narrowest the title column may get before a column is hidden. */
export const TITLE_MIN = 240;
const GAP = 12;
const PADDING = 40;

/**
 * The columns that fit a table `width` px wide. An unknown width (0, before layout or
 * in tests) shows every column.
 */
export function visibleColumns(width: number, all: Column[] = COLUMNS): Column[] {
  if (width <= 0) return all;
  let columns = all;
  const titleWidth = (cols: Column[]) =>
    width - PADDING - GAP * (cols.length - 1) - cols.reduce((sum, c) => sum + (c.width ?? 0), 0);
  for (const id of HIDE_ORDER) {
    if (titleWidth(columns) >= TITLE_MIN) break;
    columns = columns.filter((c) => c.id !== id);
  }
  return columns;
}

/** The CSS grid template for `columns`. */
export function gridTemplate(columns: Column[]): string {
  return columns.map((c) => (c.width == null ? "minmax(0,1fr)" : `${c.width}px`)).join(" ");
}
