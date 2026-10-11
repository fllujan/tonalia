import { create } from "zustand";
import type { LibraryQuery } from "../../lib/rpc.types";

export type SortColumn = NonNullable<LibraryQuery["sort"]>;

export type Density = "comfortable" | "compact";

export const ROW_HEIGHT: Record<Density, number> = { comfortable: 36, compact: 28 };

const DENSITY_KEY = "tonalia.library.density";

function loadDensity(): Density {
  try {
    return localStorage.getItem(DENSITY_KEY) === "compact" ? "compact" : "comfortable";
  } catch {
    return "comfortable";
  }
}

/** Columns that read better largest/newest first when first selected. */
const DESCENDING_FIRST: ReadonlySet<SortColumn> = new Set(["added_at", "energy", "bpm", "year"]);

interface LibraryState {
  search: string;
  sort: SortColumn;
  descending: boolean;
  density: Density;
  /** Selected track ids (click, Cmd/Ctrl-click to toggle, Shift-click for a range). */
  selected: number[];
  setSelected: (ids: number[]) => void;
  setSearch: (search: string) => void;
  toggleSort: (column: SortColumn) => void;
  setDensity: (density: Density) => void;
}

export const useLibraryStore = create<LibraryState>((set) => ({
  search: "",
  sort: "added_at",
  descending: true,
  density: loadDensity(),
  selected: [],
  setSelected: (selected) => set({ selected }),
  setSearch: (search) => set({ search, selected: [] }),
  toggleSort: (column) =>
    set((s) =>
      s.sort === column
        ? { descending: !s.descending }
        : { sort: column, descending: DESCENDING_FIRST.has(column) },
    ),
  setDensity: (density) => {
    try {
      localStorage.setItem(DENSITY_KEY, density);
    } catch {
      // Not persisted; the choice still applies to this session.
    }
    set({ density });
  },
}));
