// The duplicates methods (SPEC 13.3) for the browser preview and the tests, in memory,
// with answers shaped like engine/tonalia_engine/duplicates.py.
import type {
  DuplicateGroup,
  DuplicateList,
  DuplicateMember,
  DuplicateResolveParams,
  DuplicateResolveResult,
  DuplicateScanResult,
} from "../lib/rpc.types";

const member = (
  trackId: number,
  title: string,
  artist: string,
  path: string,
  format: string,
  bitrate: number | null,
  extra: Partial<DuplicateMember> = {},
): DuplicateMember => ({
  trackId, title, artist, path, format, bitrate, duration: 372.4, size: 9_000_000,
  qualityIssues: 0, cues: 5, ownCues: 0, playlists: 1, ...extra,
}); // prettier-ignore

function sample(): DuplicateGroup[] {
  return [
    {
      groupId: "audio:bloom",
      kind: "audio",
      members: [
        member(1, "Midnight Bloom", "Lumen Drift", "/Users/dj/Música/House/Midnight Bloom.mp3",
          "mp3", 128, { qualityIssues: 1, ownCues: 2, playlists: 2 }),
        member(11, "Midnight Bloom (Original Mix)", "Lumen Drift",
          "/Users/dj/Música/Lossless/Lumen Drift - Midnight Bloom.flac", "flac", 980),
      ], // prettier-ignore
      proposed: 11,
      reason: "lossless",
      reasonBest: "FLAC",
      reasonOther: "MP3",
      resolution: null,
    },
    {
      groupId: "identical:golden",
      kind: "identical",
      members: [
        member(2, "Golden Hour Tide", "Sora Vela", "/Users/dj/Música/Deep/Golden Hour Tide.mp3",
          "mp3", 320, { cues: 6 }),
        member(12, "Golden Hour Tide", "Sora Vela",
          "/Volumes/USB/Música/Deep/Golden Hour Tide.mp3", "mp3", 320),
      ], // prettier-ignore
      proposed: 2,
      reason: "cues",
      reasonBest: "6",
      reasonOther: "5",
      resolution: null,
    },
    {
      groupId: "version:neon",
      kind: "version",
      members: [
        member(3, "Neon Cathedral (Original Mix)", "Kairo",
          "/Users/dj/Música/Techno/Neon Cathedral.mp3", "mp3", 320),
        member(13, "Neon Cathedral (Extended Mix)", "Kairo",
          "/Users/dj/Música/Techno/Neon Cathedral (Extended).aiff", "aiff", null,
          { duration: 431.2 }),
      ], // prettier-ignore
      proposed: 13,
      reason: "lossless",
      reasonBest: "AIFF",
      reasonOther: "MP3",
      resolution: null,
    },
  ];
}

export function createFakeDuplicates() {
  let groups: DuplicateGroup[] = [];
  let lastScan: string | null = null;
  let resolved = 0;
  let next = 1;
  const merges = new Map<string, DuplicateGroup>();

  const list = (): DuplicateList => ({
    groups: groups.map((g) => ({ ...g })),
    resolved,
    lastScan,
    fingerprinted: 10,
    tracks: 10,
  });

  /** What a finished scan returns (and the groups it leaves). */
  function scan(): DuplicateScanResult {
    if (lastScan == null) groups = sample();
    lastScan = new Date().toISOString();
    return { tracks: 10, fingerprinted: 4, unreadable: 0, groups: groups.length, seconds: 1.2 };
  }

  function resolve(p: DuplicateResolveParams): DuplicateResolveResult {
    const group = groups.find((g) => g.groupId === p.groupId);
    if (!group)
      throw { code: -32602, message: "group not found", data: { reason: "group_not_found" } };
    groups = groups.filter((g) => g.groupId !== p.groupId);
    if (p.action !== "merge") {
      resolved++;
      return { action: p.action, kept: null, removed: 0, trashed: 0, trashFailed: [] };
    }
    const mergeId = `fake-merge-${next++}`;
    merges.set(mergeId, group);
    const removed = group.members.length - 1;
    return {
      action: "merge",
      mergeId,
      kept: p.keepTrackId ?? group.proposed,
      removed,
      trashed: p.trash ? removed : 0,
      trashFailed: [],
    };
  }

  function call(method: string, params: unknown): unknown {
    switch (method) {
      case "duplicates.list":
        return list();
      case "duplicates.resolve":
        return resolve(params as DuplicateResolveParams);
      case "duplicates.undo": {
        const { mergeId } = params as { mergeId: string };
        const group = merges.get(mergeId);
        if (!group)
          throw { code: -32602, message: "merge not found", data: { reason: "group_not_found" } };
        merges.delete(mergeId);
        groups = [group, ...groups];
        return { mergeId, restored: group.members.length - 1 };
      }
      default:
        throw { code: -32601, message: `method not found: ${method}` };
    }
  }

  return { call, scan };
}
