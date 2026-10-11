// In-memory `playlists.*` for the component tests and the browser preview. Mirrors the
// engine's behaviour closely enough for the UI: nested tree order, sibling renumbering,
// tracks without repeats and a subset of smart-playlist conditions.
import type {
  LibraryQuery,
  PlaylistCreateParams,
  PlaylistMoveParams,
  PlaylistNode,
  PlaylistTracksParams,
  PlaylistUpdateParams,
  TrackFilter,
  TrackSummary,
} from "../lib/rpc.types";
import { compatibility, makeKey } from "../lib/keys";

export function matchesFilter(
  t: TrackSummary,
  f: TrackFilter,
  members: (playlistId: number) => number[] = () => [],
): boolean {
  if (f.keys?.length) {
    if (t.keyRoot == null || t.keyMode == null) return false;
    const key = makeKey(t.keyRoot, t.keyMode);
    const ok = f.keys.some((k) =>
      f.compatible
        ? compatibility(makeKey(k.root, k.mode), key).score > 0
        : k.root === key.root && k.mode === key.mode,
    );
    if (!ok) return false;
  }
  if (f.bpmMin != null || f.bpmMax != null) {
    const factors = f.bpmHalfDouble ? [1, 2, 0.5] : [1];
    const low = f.bpmMin ?? 0;
    const high = f.bpmMax ?? Infinity;
    const bpm = t.bpm;
    if (bpm == null || !factors.some((x) => bpm * x >= low && bpm * x <= high)) return false;
  }
  if (f.energyMin != null && (t.energy ?? 0) < f.energyMin) return false;
  if (f.energyMax != null && (t.energy ?? Infinity) > f.energyMax) return false;
  if (f.genres?.length && !f.genres.some((g) => g.toLowerCase() === t.genre?.toLowerCase()))
    return false;
  if (f.statuses?.length && !f.statuses.includes(t.status)) return false;
  if (f.qualityIssues != null && (t.qualityFlags?.length ?? 0) > 0 !== f.qualityIssues)
    return false;
  if (f.playlistId != null && !members(f.playlistId).includes(t.id)) return false;
  return true;
}

const fail = (message: string) => ({ code: -32602, message });

export function createFakePlaylists(getTracks: () => TrackSummary[]) {
  const state = {
    nodes: [] as PlaylistNode[],
    entries: new Map<number, number[]>(),
    nextId: 1,
  };

  const matches = (t: TrackSummary, f: TrackFilter) =>
    matchesFilter(t, f, (id) => state.entries.get(id) ?? []);

  const find = (id: number) => {
    const node = state.nodes.find((p) => p.id === id);
    if (!node) throw fail(`unknown playlist ${id}`);
    return node;
  };

  const view = (id: number): PlaylistNode => {
    const node = find(id);
    const smart = node.smart;
    const trackCount = node.isFolder
      ? 0
      : smart
        ? getTracks().filter((t) => matches(t, smart)).length
        : (state.entries.get(id) ?? []).length;
    return { ...node, trackCount };
  };

  const tree = (): PlaylistNode[] => {
    const out: PlaylistNode[] = [];
    const walk = (parent: number | null) =>
      state.nodes
        .filter((p) => p.parentId === parent)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .forEach((p) => {
          out.push(view(p.id));
          walk(p.id);
        });
    walk(null);
    return out;
  };

  const add = (
    name: string,
    extra: Partial<PlaylistNode> = {},
    trackIds: number[] = [],
  ): PlaylistNode => {
    const id = state.nextId++;
    const parentId = extra.parentId ?? null;
    state.nodes.push({
      id,
      parentId,
      name,
      emoji: null,
      isFolder: false,
      smart: null,
      trackCount: 0,
      sortOrder: state.nodes.filter((p) => p.parentId === parentId).length,
      ...extra,
    });
    if (!extra.isFolder && !extra.smart) state.entries.set(id, [...trackIds]);
    return view(id);
  };

  const call = (method: string, params: unknown): unknown => {
    switch (method) {
      case "playlists.tree":
        return { playlists: tree() };
      case "playlists.create": {
        const p = params as PlaylistCreateParams;
        return add(p.name, {
          parentId: p.parentId ?? null,
          emoji: p.emoji ?? null,
          isFolder: p.isFolder ?? false,
          smart: p.smart ?? null,
        });
      }
      case "playlists.update": {
        const p = params as PlaylistUpdateParams;
        const node = find(p.playlistId);
        if (p.name != null) node.name = p.name;
        if (p.emoji != null) node.emoji = p.emoji || null;
        if (p.smart != null) node.smart = p.smart;
        return view(node.id);
      }
      case "playlists.move": {
        const p = params as PlaylistMoveParams;
        const node = find(p.playlistId);
        const parentId = p.parentId ?? null;
        node.parentId = parentId;
        const siblings = tree()
          .filter((x) => x.parentId === parentId && x.id !== node.id)
          .map((x) => x.id);
        siblings.splice(Math.min(p.index, siblings.length), 0, node.id);
        siblings.forEach((id, i) => (find(id).sortOrder = i));
        return { playlists: tree() };
      }
      case "playlists.delete": {
        const doomed = new Set([(params as { playlistId: number }).playlistId]);
        for (let grew = true; grew;) {
          grew = false;
          for (const p of state.nodes) {
            if (p.parentId != null && doomed.has(p.parentId) && !doomed.has(p.id)) {
              doomed.add(p.id);
              grew = true;
            }
          }
        }
        state.nodes = state.nodes.filter((p) => !doomed.has(p.id));
        return { deleted: doomed.size };
      }
      case "playlists.addTracks":
      case "playlists.removeTracks":
      case "playlists.reorderTracks": {
        const p = params as PlaylistTracksParams;
        const current = state.entries.get(p.playlistId);
        if (!current) throw fail("not a regular playlist");
        const given = new Set(p.trackIds);
        let next: number[];
        let changed: number;
        if (method === "playlists.addTracks") {
          const added = p.trackIds.filter((id) => !current.includes(id));
          const at = p.index ?? current.length;
          next = [...current.slice(0, at), ...added, ...current.slice(at)];
          changed = added.length;
        } else if (method === "playlists.removeTracks") {
          next = current.filter((id) => !given.has(id));
          changed = current.length - next.length;
        } else {
          const moving = current.filter((id) => given.has(id));
          const rest = current.filter((id) => !given.has(id));
          const at = p.index ?? rest.length;
          next = [...rest.slice(0, at), ...moving, ...rest.slice(at)];
          changed = moving.length;
        }
        state.entries.set(p.playlistId, next);
        return { changed, trackCount: next.length };
      }
      case "playlists.importM3u": {
        const p = params as { path: string; parentId?: number | null };
        const name =
          p.path
            .split(/[\\/]/)
            .pop()
            ?.replace(/\.m3u8?$/i, "") ?? "M3U";
        const first = getTracks()[0];
        const node = add(name, { parentId: p.parentId ?? null }, first ? [first.id] : []);
        return { playlist: node, matched: node.trackCount, imported: 0, missing: ["/gone.mp3"] };
      }
      case "playlists.exportM3u": {
        const p = params as { playlistId: number; path: string };
        return { path: p.path, written: view(p.playlistId).trackCount, backupPath: null };
      }
      default:
        throw { code: -32601, message: `method not found: ${method}` };
    }
  };

  /**
   * Rows of `library.list` restricted to the query's playlist (null = no playlist).
   * `ordered` is true when the rows are already in playlist order.
   */
  const select = (q: LibraryQuery, rows: TrackSummary[]) => {
    if (q.playlistId == null) return null;
    const node = find(q.playlistId);
    if (node.isFolder) throw fail("folders have no tracks of their own");
    const smart = node.smart;
    if (smart) return { rows: rows.filter((t) => matches(t, smart)), ordered: false };
    const byId = new Map(rows.map((t) => [t.id, t]));
    const ordered = (state.entries.get(node.id) ?? [])
      .map((id) => byId.get(id))
      .filter((t): t is TrackSummary => t != null);
    return { rows: ordered, ordered: true };
  };

  const reset = () => {
    state.nodes = [];
    state.entries.clear();
    state.nextId = 1;
  };

  return { add, call, select, reset, matches };
}
