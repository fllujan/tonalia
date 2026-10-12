// In-memory `favorites.*` for the component tests and the browser preview, mirroring
// engine/tonalia_engine/favorites.py: the same combination saved again is updated, lists
// sort by date or rating, favorites go away with their tracks.
import type {
  Favorite,
  FavoriteIdParams,
  FavoriteListParams,
  FavoriteSaveParams,
  FavoriteUpdateParams,
  TrackSummary,
} from "../lib/rpc.types";

const fail = (message: string) => ({ code: -32602, message });

type Stored = Omit<Favorite, "a" | "b">;

const COMBINATION = ["trackA", "trackB", "mode", "shiftA", "shiftB", "stemA", "stemB"] as const;

export function createFakeFavorites(getTracks: () => TrackSummary[]) {
  const state = { items: [] as Stored[], nextId: 1, clock: 0 };

  const withTracks = (f: Stored): Favorite | null => {
    const tracks = getTracks();
    const a = tracks.find((t) => t.id === f.trackA);
    const b = tracks.find((t) => t.id === f.trackB);
    return a && b ? { ...f, a, b } : null;
  };
  const get = (id: number): Favorite => {
    const f = state.items.find((x) => x.id === id);
    const out = f && withTracks(f);
    if (!out) throw fail(`unknown favorite ${id}`);
    return out;
  };
  const cleanNotes = (notes: string | null | undefined) => notes?.trim() || null;

  const save = (p: FavoriteSaveParams): Favorite => {
    if (p.trackA === p.trackB) throw fail("a favorite needs two different tracks");
    const ids = new Set(getTracks().map((t) => t.id));
    if (!ids.has(p.trackA) || !ids.has(p.trackB)) throw fail("unknown track");
    const full: Stored = {
      id: 0,
      trackA: p.trackA,
      trackB: p.trackB,
      mode: p.mode,
      shiftA: p.shiftA ?? 0,
      shiftB: p.shiftB ?? 0,
      cueA: p.cueA ?? null,
      cueB: p.cueB ?? null,
      stemA: p.stemA ?? "mix",
      stemB: p.stemB ?? "mix",
      bpmFactor: p.bpmFactor ?? 1,
      rating: p.rating ?? 0,
      notes: cleanNotes(p.notes),
      createdAt: "",
    };
    const same = state.items.find((f) => COMBINATION.every((k) => f[k] === full[k]));
    if (same) {
      Object.assign(same, {
        cueA: full.cueA,
        cueB: full.cueB,
        bpmFactor: full.bpmFactor,
        rating: full.rating,
        notes: full.notes ?? same.notes,
      });
      return get(same.id);
    }
    const created = new Date(Date.UTC(2026, 9, 12, 10, 0, state.clock++)).toISOString();
    state.items.push({ ...full, id: state.nextId++, createdAt: created });
    return get(state.nextId - 1);
  };

  const list = (p: FavoriteListParams | undefined): Favorite[] => {
    const byDate = (x: Stored, y: Stored) => y.createdAt.localeCompare(x.createdAt) || y.id - x.id;
    const sorted = [...state.items].sort((x, y) =>
      p?.sort === "rating" ? y.rating - x.rating || byDate(x, y) : byDate(x, y),
    );
    return sorted.map(withTracks).filter((f): f is Favorite => f != null);
  };

  const update = (p: FavoriteUpdateParams): Favorite => {
    const f = state.items.find((x) => x.id === p.favoriteId);
    if (!f) throw fail(`unknown favorite ${p.favoriteId}`);
    if (p.rating != null) f.rating = p.rating;
    if ("notes" in p) f.notes = cleanNotes(p.notes);
    return get(f.id);
  };

  return {
    save,
    reset: () => {
      state.items = [];
      state.nextId = 1;
      state.clock = 0;
    },
    call(method: string, params: unknown): unknown {
      switch (method) {
        case "favorites.list":
          return { items: list(params as FavoriteListParams | undefined) };
        case "favorites.save":
          return save(params as FavoriteSaveParams);
        case "favorites.update":
          return update(params as FavoriteUpdateParams);
        case "favorites.delete": {
          const id = (params as FavoriteIdParams).favoriteId;
          const before = state.items.length;
          state.items = state.items.filter((f) => f.id !== id);
          return { deleted: state.items.length < before };
        }
        default:
          throw { code: -32601, message: `method not found: ${method}` };
      }
    },
  };
}
