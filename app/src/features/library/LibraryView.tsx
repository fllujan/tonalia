import { QueueProgress } from "../analysis/QueueProgress";
import { useQueryClient } from "@tanstack/react-query";
import { markReviewed } from "./markReviewed";
import { QueueSummary } from "../analysis/QueueSummary";
import { SegmentThumb } from "../../components/SegmentThumb";
import {
  CheckCheck,
  FolderPlus,
  ListMusic,
  RotateCcw,
  Rows3,
  Rows4,
  Search,
  SearchX,
  ShieldCheck,
  Sparkles,
  Tags,
  WandSparkles,
  X,
} from "lucide-react";
import { StemsBar } from "../stems/StemsUi";
import { useDeferredValue, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { PlaylistIcon } from "../../components/PlaylistIcon";
import { formatCount } from "../../lib/format";
import { displayKey, makeKey, type Notation } from "../../lib/keys";
import { useSettings, useUpdateSettings } from "../settings/api";
import { useViewStore } from "../navigation/viewStore";
import { playlistApi, usePlaylist, usePlaylistMutation } from "../playlists/api";
import { hasConditions } from "../playlists/filter";
import { SmartPlaylistDialog } from "../playlists/SmartPlaylistDialog";
import {
  analyzePending,
  cancelAnalysis,
  cancelImport,
  fetchAllIds,
  isNonEmpty,
  type ListParams,
  QUEUE_STATUSES,
  reanalyze,
  useLibraryTotal,
} from "./api";
import { errorMessage } from "../../lib/errors";
import { useToastStore } from "../toast/toastStore";
import { useAnalysisStore } from "./analysisStore";
import { useImportStore } from "./importStore";
import { ActiveFilters, FiltersButton } from "./Filters";
import { JobBar } from "./JobBar";
import { ROW_HEIGHT, TABLE_HEADER, useLibraryStore } from "./store";
import { SelectionBar } from "./SelectionBar";
import { TrackTable } from "./TrackTable";
import { EmptyState } from "../../components/EmptyState";

const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);

function SearchBox() {
  const { t } = useTranslation();
  const search = useLibraryStore((s) => s.search);
  const setSearch = useLibraryStore((s) => s.setSearch);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <label className="flex h-8 w-[180px] min-w-[120px] shrink-[100000] items-center gap-2 xl:w-[260px] rounded-sm border border-border bg-surface-3 pl-2.5 pr-2 text-text-3 focus-within:border-primary">
      <Search aria-hidden size={16} strokeWidth={1.5} />
      <input
        ref={inputRef}
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && setSearch("")}
        placeholder={t("library.searchShort")}
        aria-label={t("library.search")}
        className="min-w-0 flex-1 bg-transparent text-text outline-none placeholder:text-text-3"
      />
      {search ? (
        <button
          type="button"
          aria-label={t("library.clearSearch")}
          onClick={() => setSearch("")}
          className="hit-target relative grid size-5 place-items-center rounded-sm hover:text-text"
        >
          <X size={14} strokeWidth={1.5} />
        </button>
      ) : (
        <kbd className="h-[18px] rounded-[4px] border border-border-strong px-1.5 font-mono text-[11px] leading-[16px]">
          {isMac ? "⌘F" : "Ctrl F"}
        </kbd>
      )}
    </label>
  );
}

function DensityToggle() {
  const { t } = useTranslation();
  const density = useLibraryStore((s) => s.density);
  const setDensity = useLibraryStore((s) => s.setDensity);
  const options = [
    { value: "comfortable", icon: Rows3, label: t("library.densityComfortable") },
    { value: "compact", icon: Rows4, label: t("library.densityCompact") },
  ] as const;
  return (
    <div
      role="radiogroup"
      className="relative flex gap-0.5 rounded-[7px] border border-border bg-bg p-0.5"
    >
      <SegmentThumb />
      {options.map(({ value, icon: Icon, label }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={density === value}
          title={label}
          aria-label={label}
          onClick={() => setDensity(value)}
          className={`grid h-[26px] w-7 place-items-center rounded-[5px] transition-colors duration-hover ${density === value ? "bg-surface-3 text-text" : "text-text-3 hover:text-text"}`}
        >
          <Icon size={16} strokeWidth={1.5} />
        </button>
      ))}
    </div>
  );
}

// DESIGN 6.2: quick notation switch, the same four as Settings. The sample is F♯m
// (11A · 4m · F♯m · G♭m) so the sharps and the flats read differently.
const QUICK_NOTATIONS: readonly Notation[] = [
  "alphanumeric",
  "open_key",
  "classical",
  "classical_flat",
];
const SAMPLE_KEY = makeKey(6, "minor");

function NotationToggle() {
  const { t } = useTranslation();
  const { notation } = useSettings();
  const update = useUpdateSettings((error) => t("settings.saveFailed", { error }));
  const active = notation;
  return (
    <div
      role="radiogroup"
      aria-label={t("settings.notation")}
      className="relative flex gap-0.5 rounded-[7px] border border-border bg-bg p-0.5"
    >
      <SegmentThumb />
      {QUICK_NOTATIONS.map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={active === n}
          title={t(`settings.notations.${n}`)}
          onClick={() => active !== n && update.mutate({ notation: n })}
          className={`h-[26px] rounded-[5px] px-2 font-mono text-[12px] transition-colors duration-hover ${active === n ? "bg-surface-3 text-text" : "text-text-3 hover:text-text"}`}
        >
          {displayKey(SAMPLE_KEY, n)}
        </button>
      ))}
    </div>
  );
}

function ImportBar() {
  const { t } = useTranslation();
  const { jobId, stage, done, total, percent } = useImportStore();
  if (!jobId) return null;
  const label =
    stage === "importing" && total > 0
      ? t("import.progress", { done, total })
      : t("import.scanning");
  return <JobBar label={label} percent={percent} onCancel={() => void cancelImport()} />;
}

function AnalysisBar() {
  const { t } = useTranslation();
  const { jobId, done, total, percent } = useAnalysisStore();
  if (!jobId) return null;
  const label = total > 0 ? t("analysis.progress", { done, total }) : t("analysis.starting");
  return <JobBar label={label} percent={percent} onCancel={() => void cancelAnalysis()} />;
}

export type LibraryScope = "all" | "review" | "playlist" | "queue";

const BY_STATUS = (status: "pending" | "error"): ListParams => ({
  search: null,
  sort: "added_at",
  descending: true,
  filter: { statuses: [status] },
});

/** "Analizar" header actions: analyse what is pending, retry what failed. */
function QueueActions() {
  const { t, i18n } = useTranslation();
  const pending = useLibraryTotal(BY_STATUS("pending")).total;
  const failed = useLibraryTotal(BY_STATUS("error")).total;
  const report = (err: unknown) =>
    useToastStore.getState().push({
      title: t("analysis.failed", { error: errorMessage(err) }),
      tone: "danger",
    });
  const n = (count: number) => formatCount(count, i18n.language);
  // One analysis at a time: the queue's own header shows it and can cancel it.
  const running = useAnalysisStore((s) => s.jobId !== null);
  return (
    <>
      {failed > 0 && (
        <button
          type="button"
          disabled={running}
          onClick={() => void fetchAllIds(BY_STATUS("error")).then(reanalyze).catch(report)}
          title={t("analysis.retryFailed", { count: failed, formatted: n(failed) })}
          className="flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-sm border border-border bg-surface-3 px-2 text-text transition-colors duration-hover hover:border-border-strong disabled:opacity-40 xl:px-3"
        >
          <RotateCcw aria-hidden size={14} strokeWidth={1.5} />
          {/* Narrow windows keep the icon only (the label stays for screen readers). */}
          <span className="sr-only xl:not-sr-only">
            {t("analysis.retryFailed", { count: failed, formatted: n(failed) })}
          </span>
        </button>
      )}
      {/* Nothing pending: the button goes (the queue's empty state or the last run's
          line says so) rather than sitting there as "Analizar 0 pendientes". */}
      {pending > 0 && (
        <button
          type="button"
          disabled={running}
          onClick={() => void analyzePending().catch(report)}
          className="flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-sm bg-primary px-3 font-semibold text-white transition-colors duration-hover hover:bg-primary-hover disabled:opacity-40"
        >
          <Sparkles aria-hidden size={14} strokeWidth={1.5} />
          {t("analysis.analyzePending", { count: pending, formatted: n(pending) })}
        </button>
      )}
    </>
  );
}

export function LibraryView({
  scope = "all",
  onAddMusic,
}: {
  scope?: LibraryScope;
  onAddMusic: () => void;
}) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const search = useLibraryStore((s) => s.search);
  const playlistId = useViewStore((s) => (scope === "playlist" ? s.playlistId : null));
  const playlist = usePlaylist(playlistId);
  // Regular playlists sort by their own order unless the user picks a column.
  const regular = playlist != null && playlist.smart == null;
  const sortScope = regular ? "playlist" : "library";
  const sort = useLibraryStore((s) => (regular ? s.playlistSort : s.sort));
  const descending = useLibraryStore((s) => (regular ? s.playlistDescending : s.descending));
  const toggleSort = useLibraryStore((s) => s.toggleSort);
  const deferredSearch = useDeferredValue(search.trim());
  const filter = useLibraryStore((s) => s.filter);
  const filtering = hasConditions(filter);
  const params: ListParams = {
    filter:
      scope === "queue"
        ? { ...(filtering ? filter : {}), statuses: [...QUEUE_STATUSES] }
        : filtering
          ? filter
          : null,
    search: deferredSearch || null,
    sort,
    descending,
    qualityIssues: scope === "review" ? true : null,
    playlistId: playlist?.id ?? null,
  };
  const title =
    scope === "review"
      ? t("nav.reviewQuality")
      : scope === "queue"
        ? t("nav.analyze")
        : playlist
          ? playlist.name
          : t("library.title");
  const selected = useLibraryStore((s) => s.selected);
  const rowHeight = useLibraryStore((s) => ROW_HEIGHT[s.density]);
  const openTags = useViewStore((s) => s.openTags);
  const { total } = useLibraryTotal(params);
  const removeTracks = usePlaylistMutation(playlistApi.removeTracks);
  const [editingSmart, setEditingSmart] = useState(false);
  const reorderable =
    regular && sort === "position" && !descending && !deferredSearch && !filtering;
  const listKey = scope === "playlist" ? `playlist:${playlistId ?? ""}` : scope;
  useEffect(() => useLibraryStore.getState().enterList(listKey), [listKey]);

  return (
    <section className="relative flex min-h-0 flex-1 flex-col" aria-label={title}>
      <header
        data-tauri-drag-region
        className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-5 xl:gap-3"
      >
        {/* Sized by its content; the search box shrinks first (a far larger factor), so it gives up
            its width before the title is cut. */}
        <div
          className="flex min-w-0 flex-auto items-baseline gap-2 xl:gap-2.5"
          data-tauri-drag-region
        >
          {playlist && (
            <PlaylistIcon
              emoji={playlist.emoji}
              smart={playlist.smart != null}
              size={20}
              className="self-center text-text-2"
            />
          )}
          <h1 className="truncate whitespace-nowrap font-display text-title" title={title}>
            {title}
          </h1>
          <span className="whitespace-nowrap text-text-3 tabular">
            {t("library.count", { count: total, formatted: formatCount(total, i18n.language) })}
          </span>
        </div>
        {playlist?.smart && (
          <button
            type="button"
            onClick={() => setEditingSmart(true)}
            aria-label={t("playlists.editSmart")}
            className="flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-sm px-2 text-text-2 hover:bg-surface-2 hover:text-text"
          >
            <WandSparkles aria-hidden size={14} strokeWidth={1.5} />
            {/* Narrow windows keep the icon only, so the playlist name has room. */}
            <span className="hidden xl:inline">{t("playlists.editSmart")}</span>
          </button>
        )}
        <SearchBox />
        <FiltersButton />
        {/* The queue shows no keys (only what is left to analyse): no notation to switch. */}
        {scope !== "queue" && <NotationToggle />}
        <DensityToggle />
        {/* Tracks still to analyse have no results to write. */}
        {scope !== "queue" && (
          <button
            type="button"
            disabled={total === 0}
            onClick={() =>
              void (selected.length
                ? Promise.resolve(selected).then((ids) => openTags(ids, "selection"))
                : fetchAllIds(params).then((ids) => openTags(ids, "view")))
            }
            title={selected.length ? t("tags.forSelection") : t("tags.forView")}
            aria-label={t("tags.button")}
            className="flex h-8 shrink-0 items-center gap-1.5 rounded-sm border border-border bg-surface-3 px-2 text-text transition-colors duration-hover hover:border-border-strong disabled:opacity-40 xl:px-3"
          >
            <Tags aria-hidden size={16} strokeWidth={1.5} />
            <span className="hidden xl:inline">{t("tags.button")}</span>
          </button>
        )}
        {scope === "queue" ? (
          <QueueActions />
        ) : (
          <button
            type="button"
            onClick={onAddMusic}
            className="flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-sm bg-primary px-3 font-semibold text-white transition-colors duration-hover hover:bg-primary-hover"
          >
            <FolderPlus size={16} strokeWidth={1.5} />
            {t("library.addMusic")}
          </button>
        )}
      </header>
      <ActiveFilters />
      <ImportBar />
      {scope === "queue" ? <QueueProgress /> : <AnalysisBar />}
      {scope === "review" && total > 0 && (
        <p className="shrink-0 border-b border-border px-5 py-2 text-control text-text-2">
          {t("quality.reviewHint")}
        </p>
      )}
      <StemsBar />
      <div className="flex min-h-0 flex-1">
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          {/* Floating over the table (not the queue summary), so selecting a row never
              shifts the table under the pointer. */}
          {isNonEmpty(selected) && (
            <SelectionBar
              selected={selected}
              rowsEnd={TABLE_HEADER + total * rowHeight}
              canWriteTags={scope !== "queue"}
              onMarkReviewed={
                scope === "review" ? () => markReviewed(selected, null, t, queryClient) : undefined
              }
              onRemoveFromPlaylist={
                regular
                  ? () =>
                      removeTracks.mutate(
                        { playlistId: playlist.id, trackIds: selected },
                        { onSuccess: () => useLibraryStore.getState().setSelected([]) },
                      )
                  : undefined
              }
            />
          )}
          {total === 0 && (deferredSearch || filtering) ? (
            <EmptyState
              icon={SearchX}
              title={t("library.noResults")}
              text={t("library.noResultsText")}
              action={
                <button
                  type="button"
                  onClick={() => {
                    useLibraryStore.getState().setSearch("");
                    useLibraryStore.getState().setFilter({});
                  }}
                  className="h-[30px] rounded-sm border border-border bg-surface-3 px-3 text-text"
                >
                  {filtering ? t("filters.clearAll") : t("library.clearSearch")}
                </button>
              }
            />
          ) : total === 0 && playlist ? (
            <EmptyState
              icon={playlist.smart ? WandSparkles : ListMusic}
              title={t(playlist.smart ? "playlists.smartNoMatches" : "playlists.emptyTitle")}
              text={t(playlist.smart ? "playlists.smartNoMatchesText" : "playlists.emptyText")}
              action={
                playlist.smart ? undefined : (
                  <button
                    type="button"
                    onClick={() => useViewStore.getState().show("library")}
                    className="h-[30px] rounded-sm border border-border bg-surface-3 px-3 text-text hover:border-border-strong"
                  >
                    {t("playlists.goToLibrary")}
                  </button>
                )
              }
            />
          ) : total === 0 && scope === "queue" ? (
            <EmptyState
              icon={CheckCheck}
              title={t("analysis.queueEmptyTitle")}
              text={t("analysis.queueEmptyText")}
            />
          ) : total === 0 && scope === "review" ? (
            <EmptyState
              icon={ShieldCheck}
              title={t("quality.emptyTitle")}
              text={t("quality.emptyText")}
            />
          ) : (
            <TrackTable
              params={params}
              total={total}
              onSort={(column) => toggleSort(column, sortScope)}
              positionSort={regular}
              reorderable={reorderable}
              queue={scope === "queue"}
              review={scope === "review"}
            />
          )}
        </div>
        {scope === "queue" && <QueueSummary />}
      </div>
      {editingSmart && playlist?.smart && (
        <SmartPlaylistDialog editing={playlist} onClose={() => setEditingSmart(false)} />
      )}
    </section>
  );
}
