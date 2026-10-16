// The import methods (SPEC 13.1) for the browser preview and the tests, in memory, with
// answers shaped like engine/tonalia_engine/import_/service.py.
import type {
  ConvertOptions,
  ConvertReport,
  ImportBatch,
  ImportChange,
  ImportOptions,
  ImportReport,
  ImportSources,
  ImportUndoResult,
  TrackSummary,
} from "../lib/rpc.types";

const PROGRAMS: Record<ImportOptions["source"], string> = {
  rekordbox: "Rekordbox",
  traktor: "Traktor",
  serato: "Serato",
  virtualdj: "VirtualDJ",
  engine_dj: "Engine DJ",
};

export const FAKE_MAP = { from: "D:\\Música", to: "/Users/dj/Music" };

export function createFakeDjImport(host: { tracks: () => TrackSummary[] }) {
  let batches: ImportBatch[] = [];
  let next = 1;
  let detected: ImportSources = {
    sources: [
      { source: "rekordbox", path: null, running: false },
      {
        source: "traktor",
        path: "/Users/dj/Documents/Native Instruments/Traktor 4.0.2/collection.nml",
        running: false,
      },
      { source: "serato", path: "/Users/dj/Music/_Serato_", running: false },
      {
        source: "virtualdj",
        path: "/Users/dj/Library/Application Support/VirtualDJ/database.xml",
        running: true,
      },
      { source: "engine_dj", path: null, running: false },
    ],
  };

  const report = (o: ImportOptions, simulate: boolean): ImportReport => {
    const tracks = host.tracks().filter((t) => t.status === "ready");
    const policy = o.policy ?? {};
    const mapped = o.pathMaps == null || o.pathMaps.some((m) => m.from === FAKE_MAP.from);
    const byMap = mapped ? Math.min(2, tracks.length) : 0;
    const byPath = Math.max(0, tracks.length - 2);
    const changes: ImportChange[] = tracks.slice(0, 4).flatMap((t, i): ImportChange[] => [
      {
        trackId: t.id,
        title: t.title ?? "",
        field: "cues",
        before: i === 0 ? "#2 · 0:31.05 · drop" : null,
        after: `#${i + 2} · 0:${30 + i}.00 · ${i === 0 ? "Drop!" : "Vocal"}`,
        conflict: false,
        user: false,
      },
      ...(policy.key === "take" && t.keyRoot != null
        ? [
            {
              trackId: t.id,
              title: t.title ?? "",
              field: "key" as const,
              before: "8A",
              after: "9A",
              conflict: true,
              user: i === 1,
            },
          ]
        : []),
      {
        trackId: t.id,
        title: t.title ?? "",
        field: "rating",
        before: null,
        after: String(3 + (i % 3)),
        conflict: false,
        user: false,
      },
    ]);
    const count = (field: ImportChange["field"]) => changes.filter((c) => c.field === field).length;
    const program = PROGRAMS[o.source];
    return {
      source: o.source,
      simulated: simulate,
      path: o.path ?? detected.sources.find((s) => s.source === o.source)?.path ?? "",
      batchId: simulate ? null : `fake-import-${next}`,
      tracks: tracks.length + 3,
      matched: { path: byPath, map: byMap, hash: 0 },
      new: 1,
      missing: mapped ? 2 : 2 + byMap,
      added: !simulate && o.addMissing ? 1 : 0,
      pathMaps: mapped ? [{ ...FAKE_MAP, tracks: byMap }] : [],
      fields: (["cues", "grid", "key", "bpm", "rating", "play_count", "comment"] as const).map(
        (field) => ({
          field,
          changes: count(field),
          conflicts: changes.filter((c) => c.field === field && c.conflict).length,
          kept: field === "key" && policy.key !== "take" ? tracks.length : field === "grid" ? 2 : 0,
        }),
      ),
      cues: count("cues") * 2,
      markers: 3,
      playlists: o.playlists === false ? 0 : 6,
      folder:
        o.playlists === false
          ? null
          : `${o.language === "es" ? "Importado de" : "Imported from"} ${program}`,
      warnings: [{ code: "own_folder_skipped" }],
      changes,
      unmatched: [
        {
          path: "/Users/dj/Music/Nuevos/Sunset Engine (Extended).mp3",
          title: "Sunset Engine",
          artist: "The Quiet Orbit",
          onDisk: true,
        },
        {
          path: "D:\\Música\\Viejos\\Cobalt Rain.mp3",
          title: "Cobalt Rain",
          artist: "Eli Marsh",
          onDisk: false,
        },
      ],
    };
  };

  function apply(o: ImportOptions): ImportReport {
    const out = report(o, false);
    batches = [
      {
        batchId: out.batchId ?? "",
        source: o.source,
        createdAt: new Date().toISOString(),
        undoneAt: null,
        path: out.path,
        tracks: Object.values(out.matched).reduce((a, b) => a + b, 0) + (out.added ?? 0),
        cues: out.cues,
        playlists: out.playlists,
        added: out.added ?? 0,
      },
      ...batches,
    ];
    next++;
    return out;
  }

  /** A trip from one program to another (13.2): the import, then the export. */
  function convert(o: ConvertOptions, simulate: boolean): ConvertReport {
    const imported = (simulate ? (x: ImportOptions) => report(x, true) : apply)({
      source: o.source,
      path: o.sourcePath ?? null,
      policy: o.policy ?? null,
      pathMaps: o.pathMaps ?? null,
      playlists: o.playlists ?? true,
      addMissing: o.addMissing ?? false,
      language: o.language ?? "en",
    });
    const batchId = simulate ? null : (imported.batchId ?? null);
    const tracks = Object.values(imported.matched).reduce((a, b) => a + b, 0);
    const losses: ConvertReport["losses"] = [
      ...(o.target === "traktor" || o.target === "virtualdj"
        ? [{ code: "cue_colors" as const, tracks: 2, items: 5 }]
        : []),
      ...(o.target === "serato" ? [{ code: "beatgrid" as const, tracks, items: 0 }] : []),
      { code: "markers", tracks: 1, items: 3 },
      { code: "not_in_tonalia", tracks: imported.missing, items: 0 },
    ];
    return {
      source: o.source,
      target: o.target,
      simulated: simulate,
      importReport: { ...imported, simulated: simulate, batchId },
      exportResult: {
        target: o.target,
        simulated: simulate,
        path: o.target === "serato" ? "" : (o.targetPath ?? "/Users/dj/rekordbox.xml"),
        tracks,
        cues: imported.cues + 4,
        playlists: o.playlists === false ? 0 : 6,
        skipped: 0,
        warnings: [],
        backupPath: simulate || o.target === "serato" ? null : "/Users/dj/Backups/collection.nml",
        items: [],
      },
      losses,
    };
  }

  function call(method: string, params: unknown): unknown {
    switch (method) {
      case "import.detect":
        return detected;
      case "import.history":
        return { batches: batches.map((b) => ({ ...b })) };
      case "import.undo": {
        const { batchId } = params as { batchId: string };
        const batch = batches.find((b) => b.batchId === batchId);
        if (!batch)
          throw { code: -32602, message: "batch not found", data: { reason: "batch_not_found" } };
        if (batch.undoneAt)
          throw { code: -32602, message: "already undone", data: { reason: "undo_changed" } };
        const undoneAt = new Date().toISOString();
        batches = batches.map((b) => (b.batchId === batchId ? { ...b, undoneAt } : b));
        return {
          batchId,
          tracks: batch.tracks,
          removed: batch.added,
          skipped: 0,
        } satisfies ImportUndoResult;
      }
      default:
        throw { code: -32601, message: `method not found: ${method}` };
    }
  }

  return {
    call,
    report,
    apply,
    convert,
    setDetected: (value: ImportSources) => {
      detected = value;
    },
  };
}
