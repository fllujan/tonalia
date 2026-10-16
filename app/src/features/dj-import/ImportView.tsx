// DESIGN 6.19 — import from DJ software (SPEC 13.1). Same pattern as Export: the programs
// in a list on the left, one panel on the right with where the collection is, what to do
// when a track is already in Tonalia (per field), the preview (required before importing)
// and the result with Undo. Reading never writes to the other program's files.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { open } from "@tauri-apps/plugin-dialog";
import { CircleCheck, Disc3, FileInput, LoaderCircle, TriangleAlert, Undo2 } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Segmented } from "../../components/Segmented";
import { describeFailure, errorMessage } from "../../lib/errors";
import { formatCount } from "../../lib/format";
import { request } from "../../lib/rpc";
import type {
  ImportChange,
  ImportOptions,
  ImportPolicy,
  ImportReport,
  PathMap,
} from "../../lib/rpc.types";
import { DEFAULT_SETTINGS, useSettings, useUpdateSettings } from "../settings/api";
import { useToastStore } from "../toast/toastStore";
import {
  IMPORT_SOURCES,
  type ImportOutcome,
  type ImportSource,
  sameImport,
  startImport,
  undoImport,
  useImportHistory,
  useImportJobs,
} from "./importJobs";

type Field = keyof ImportPolicy;
type Policy = NonNullable<ImportPolicy[Field]>;
const FIELDS: Field[] = ["cues", "grid", "key", "bpm", "rating", "playCount", "comment"];
/** The report names fields as the engine does (snake_case). */
const REPORT_FIELD: Record<string, Field> = { play_count: "playCount" };
const fieldOf = (name: string): Field => REPORT_FIELD[name] ?? (name as Field);

const SOURCE_KEY = "tonalia.import.source";
const PATH_KEY = (source: ImportSource) => `tonalia.import.${source}.path`;

function load(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not remembered; it is still used now.
  }
}

/** Where each program keeps its collection, and whether it is open (polled). */
function useSources() {
  return useQuery({
    queryKey: ["import", "detect"],
    queryFn: () => request("import.detect"),
    refetchInterval: 5000,
  });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => {
    for (const key of [["library"], ["track"], ["playlists"], ["import"]])
      void qc.invalidateQueries({ queryKey: key });
  };
}

function StatusLine({ tone, children }: { tone: "ok" | "warning"; children: ReactNode }) {
  const Icon = tone === "ok" ? CircleCheck : TriangleAlert;
  return (
    <div
      role="status"
      className={`flex items-start gap-2 text-[12px] ${tone === "ok" ? "text-text-2" : "text-warning"}`}
    >
      <Icon
        size={14}
        strokeWidth={1.5}
        className={`mt-0.5 shrink-0 ${tone === "ok" ? "text-success" : ""}`}
      />
      <span className="min-w-0 break-words">{children}</span>
    </div>
  );
}

function Check({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="flex items-start gap-2 text-body">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 size-4 accent-[var(--color-primary)]"
      />
      <span className="flex flex-col">
        {label}
        {hint && <span className="text-[12px] text-text-3">{hint}</span>}
      </span>
    </label>
  );
}

/** "before → after": the old value struck through in text-3, the new one in text. */
function Change({ change }: { change: ImportChange }) {
  const { t } = useTranslation();
  const value = (v: string | null | undefined) =>
    change.field === "key" && v ? v.replace(/#/g, "♯").replace(/b(?=m?$)/, "♭") : v;
  return (
    <li className="grid grid-cols-[minmax(0,1.2fr)_96px_minmax(0,2fr)] items-center gap-2 border-b border-border px-2 py-1 last:border-b-0">
      <span className="truncate" title={change.title}>
        {change.title}
      </span>
      <span className="text-text-3">{t(`djImport.fields.${fieldOf(change.field)}`)}</span>
      <span className="flex min-w-0 items-center gap-1.5">
        {change.before != null && (
          <span className="truncate text-text-3 line-through" title={change.before}>
            {value(change.before)}
          </span>
        )}
        {change.before != null && <span className="text-text-3">→</span>}
        <span className="truncate text-text" title={change.after ?? undefined}>
          {value(change.after) ?? "—"}
        </span>
        {change.conflict && (
          <span
            className="shrink-0 rounded-pill bg-surface-3 px-1.5 text-[11px] text-warning"
            title={t(change.user ? "djImport.conflictUser" : "djImport.conflict")}
          >
            {t(change.user ? "djImport.byHand" : "djImport.replaces")}
          </span>
        )}
      </span>
    </li>
  );
}

const sameMap = (a: PathMap, b: PathMap) => a.from === b.from && a.to === b.to;

function Report({
  outcome,
  maps,
  offered,
  onMaps,
}: {
  outcome: ImportOutcome;
  /** The mappings chosen (null: the ones the preview detects). */
  maps: PathMap[] | null;
  /** Every mapping a preview proposed, so one switched off can be switched on again. */
  offered: PathMap[];
  onMaps: (maps: PathMap[]) => void;
}) {
  const { t, i18n } = useTranslation();
  const invalidate = useInvalidate();
  const history = useImportHistory().data?.batches ?? [];
  const n = (value: number) => formatCount(value, i18n.language);
  const batchId = outcome.status === "done" ? outcome.result.batchId : null;
  const undone = batchId != null && history.some((b) => b.batchId === batchId && b.undoneAt);
  if (outcome.status === "failed")
    return (
      <div role="status" className="rounded-md border border-danger bg-surface-1 p-3 text-danger">
        {t("djImport.failed", { error: describeFailure(outcome) })}
      </div>
    );
  if (outcome.status === "cancelled")
    return (
      <div role="status" className="text-text-2">
        {t("djImport.cancelled")}
      </div>
    );
  const r: ImportReport = outcome.result;
  const matched = Object.values(r.matched).reduce((a, b) => a + b, 0);
  const changes = r.changes ?? [];
  const fields = (r.fields ?? []).filter((f) => f.changes > 0 || f.kept > 0);
  const used = r.pathMaps ?? [];
  return (
    <div
      role="status"
      className="flex flex-col gap-3 rounded-md border border-border bg-surface-1 p-4"
    >
      <div className="font-medium">
        {r.simulated ? t("djImport.previewTitle") : t("djImport.doneTitle")}
      </div>
      <div className="text-control text-text-2">
        {t("djImport.summary", { tracks: n(r.tracks), matched: n(matched) })}
        {" · "}
        {t("djImport.matchedBy", {
          path: n(r.matched.path ?? 0),
          map: n(r.matched.map ?? 0),
          hash: n(r.matched.hash ?? 0),
        })}
      </div>
      {(r.added ?? 0) > 0 && (
        <div className="text-control text-text-2">
          {t("djImport.addedCount", { count: r.added ?? 0 })}
        </div>
      )}
      {(r.new > 0 || r.missing > 0) && (
        <div className="text-control text-text-2">
          {t("djImport.unmatchedSummary", { onDisk: n(r.new), missing: n(r.missing) })}
        </div>
      )}
      {offered.length > 0 && (
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1 text-label uppercase text-text-3">{t("djImport.maps")}</legend>
          {offered.map((m) => {
            const on = maps === null || maps.some((x) => sameMap(x, m));
            const tracks = used.find((x) => sameMap(x, m))?.tracks ?? 0;
            return (
              <label key={`${m.from}→${m.to}`} className="flex items-center gap-2 text-[12px]">
                <input
                  type="checkbox"
                  checked={on}
                  className="size-4 accent-[var(--color-primary)]"
                  onChange={(e) => {
                    const current = maps ?? offered;
                    onMaps(
                      e.target.checked ? [...current, m] : current.filter((x) => !sameMap(x, m)),
                    );
                  }}
                />
                <span className="truncate font-mono text-text-2" title={`${m.from} → ${m.to}`}>
                  {m.from} → {m.to}
                </span>
                {on && tracks > 0 && (
                  <span className="shrink-0 text-text-3">
                    {t("djImport.mapTracks", { count: tracks })}
                  </span>
                )}
              </label>
            );
          })}
        </fieldset>
      )}
      {fields.length > 0 && (
        <table className="w-full max-w-[560px] text-[12px]">
          <thead className="text-left text-text-3">
            <tr>
              <th className="py-1 font-normal">{t("djImport.field")}</th>
              <th className="py-1 text-right font-normal">{t("djImport.changes")}</th>
              <th className="py-1 text-right font-normal">{t("djImport.conflicts")}</th>
              <th className="py-1 text-right font-normal">{t("djImport.kept")}</th>
            </tr>
          </thead>
          <tbody className="font-mono tabular-nums">
            {fields.map((f) => (
              <tr key={f.field} className="border-t border-border">
                <td className="py-1 font-sans">{t(`djImport.fields.${fieldOf(f.field)}`)}</td>
                <td className="py-1 text-right">{n(f.changes)}</td>
                <td className={`py-1 text-right ${f.conflicts > 0 ? "text-warning" : ""}`}>
                  {n(f.conflicts)}
                </td>
                <td className="py-1 text-right text-text-3">{n(f.kept)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="text-control text-text-2">
        {t("djImport.extras", {
          cues: n(r.cues),
          markers: n(r.markers),
          playlists: n(r.playlists),
        })}
        {r.folder && ` · ${t("djImport.inFolder", { folder: r.folder })}`}
      </div>
      {changes.length > 0 && (
        <details className="text-[12px]" open={r.simulated}>
          <summary className="cursor-pointer text-text-2">
            {t("djImport.changesTitle", { count: changes.length })}
          </summary>
          <ul className="mt-2 flex max-h-[280px] flex-col overflow-auto rounded-sm border border-border">
            {changes.map((c, i) => (
              <Change key={i} change={c} />
            ))}
          </ul>
        </details>
      )}
      {(r.unmatched ?? []).length > 0 && (
        <details className="text-[12px]">
          <summary className="cursor-pointer text-text-2">
            {t("djImport.unmatchedTitle", { count: r.new + r.missing })}
          </summary>
          <ul className="mt-2 flex max-h-[200px] flex-col overflow-auto rounded-sm border border-border">
            {(r.unmatched ?? []).map((u) => (
              <li
                key={u.path}
                className="flex items-center gap-2 border-b border-border px-2 py-1 last:border-b-0"
              >
                <span className="min-w-0 flex-1 truncate font-mono text-text-2" title={u.path}>
                  {u.path}
                </span>
                <span className={u.onDisk ? "text-text-3" : "text-warning"}>
                  {t(u.onDisk ? "djImport.onDisk" : "djImport.notFound")}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {(r.warnings ?? []).length > 0 && (
        <ul className="flex flex-col gap-1 text-[12px]">
          {[...new Set((r.warnings ?? []).map((w) => w.code))].map((code) => (
            <li key={code} className="flex items-center gap-1.5 text-text-2">
              <TriangleAlert size={12} strokeWidth={1.5} className="text-warning" />
              {t(`djImport.warnings.${code}`, {
                count: (r.warnings ?? []).filter((w) => w.code === code).length,
              })}
            </li>
          ))}
        </ul>
      )}
      {!r.simulated && r.batchId && undone && (
        <div className="text-[12px] text-text-3">{t("djImport.undoneBatch")}</div>
      )}
      {!r.simulated && r.batchId && !undone && (
        <div className="flex items-center gap-2 text-[12px] text-text-2">
          <span>🛟 {t("djImport.canUndo")}</span>
          <button
            type="button"
            onClick={() => {
              const batchId = r.batchId;
              if (batchId) void undoImport(batchId, t, invalidate);
            }}
            className="flex h-7 items-center gap-1.5 rounded-sm border border-border bg-surface-3 px-2 text-text hover:border-border-strong"
          >
            <Undo2 size={14} strokeWidth={1.5} />
            {t("djImport.undo")}
          </button>
        </div>
      )}
    </div>
  );
}

function Panel({ source, title }: { source: ImportSource; title: string }) {
  const { t, i18n } = useTranslation();
  const settings = useSettings();
  const update = useUpdateSettings((error) => t("settings.saveFailed", { error }));
  const status = useSources().data?.sources.find((s) => s.source === source);
  const running = useImportJobs((s) => s.running);
  const outcome = useImportJobs((s) => s.outcomes[source]);
  const [chosen, setChosen] = useState<string | null>(() => load(PATH_KEY(source)));
  const [playlists, setPlaylists] = useState(true);
  const [addMissing, setAddMissing] = useState(false);
  const [maps, setMaps] = useState<PathMap[] | null>(null);
  const path = chosen ?? status?.path ?? null;
  // Every mapping a preview has proposed for this collection.
  const proposed =
    outcome?.status === "done" && outcome.options.pathMaps == null
      ? (outcome.result.pathMaps ?? [])
      : [];
  const [known, setKnown] = useState<PathMap[]>([]);
  const offered = [...known, ...proposed.filter((m) => !known.some((k) => sameMap(k, m)))];
  const policy: Required<ImportPolicy> = {
    ...(DEFAULT_SETTINGS.importPolicy as Required<ImportPolicy>),
    ...settings.importPolicy,
  };
  const options: ImportOptions = {
    source,
    path,
    policy,
    pathMaps: maps,
    playlists,
    addMissing,
    language: i18n.language.startsWith("es") ? "es" : "en",
  };
  const busy = running != null;
  // The import is what the preview showed: Import waits for a preview of these options.
  const previewed =
    outcome?.status === "done" && outcome.result.simulated && sameImport(outcome.options, options);
  const imported = outcome?.status === "done" && !outcome.result.simulated;
  const isFolder = source === "serato";

  const choosePath = async () => {
    const picked = await open(
      isFolder
        ? { directory: true, title: t("djImport.chooseFolder") }
        : {
            multiple: false,
            title: t("djImport.chooseFile", { file: t(`djImport.${source}.file`) }),
            filters: [
              {
                name: t(`djImport.${source}.file`),
                extensions: [source === "traktor" ? "nml" : source === "engine_dj" ? "db" : "xml"],
              },
            ],
          },
    );
    if (typeof picked !== "string") return;
    setChosen(picked);
    setMaps(null);
    setKnown([]);
    store(PATH_KEY(source), picked);
  };

  const run = async (simulate: boolean, withMaps: PathMap[] | null = maps) => {
    try {
      await startImport({ ...options, pathMaps: withMaps }, simulate);
    } catch (err) {
      useToastStore.getState().push({
        title: t("djImport.failed", { error: errorMessage(err) }),
        tone: "danger",
      });
    }
  };

  const setPolicy = (field: Field, value: Policy) =>
    update.mutate({ importPolicy: { ...policy, [field]: value } });

  const blockedId = `import-${source}-why`;
  const reason = !path
    ? t("djImport.needPath")
    : previewed
      ? null
      : t(imported ? "djImport.needPreviewAgain" : "djImport.needPreview");

  return (
    <section
      id={`import-panel-${source}`}
      aria-label={title}
      className="flex max-w-[880px] flex-col gap-5 rounded-md border border-border bg-surface-2 p-5"
    >
      <header className="flex flex-col gap-1">
        <h2 className="font-display text-title">{title}</h2>
        <p className="text-body text-text-2">{t(`djImport.${source}.description`)}</p>
      </header>
      {status?.running ? (
        <StatusLine tone="warning">{t("djImport.running", { name: title })}</StatusLine>
      ) : status?.path ? (
        <StatusLine tone="ok">{t("djImport.found", { path: status.path })}</StatusLine>
      ) : status ? (
        <StatusLine tone="warning">{t(`djImport.${source}.notFound`)}</StatusLine>
      ) : null}
      <div className="flex items-center gap-2 text-[12px]">
        <span className="text-text-3">{t("djImport.collection")}</span>
        <span
          className={`min-w-0 flex-1 truncate ${path ? "font-mono text-text-2" : "text-text-3"}`}
          title={path ?? undefined}
        >
          {path ?? t("djImport.noPath")}
        </span>
        <button
          type="button"
          onClick={() => void choosePath()}
          className="h-7 rounded-sm px-2 text-primary-ink hover:bg-surface-3"
        >
          {t(path ? "djImport.change" : "djImport.choose")}
        </button>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-label uppercase text-text-3">{t("djImport.policy")}</legend>
        <p className="text-[12px] text-text-3">{t("djImport.policyHint")}</p>
        <div className="grid grid-cols-[140px_1fr] items-center gap-x-4 gap-y-2">
          {FIELDS.map((field) => (
            <div key={field} className="contents">
              <span className="text-body">{t(`djImport.fields.${field}`)}</span>
              <Segmented<Policy>
                size="sm"
                label={t(`djImport.fields.${field}`)}
                value={policy[field]}
                onChange={(value) => setPolicy(field, value)}
                options={[
                  { value: "fill", label: t("djImport.policies.fill") },
                  { value: "take", label: t("djImport.policies.take") },
                  { value: "keep", label: t("djImport.policies.keep") },
                ]}
              />
            </div>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-col gap-2">
        <Check
          checked={playlists}
          onChange={setPlaylists}
          label={t("djImport.playlists")}
          hint={t("djImport.playlistsHint", { folder: t("djImport.folder", { program: title }) })}
        />
        <Check
          checked={addMissing}
          onChange={setAddMissing}
          label={t("djImport.addMissing")}
          hint={t("djImport.addMissingHint")}
        />
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
        {reason && (
          <span id={blockedId} className="mr-auto text-[12px] text-text-3">
            {reason}
          </span>
        )}
        <button
          type="button"
          disabled={busy}
          aria-disabled={!path || undefined}
          aria-describedby={!path ? blockedId : undefined}
          onClick={() => {
            if (path) void run(true);
          }}
          className="flex h-8 items-center gap-1.5 rounded-sm border border-border bg-surface-3 px-3 text-text hover:border-border-strong disabled:opacity-40 aria-disabled:cursor-default aria-disabled:opacity-40 aria-disabled:hover:border-border"
        >
          {running?.source === source && running.simulate && (
            <LoaderCircle size={14} strokeWidth={1.5} className="motion-safe:animate-spin" />
          )}
          {t("djImport.preview")}
        </button>
        <button
          type="button"
          disabled={busy}
          aria-disabled={reason != null || undefined}
          aria-describedby={reason ? blockedId : undefined}
          onClick={() => {
            if (!reason) void run(false);
          }}
          className="flex h-8 items-center gap-1.5 rounded-sm bg-primary px-3 font-semibold text-white hover:bg-primary-hover disabled:opacity-40 aria-disabled:cursor-default aria-disabled:opacity-40 aria-disabled:hover:bg-primary"
        >
          {running?.source === source && !running.simulate ? (
            <LoaderCircle size={14} strokeWidth={1.5} className="motion-safe:animate-spin" />
          ) : (
            <FileInput size={14} strokeWidth={1.5} />
          )}
          {t("djImport.import")}
        </button>
      </div>
      {outcome && (previewed || imported || outcome.status !== "done") && (
        <Report
          outcome={outcome}
          maps={maps}
          offered={offered}
          onMaps={(next) => {
            setKnown(offered);
            setMaps(next);
            void run(true, next);
          }}
        />
      )}
      {outcome?.status === "done" && outcome.result.simulated && !previewed && (
        <p className="text-[12px] text-text-3">{t("djImport.stale")}</p>
      )}
      <p className="text-[12px] text-text-2">🛟 {t("djImport.readOnly", { name: title })}</p>
    </section>
  );
}

function History() {
  const { t, i18n } = useTranslation();
  const history = useImportHistory().data?.batches ?? [];
  const invalidate = useInvalidate();
  if (history.length === 0) return null;
  const date = (iso: string) =>
    new Date(iso).toLocaleString(i18n.language, { dateStyle: "medium", timeStyle: "short" });
  return (
    <section aria-label={t("djImport.history")} className="flex max-w-[880px] flex-col gap-2">
      <h2 className="text-label uppercase text-text-3">{t("djImport.history")}</h2>
      <ul className="flex flex-col rounded-md border border-border bg-surface-2">
        {history.map((b) => (
          <li
            key={b.batchId}
            className="flex items-center gap-3 border-b border-border px-3 py-2 text-[12px] last:border-b-0"
          >
            <span className="w-[88px] shrink-0 font-medium text-text">
              {IMPORT_SOURCES.find((s) => s.source === b.source)?.title}
            </span>
            <span className="min-w-0 flex-1 truncate text-text-2">
              {t("djImport.batch", {
                date: date(b.createdAt),
                tracks: formatCount(b.tracks, i18n.language),
                cues: formatCount(b.cues, i18n.language),
                playlists: formatCount(b.playlists, i18n.language),
              })}
            </span>
            {b.undoneAt ? (
              <span className="text-text-3">
                {t("djImport.undoneOn", { date: date(b.undoneAt) })}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => void undoImport(b.batchId, t, invalidate)}
                className="flex h-7 items-center gap-1.5 rounded-sm border border-border bg-surface-3 px-2 text-text hover:border-border-strong"
              >
                <Undo2 size={14} strokeWidth={1.5} />
                {t("djImport.undo")}
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function SourceNote({ source }: { source: ImportSource }) {
  const { t } = useTranslation();
  const status = useSources().data?.sources.find((s) => s.source === source);
  if (!status) return <>{t("detail.loading")}</>;
  if (source === "rekordbox" && !status.path) return <>{t("djImport.rows.rekordbox")}</>;
  if (status.running) return <span className="text-warning">{t("djImport.rows.running")}</span>;
  return <>{status.path ? t("djImport.rows.found") : t("djImport.rows.notFound")}</>;
}

function loadSource(): ImportSource {
  const stored = load(SOURCE_KEY);
  return IMPORT_SOURCES.find((s) => s.source === stored)?.source ?? "rekordbox";
}

export function ImportView() {
  const { t } = useTranslation();
  const [source, setSource] = useState<ImportSource>(loadSource);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const choose = (next: ImportSource) => {
    setSource(next);
    store(SOURCE_KEY, next);
  };
  const onKey = (e: KeyboardEvent, index: number) => {
    const step = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (index + step + IMPORT_SOURCES.length) % IMPORT_SOURCES.length;
    const item = IMPORT_SOURCES[next];
    if (!item) return;
    choose(item.source);
    tabs.current[next]?.focus();
  };
  const current = IMPORT_SOURCES.find((s) => s.source === source) ?? IMPORT_SOURCES[0];

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label={t("djImport.title")}>
      <header
        data-tauri-drag-region
        className="flex h-14 shrink-0 items-center border-b border-border px-5"
      >
        <h1 className="font-display text-title">{t("djImport.title")}</h1>
      </header>
      <div className="flex min-h-0 flex-1">
        <div className="flex w-[260px] shrink-0 flex-col gap-3 overflow-auto border-r border-border p-4">
          <p className="text-[12px] text-text-2">{t("djImport.intro")}</p>
          <div
            role="tablist"
            aria-label={t("djImport.sources")}
            aria-orientation="vertical"
            className="flex flex-col gap-1"
          >
            {IMPORT_SOURCES.map((item, i) => {
              const active = item.source === source;
              return (
                <button
                  key={item.source}
                  ref={(el) => {
                    tabs.current[i] = el;
                  }}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  aria-controls={`import-panel-${item.source}`}
                  aria-labelledby={`import-tab-${item.source}`}
                  aria-describedby={`import-note-${item.source}`}
                  tabIndex={active ? 0 : -1}
                  onClick={() => choose(item.source)}
                  onKeyDown={(e) => onKey(e, i)}
                  className={`flex items-center gap-3 rounded-sm px-2.5 py-2 text-left ${active ? "bg-primary-soft text-text" : "text-text-2 hover:bg-surface-2 hover:text-text"}`}
                >
                  <Disc3
                    aria-hidden
                    size={20}
                    strokeWidth={1.5}
                    className={`shrink-0 ${active ? "text-primary-ink" : ""}`}
                  />
                  <span className="flex min-w-0 flex-col">
                    <span className="font-medium" id={`import-tab-${item.source}`}>
                      {item.title}
                    </span>
                    <span
                      id={`import-note-${item.source}`}
                      className="truncate text-[12px] text-text-3"
                    >
                      <SourceNote source={item.source} />
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-auto p-5">
          {current && <Panel key={current.source} source={current.source} title={current.title} />}
          <History />
        </div>
      </div>
    </section>
  );
}
