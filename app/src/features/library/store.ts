import { create } from "zustand";
import type { LibraryQuery, TrackFilter } from "../../lib/rpc.types";

export type SortColumn = NonNullable<LibraryQuery["sort"]>;

/** Regular playlists keep their own sort (position first); everything else shares one. */
export type SortScope = "library" | "playlist";

export type Density = "comfortable" | "compact";

export const ROW_HEIGHT: Record<Density, number> = { comfortable: 36, compact: 28 };
/** The table's column header (`h-8` in TrackTable). */
export const TABLE_HEADER = 32;

const DENSITY_KEY = "tonalia.library.density";

function loadDensity(): Density {
  try {
    return localStorage.getItem(DENSITY_KEY) === "compact" ? "compact" : "comfortable";
  } catch {
    return "comfortable";
  }
}

/** Columns that read better largest/newest first when first selected. */
const DESCENDING_FIRST: ReadonlySet<SortColumn> = new Set([
  "added_at",
  "energy",
  "bpm",
  "year",
  "times_played",
  "last_played",
]);

interface LibraryState {
  search: string;
  sort: SortColumn;
  descending: boolean;
  /** Sort of regular playlists (their own order by default). */
  playlistSort: SortColumn;
  playlistDescending: boolean;
  density: Density;
  /** Advanced filters (SPEC 2.14); they apply on top of the open view. */
  filter: TrackFilter;
  setFilter: (filter: TrackFilter) => void;
  /** Selected track ids (click, Cmd/Ctrl-click to toggle, Shift-click for a range). */
  selected: number[];
  setSelected: (ids: number[]) => void;
  /** Which list the selection belongs to ("all", "queue", "playlist:3"…). */
  list: string;
  /**
   * Called when a list shows: a different list clears the selection, so it never
   * follows the DJ into a list where those tracks are not (nor scopes Tags or Export
   * from there). Coming back to the same list — from the detail, Tags… — keeps it.
   */
  enterList: (list: string) => void;
  setSearch: (search: string) => void;
  toggleSort: (column: SortColumn, scope?: SortScope) => void;
  setDensity: (density: Density) => void;
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  search: "",
  sort: "added_at",
  descending: true,
  playlistSort: "position",
  playlistDescending: false,
  density: loadDensity(),
  filter: {},
  setFilter: (filter) => set({ filter, selected: [] }),
  selected: [],
  setSelected: (selected) => set({ selected }),
  list: "all",
  enterList: (list) => {
    if (get().list !== list) set({ list, selected: [] });
  },
  setSearch: (search) => set({ search, selected: [] }),
  toggleSort: (column, scope = "library") =>
    set((s) => {
      if (scope === "playlist") {
        return s.playlistSort === column
          ? { playlistDescending: !s.playlistDescending }
          : { playlistSort: column, playlistDescending: DESCENDING_FIRST.has(column) };
      }
      return s.sort === column
        ? { descending: !s.descending }
        : { sort: column, descending: DESCENDING_FIRST.has(column) };
    }),
  setDensity: (density) => {
    try {
      localStorage.setItem(DENSITY_KEY, density);
    } catch {
      // Not persisted; the choice still applies to this session.
    }
    set({ density });
  },
}));
