// The history methods (SPEC 13.4) for the browser preview and the tests, in memory, with
// answers shaped like engine/tonalia_engine/history.py. The plays are written onto the
// tracks themselves (timesPlayed / lastPlayed), as the engine's table rows carry them.
import type {
  HistoryImportParams,
  HistoryImportResult,
  HistoryList,
  HistoryMarkParams,
  HistorySources,
  PlaySession,
  TrackSummary,
} from "../lib/rpc.types";

type ImportSource = HistorySources["sources"][number]["source"];

interface Session extends PlaySession {
  trackIds: number[];
}

const DAY = 86_400_000;

/** Played in the last `days` days (0 = never true), like filters.recently_played. */
export function playedWithin(t: TrackSummary, days: number | undefined): boolean {
  if (!days || !t.lastPlayed) return false;
  return Date.parse(t.lastPlayed) >= Date.now() - days * DAY;
}
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

export function createFakeHistory(
  getTracks: () => TrackSummary[],
  playlistTracks: (playlistId: number) => { name: string; trackIds: number[] } | null = () => null,
) {
  let sessions: Session[] = [];
  let next = 1;

  /** Recount timesPlayed / lastPlayed on every track, like history.refresh_stats. */
  function refresh() {
    for (const t of getTracks()) {
      const mine = sessions.filter((s) => s.trackIds.includes(t.id));
      t.timesPlayed = mine.reduce((n, s) => n + s.trackIds.filter((id) => id === t.id).length, 0);
      t.lastPlayed = mine.reduce<string | null>(
        (best, s) => (best == null || s.startedAt > best ? s.startedAt : best),
        null,
      );
    }
  }

  function add(program: ImportSource | null, name: string | null, at: number, ids: number[]) {
    const session: Session = {
      id: next++,
      program,
      source: program ? "import" : "manual",
      name,
      startedAt: iso(at),
      endedAt: null,
      tracks: ids.length,
      trackIds: ids,
    };
    sessions.push(session);
    refresh();
    return session;
  }

  const list = (): HistoryList => {
    const ordered = [...sessions].sort((a, b) =>
      b.startedAt === a.startedAt ? b.id - a.id : b.startedAt < a.startedAt ? -1 : 1,
    );
    return {
      total: sessions.length,
      plays: sessions.reduce((n, s) => n + s.tracks, 0),
      playedTracks: getTracks().filter((t) => (t.timesPlayed ?? 0) > 0).length,
      sessions: ordered.map((s) => {
        const { trackIds, ...session } = s;
        void trackIds;
        return session;
      }),
    };
  };

  /** What importing a program's history brings (two sessions of the sample tracks). */
  function importHistory(p: HistoryImportParams): HistoryImportResult {
    const ids = getTracks().map((t) => t.id);
    const key = `${p.source}`;
    const before = sessions.length;
    if (!sessions.some((s) => s.program === p.source)) {
      add(p.source, key === "rekordbox" ? "HISTORY 2026-10-03" : null, Date.now() - 3 * DAY,
        ids.slice(0, 4)); // prettier-ignore
      add(p.source, null, Date.now() - 12 * DAY, ids.slice(2, 7));
    }
    return {
      source: p.source,
      path: p.path ?? `/Users/dj/Music/${p.source}/History`,
      sessions: 2,
      newSessions: sessions.length - before,
      plays: 9,
      tracks: Math.min(ids.length, 7),
      unmatched: 1,
      unmatchedPaths: ["/Volumes/USB/Música/Old Promo.mp3"],
      warnings: [],
    };
  }

  function mark(p: HistoryMarkParams) {
    const fromList = p.playlistId != null ? playlistTracks(p.playlistId) : null;
    const ids = [...new Set([...(p.trackIds ?? []), ...(fromList?.trackIds ?? [])])];
    if (ids.length === 0) throw { code: -32602, message: "nothing to mark", data: { reason: "invalid_params" } };
    const at = p.playedAt ? Date.parse(p.playedAt.length === 10 ? `${p.playedAt}T12:00:00` : p.playedAt) : Date.now();
    const session = add(null, p.name ?? fromList?.name ?? null, at, ids);
    return { sessionId: session.id, plays: ids.length };
  } // prettier-ignore

  function call(method: string, params: unknown): unknown {
    switch (method) {
      case "history.detect":
        return {
          sources: [
            { source: "rekordbox", path: null, running: false },
            { source: "traktor", path: "/Users/dj/Documents/Native Instruments/Traktor 3.11.1/History", running: false },
            { source: "serato", path: "/Users/dj/Music/_Serato_/History/Sessions", running: false },
            { source: "virtualdj", path: null, running: false },
            { source: "engine_dj", path: "/Users/dj/Music/Engine Library/Database2/hm.db", running: false },
          ],
        } satisfies HistorySources; // prettier-ignore
      case "history.list":
        return list();
      case "history.markPlayed":
        return mark(params as HistoryMarkParams);
      case "history.deleteSession": {
        const { sessionId } = params as { sessionId: number };
        const found = sessions.find((s) => s.id === sessionId);
        if (!found)
          throw { code: -32602, message: "no session", data: { reason: "session_not_found" } };
        sessions = sessions.filter((s) => s !== found);
        refresh();
        return { sessionId, plays: found.tracks };
      }
      default:
        throw { code: -32601, message: `method not found: ${method}` };
    }
  }

  /** The tracks of a session in play order (library.list with sessionId). */
  const sessionTracks = (sessionId: number): TrackSummary[] | null => {
    const found = sessions.find((s) => s.id === sessionId);
    if (!found) return null;
    const byId = new Map(getTracks().map((t) => [t.id, t]));
    return [...new Set(found.trackIds)].flatMap((id) => byId.get(id) ?? []);
  };

  return { call, importHistory, sessionTracks, add, list };
}
