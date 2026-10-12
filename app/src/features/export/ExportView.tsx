// DESIGN 6.8 — export to DJ software. The destinations are a list on the left (each with
// what it found: the collection, the program open…); one is shown at a time, with which
// tracks to export (the whole library, one playlist or the selection), what to export and
// where, Simulate / Export and the result right under them. Every target can simulate
// first; real exports back up the destination before replacing it (SPEC 2.12).
import { useQuery } from "@tanstack/react-query";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  CircleCheck,
  Disc3,
  FileOutput,
  FolderSearch,
  LoaderCircle,
  TriangleAlert,
} from "lucide-react";
import { type KeyboardEvent, type ReactNode, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatCount } from "../../lib/format";
import type { ExportOptions, ExportResult, ExportWarning } from "../../lib/rpc.types";
import { Modal } from "../../components/Modal";
import { Segmented } from "../../components/Segmented";
import { playlistLabel } from "../../lib/playlistIcons";
import { usePlaylistTree } from "../playlists/api";
import { revealFile } from "../../lib/reveal";
import { useLibraryStore } from "../library/store";
import { startTagUndo } from "../tags/api";
import { useToastStore } from "../toast/toastStore";
import { request } from "../../lib/rpc";
import type { Notation } from "../../lib/keys";
import { type SupportedTarget, startExport } from "./api";
import { type ExportOutcome, type ExportTarget, useExportStore } from "./exportStore";
import { describeMessage, errorMessage } from "../../lib/errors";

type Scope = "library" | "playlist" | "selection";
type Flag = "cues" | "colors" | "beatgrid" | "key" | "includePlaylists" | "memoryCues";

const PATH_KEY = (target: ExportTarget) => `tonalia.export.${target}.path`;

function loadPath(target: ExportTarget): string | null {
  try {
    return localStorage.getItem(PATH_KEY(target));
  } catch {
    return null;
  }
}

function savePath(target: ExportTarget, path: string): void {
  try {
    localStorage.setItem(PATH_KEY(target), path);
  } catch {
    // Not remembered; the export still uses it.
  }
}

function Check({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex items-center gap-2 text-body">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="size-4 accent-[var(--color-primary)]"
      />
      {label}
    </label>
  );
}

function groupWarnings(warnings: ExportWarning[]): [ExportWarning["code"], ExportWarning[]][] {
  const groups = new Map<ExportWarning["code"], ExportWarning[]>();
  for (const w of warnings) groups.set(w.code, [...(groups.get(w.code) ?? []), w]);
  return [...groups];
}

function RevealButton({ path, label }: { path: string; label: string }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={() =>
        void revealFile(path).catch((err: unknown) =>
          useToastStore.getState().push({
            title: t("export.revealFailed", {
              error: errorMessage(err),
            }),
            tone: "danger",
          }),
        )
      }
      className="flex h-7 items-center gap-1.5 rounded-sm border border-border bg-surface-3 px-2 text-[12px] text-text hover:border-border-strong"
    >
      <FolderSearch size={14} strokeWidth={1.5} />
      {label}
    </button>
  );
}

function ResultPanel({ outcome }: { outcome: ExportOutcome }) {
  const { t, i18n } = useTranslation();
  if (outcome.status === "failed") {
    return (
      <div role="status" className="rounded-md border border-danger bg-surface-1 p-3 text-danger">
        {t("export.failed", { error: describeMessage(outcome.error) })}
      </div>
    );
  }
  if (outcome.status === "cancelled") {
    return (
      <div role="status" className="text-text-2">
        {t("export.cancelled")}
      </div>
    );
  }
  const r: ExportResult = outcome.result;
  const n = (value: number) => formatCount(value, i18n.language);
  return (
    <div
      role="status"
      className="flex flex-col gap-2 rounded-md border border-border bg-surface-1 p-3"
    >
      <div className="font-medium">
        {r.simulated ? t("export.simulatedTitle") : t("export.doneTitle")}
      </div>
      <div className="text-control tabular-nums text-text-2">
        {t("export.summary", {
          tracks: n(r.tracks),
          cues: n(r.cues),
          playlists: n(r.playlists),
          warnings: n(r.warnings.length),
        })}
      </div>
      {r.path && (
        <div className="truncate font-mono text-[12px] text-text-3" title={r.path}>
          {r.path}
        </div>
      )}
      {r.batchId && (
        <div className="flex items-center gap-2 text-[12px] text-text-2">
          <span>{t("export.inFileBackup")}</span>
          <button
            type="button"
            onClick={() => {
              const batchId = r.batchId;
              if (batchId) void startTagUndo(batchId);
            }}
            className="h-7 rounded-sm border border-border bg-surface-3 px-2 text-text hover:border-border-strong"
          >
            {t("tags.undo")}
          </button>
        </div>
      )}
      {r.backupPath && (
        <div className="truncate text-[12px] text-text-2" title={r.backupPath}>
          {t("export.backup", { path: r.backupPath })}
        </div>
      )}
      {!r.simulated && (r.path || r.backupPath) && (
        <div className="flex flex-wrap gap-2">
          {r.path && <RevealButton path={r.path} label={t("export.revealFile")} />}
          {r.backupPath && <RevealButton path={r.backupPath} label={t("export.revealBackup")} />}
        </div>
      )}
      {(r.items?.length ?? 0) > 0 && (
        <details className="text-[12px]">
          <summary className="cursor-pointer text-text-2">
            {t("export.itemsTitle", { count: r.tracks })}
          </summary>
          <ul className="mt-2 flex max-h-[240px] flex-col overflow-auto rounded-sm border border-border">
            {(r.items ?? []).map((item) => (
              <li
                key={item.trackId}
                className="flex items-center gap-2 border-b border-border px-2 py-1 last:border-b-0"
              >
                <span className="min-w-0 flex-1 truncate" title={item.title}>
                  {item.title}
                </span>
                <span className="font-mono text-text-3">
                  {t("export.itemCues", { count: item.cues })}
                </span>
                <span
                  className={`rounded-pill px-2 text-[11px] ${item.action === "added" ? "bg-primary-soft text-text" : "bg-surface-3 text-text-2"}`}
                >
                  {t(`export.actions.${item.action}`)}
                </span>
              </li>
            ))}
            {r.tracks > (r.items?.length ?? 0) && (
              <li className="px-2 py-1 text-text-3">
                {t("export.more", { count: r.tracks - (r.items?.length ?? 0) })}
              </li>
            )}
          </ul>
        </details>
      )}
      {r.warnings.length > 0 && (
        <details className="text-[12px]">
          <summary className="cursor-pointer text-warning">
            {t("export.warningsTitle", { count: r.warnings.length })}
          </summary>
          <ul className="mt-2 flex flex-col gap-2">
            {groupWarnings(r.warnings).map(([code, items]) => (
              <li key={code}>
                <div className="flex items-center gap-1.5 text-text">
                  <TriangleAlert size={12} strokeWidth={1.5} className="text-warning" />
                  {t(`export.warnings.${code}`, { count: items.length })}
                </div>
                <ul className="ml-5 text-text-3">
                  {items.slice(0, 5).map((w, i) => (
                    <li key={i} className="truncate" title={w.path ?? undefined}>
                      {w.path ?? `#${w.trackId}`}
                    </li>
                  ))}
                  {items.length > 5 && <li>{t("export.more", { count: items.length - 5 })}</li>}
                </ul>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function Card({
  target,
  title,
  description,
  flags,
  defaultFile,
  extension,
  pick = "save",
  notation,
  foundPath = null,
  status,
  blocked = false,
  guide,
}: {
  target: SupportedTarget;
  title: string;
  description: string;
  flags: Flag[];
  defaultFile: string;
  extension: string;
  /** "open": the destination is an existing file the export updates (Traktor);
   * "none": written into the audio files themselves (Serato). */
  pick?: "save" | "open" | "none";
  notation: Notation;
  /** Destination found automatically (used unless the user chose another). */
  foundPath?: string | null;
  status?: ReactNode;
  /** Real exports are disabled (e.g. the program is open); simulating still works. */
  blocked?: boolean;
  guide?: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const selected = useLibraryStore((s) => s.selected);
  const running = useExportStore((s) => s.running);
  const outcome = useExportStore((s) => s.outcomes[target]);
  const [values, setValues] = useState<Record<Flag, boolean>>({
    cues: true,
    colors: true,
    beatgrid: true,
    key: true,
    includePlaylists: true,
    memoryCues: false,
  });
  const [scope, setScope] = useState<Scope>("library");
  const [playlistId, setPlaylistId] = useState<number | null>(null);
  const playlists = usePlaylistTree();
  // A selection that went away leaves the library chosen, not an empty export.
  const activeScope: Scope = scope === "selection" && selected.length === 0 ? "library" : scope;
  const needsPlaylist = activeScope === "playlist" && playlistId == null;
  const [confirming, setConfirming] = useState<string | null>(null);
  const [chosen, setPath] = useState<string | null>(() => loadPath(target));
  const path = chosen ?? foundPath;
  const busy = running != null;

  const choosePath = async (): Promise<string | null> => {
    const filters = [{ name: extension.toUpperCase(), extensions: [extension] }];
    const picked =
      pick === "open"
        ? await open({
            multiple: false,
            filters,
            title: t("export.chooseCollection", { file: defaultFile }),
          })
        : await save({ defaultPath: path ?? defaultFile, filters, title: t("export.choosePath") });
    if (typeof picked !== "string") return null;
    setPath(picked);
    savePath(target, picked);
    return picked;
  };

  const run = async (simulate: boolean, confirmed = false) => {
    const destination = pick === "none" ? null : (path ?? (simulate ? null : await choosePath()));
    if (!simulate && pick !== "none" && !destination) return;
    // Editing another program's collection: say what will change before doing it.
    if (!simulate && pick === "open" && !confirmed && destination) {
      setConfirming(destination);
      return;
    }
    const options: ExportOptions = {
      ...values,
      simulate,
      path: destination,
      trackIds: activeScope === "selection" ? selected : null,
      ...(activeScope === "playlist" && playlistId != null ? { playlistIds: [playlistId] } : {}),
      notation,
      language: i18n.language.startsWith("es") ? "es" : "en",
    };
    try {
      await startExport(target, options);
    } catch (err) {
      useToastStore.getState().push({
        title: t("export.failed", { error: errorMessage(err) }),
        tone: "danger",
      });
    }
  };

  return (
    <section
      id={`export-panel-${target}`}
      aria-label={title}
      className="flex max-w-[720px] flex-col gap-5 rounded-md border border-border bg-surface-2 p-5"
    >
      <header className="flex flex-col gap-1">
        <h2 className="font-display text-title">{title}</h2>
        <p className="text-body text-text-2">{description}</p>
      </header>
      {status}
      <div className="flex flex-col gap-2">
        <span className="text-label uppercase text-text-3">{t("export.scope")}</span>
        <div className="flex flex-wrap items-center gap-3">
          <Segmented<Scope>
            size="sm"
            label={t("export.scope")}
            value={activeScope}
            onChange={setScope}
            options={[
              { value: "library", label: t("export.scopes.library") },
              { value: "playlist", label: t("export.scopes.playlist") },
              ...(selected.length > 0
                ? [
                    {
                      value: "selection" as const,
                      label: t("export.scopes.selection", { count: selected.length }),
                    },
                  ]
                : []),
            ]}
          />
          {activeScope === "playlist" && (
            <select
              aria-label={t("export.choosePlaylist")}
              value={playlistId ?? ""}
              onChange={(e) => setPlaylistId(e.target.value ? Number(e.target.value) : null)}
              className="h-8 max-w-[260px] rounded-sm border border-border bg-surface-3 px-2 text-control text-text"
            >
              <option value="">{t("export.choosePlaylist")}</option>
              {playlists.map((p) => (
                <option key={p.id} value={p.id}>
                  {playlistLabel(p)}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>
      <fieldset className="grid grid-cols-3 gap-2">
        <legend className="mb-2 text-label uppercase text-text-3">{t("export.what")}</legend>
        {flags.map((flag) => (
          <Check
            key={flag}
            checked={values[flag]}
            onChange={(checked) => setValues((v) => ({ ...v, [flag]: checked }))}
            label={t(`export.flags.${flag}`)}
          />
        ))}
      </fieldset>
      {pick !== "none" && (
        <div className="flex items-center gap-2 text-[12px]">
          <span className="text-text-3">{t("export.destination")}</span>
          <span
            className={`min-w-0 flex-1 truncate ${path ? "font-mono text-text-2" : "text-text-3"}`}
            title={path ?? undefined}
          >
            {path ?? t("export.noDestination")}
          </span>
          <button
            type="button"
            onClick={() => void choosePath()}
            className="h-7 rounded-sm px-2 text-primary-ink hover:bg-surface-3"
          >
            {t("export.change")}
          </button>
        </div>
      )}
      <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
        {needsPlaylist && (
          <span className="mr-auto text-[12px] text-text-3">{t("export.pickPlaylist")}</span>
        )}
        <button
          type="button"
          disabled={busy || needsPlaylist}
          onClick={() => void run(true)}
          className="flex h-8 items-center gap-1.5 rounded-sm border border-border bg-surface-3 px-3 text-text hover:border-border-strong disabled:opacity-40"
        >
          {running?.target === target && running.simulate && (
            <LoaderCircle size={14} strokeWidth={1.5} className="motion-safe:animate-spin" />
          )}
          {t("export.simulate")}
        </button>
        <button
          type="button"
          disabled={busy || blocked || needsPlaylist}
          onClick={() => void run(false)}
          className="flex h-8 items-center gap-1.5 rounded-sm bg-primary px-3 font-semibold text-white hover:bg-primary-hover disabled:opacity-40"
        >
          {running?.target === target && !running.simulate ? (
            <LoaderCircle size={14} strokeWidth={1.5} className="motion-safe:animate-spin" />
          ) : (
            <FileOutput size={14} strokeWidth={1.5} />
          )}
          {t("export.export")}
        </button>
      </div>
      {outcome && <ResultPanel outcome={outcome} />}
      {guide}
      {confirming && (
        <Modal
          label={t("export.confirmTitle", { name: title })}
          onClose={() => setConfirming(null)}
          width={460}
        >
          <div className="flex flex-col gap-3 p-5">
            <h2 className="font-display text-title">{t("export.confirmTitle", { name: title })}</h2>
            <p className="text-body text-text-2">{t("export.confirmText", { name: title })}</p>
            <p className="break-all font-mono text-[12px] text-text-3">{confirming}</p>
            <p className="text-body text-text-2">🛟 {t("export.confirmBackup")}</p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirming(null)}
                className="h-8 rounded-sm border border-border bg-surface-3 px-3 text-text"
              >
                {t("edit.cancel")}
              </button>
              <button
                type="button"
                data-autofocus
                onClick={() => {
                  setConfirming(null);
                  void run(false, true);
                }}
                className="h-8 rounded-sm bg-primary px-3 font-semibold text-white hover:bg-primary-hover"
              >
                {t("export.confirmGo")}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}

function RekordboxGuide() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-2 rounded-md bg-surface-1 p-3 text-[12px] text-text-2">
      <h3 className="text-label uppercase text-text-3">{t("export.afterExport")}</h3>
      <ol className="flex flex-col gap-1.5">
        {[1, 2, 3].map((step) => (
          <li key={step} className="flex gap-2">
            <span className="grid size-5 shrink-0 place-items-center rounded-pill bg-primary-soft font-mono text-[11px] text-text">
              {step}
            </span>
            <span>{t(`export.rekordbox.step${step}`)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
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

type CollectionTarget = "traktor" | "virtualdj" | "engineDj";
const STATUS_METHOD = {
  traktor: "export.traktorStatus",
  virtualdj: "export.virtualdjStatus",
  engineDj: "export.engineDjStatus",
} as const;

/** Where the program keeps its collection and whether it is open (polled). */
function useCollectionStatus(target: CollectionTarget) {
  return useQuery({
    queryKey: ["export", STATUS_METHOD[target]],
    queryFn: () => request(STATUS_METHOD[target]),
    refetchInterval: 5000,
  });
}

function CollectionCard({
  target,
  title,
  flags,
  defaultFile,
  extension,
  notation,
  note,
}: {
  target: CollectionTarget;
  title: string;
  flags: Flag[];
  defaultFile: string;
  extension: string;
  notation: Notation;
  /** A short explanation shown under the status (e.g. what Engine DJ needs). */
  note?: string;
}) {
  const { t } = useTranslation();
  const status = useCollectionStatus(target);
  const running = status.data?.running ?? false;
  const found = status.data?.collectionPath ?? null;
  return (
    <Card
      target={target}
      title={title}
      description={t(`export.${target}.description`)}
      flags={flags}
      defaultFile={defaultFile}
      extension={extension}
      pick="open"
      notation={notation}
      foundPath={found}
      blocked={running}
      guide={note ? <StatusLine tone="ok">{note}</StatusLine> : undefined}
      status={
        running ? (
          <StatusLine tone="warning">{t(`export.${target}.running`)}</StatusLine>
        ) : found ? (
          <StatusLine tone="ok">{t("export.found", { path: found })}</StatusLine>
        ) : status.data ? (
          <StatusLine tone="warning">{t(`export.${target}.notFound`)}</StatusLine>
        ) : null
      }
    />
  );
}

const TARGETS: { target: SupportedTarget; title: string }[] = [
  { target: "rekordbox", title: "Rekordbox" },
  { target: "traktor", title: "Traktor" },
  { target: "serato", title: "Serato" },
  { target: "virtualdj", title: "VirtualDJ" },
  { target: "engineDj", title: "Engine DJ" },
];
const TARGET_KEY = "tonalia.export.target";

function loadTarget(): SupportedTarget {
  try {
    const stored = localStorage.getItem(TARGET_KEY);
    return TARGETS.find((x) => x.target === stored)?.target ?? "rekordbox";
  } catch {
    return "rekordbox";
  }
}

/** One line under each destination: what it writes or what was found. */
function TargetNote({ target }: { target: SupportedTarget }) {
  const { t } = useTranslation();
  if (target === "rekordbox") return <>{t("export.rows.file", { file: "rekordbox.xml" })}</>;
  if (target === "serato") return <>{t("export.rows.inFiles")}</>;
  return <CollectionNote target={target} />;
}

function CollectionNote({ target }: { target: CollectionTarget }) {
  const { t } = useTranslation();
  const status = useCollectionStatus(target).data;
  if (!status) return <>{t("detail.loading")}</>;
  if (status.running) return <span className="text-warning">{t("export.rows.running")}</span>;
  return <>{status.collectionPath ? t("export.rows.found") : t("export.rows.notFound")}</>;
}

export function ExportView() {
  const { t } = useTranslation();
  const [target, setTarget] = useState<SupportedTarget>(loadTarget);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const choose = (next: SupportedTarget) => {
    setTarget(next);
    try {
      localStorage.setItem(TARGET_KEY, next);
    } catch {
      // Not remembered; it is still shown.
    }
  };
  const onKey = (e: KeyboardEvent, index: number) => {
    const step = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (index + step + TARGETS.length) % TARGETS.length;
    const item = TARGETS[next];
    if (!item) return;
    choose(item.target);
    tabs.current[next]?.focus();
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label={t("export.title")}>
      <header
        data-tauri-drag-region
        className="flex h-14 shrink-0 items-center border-b border-border px-5"
      >
        <h1 className="font-display text-title">{t("export.title")}</h1>
      </header>
      <div className="flex min-h-0 flex-1">
        <div className="flex w-[260px] shrink-0 flex-col gap-3 overflow-auto border-r border-border p-4">
          <p className="text-[12px] text-text-2">{t("export.intro")}</p>
          <div
            role="tablist"
            aria-label={t("export.targets")}
            aria-orientation="vertical"
            className="flex flex-col gap-1"
          >
            {TARGETS.map((item, i) => {
              const active = item.target === target;
              return (
                <button
                  key={item.target}
                  ref={(el) => {
                    tabs.current[i] = el;
                  }}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  aria-controls={`export-panel-${item.target}`}
                  aria-labelledby={`export-tab-${item.target}`}
                  aria-describedby={`export-note-${item.target}`}
                  tabIndex={active ? 0 : -1}
                  onClick={() => choose(item.target)}
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
                    <span className="font-medium" id={`export-tab-${item.target}`}>
                      {item.title}
                    </span>
                    <span
                      id={`export-note-${item.target}`}
                      className="truncate text-[12px] text-text-3"
                    >
                      <TargetNote target={item.target} />
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-5">
          {target === "rekordbox" && (
            <Card
              target="rekordbox"
              title="Rekordbox"
              description={t("export.rekordbox.description")}
              flags={["cues", "colors", "beatgrid", "key", "includePlaylists", "memoryCues"]}
              defaultFile="rekordbox.xml"
              extension="xml"
              notation="classical"
              guide={<RekordboxGuide />}
            />
          )}
          {target === "traktor" && (
            <CollectionCard
              target="traktor"
              title="Traktor"
              flags={["cues", "beatgrid", "key", "includePlaylists"]}
              defaultFile="collection.nml"
              extension="nml"
              notation="open_key"
            />
          )}
          {target === "serato" && (
            <Card
              target="serato"
              title="Serato"
              description={t("export.serato.description")}
              flags={["cues", "colors"]}
              defaultFile=""
              extension="mp3"
              pick="none"
              notation="classical"
              status={<StatusLine tone="ok">{t("export.serato.note")}</StatusLine>}
            />
          )}
          {target === "virtualdj" && (
            <CollectionCard
              target="virtualdj"
              title="VirtualDJ"
              flags={["cues", "beatgrid", "key"]}
              defaultFile="database.xml"
              extension="xml"
              notation="classical"
            />
          )}
          {target === "engineDj" && (
            <CollectionCard
              target="engineDj"
              title="Engine DJ"
              flags={["cues", "colors", "beatgrid", "key", "includePlaylists"]}
              defaultFile="m.db"
              extension="db"
              notation="classical"
              note={t("export.engineDj.note")}
            />
          )}
        </div>
      </div>
    </section>
  );
}
