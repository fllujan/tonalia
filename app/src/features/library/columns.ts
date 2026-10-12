// Library table columns (DESIGN 6.2). The title takes whatever width is left; when the
// window is narrow (down to the 1200 px minimum), the least useful columns for mixing
// step aside — added date first, then duration, then genre — so titles stay readable.
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

/**
 * The Analyse view (DESIGN 6.4): its tracks have no key, BPM or energy yet, so those
 * columns give way to a wide status that shows the stage each track is at.
 */
export const QUEUE_COLUMNS: Column[] = [
  ...COLUMNS.filter((c) => ["number", "cover", "title", "genre", "duration"].includes(c.id)),
  { id: "status", label: "status", sort: "status", width: 184 },
  ...COLUMNS.filter((c) => c.id === "added"),
];

/** Order in which columns step aside when the title would get too narrow. */
export const HIDE_ORDER = ["added", "duration", "genre"] as const;
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
