import { SegmentThumb } from "../../components/SegmentThumb";
import {
  FolderPlus,
  Disc3,
  ListMinus,
  ListMusic,
  Pencil,
  Rows3,
  Rows4,
  Search,
  SearchX,
  ShieldCheck,
  Tags,
  WandSparkles,
  X,
} from "lucide-react";
import { ExportButton, PrepareStemsButton, StemsBar } from "../stems/StemsUi";
import { useDeferredValue, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { PlaylistIcon } from "../../components/PlaylistIcon";
import { formatCount } from "../../lib/format";
import { formatKey, makeKey, type Notation } from "../../lib/keys";
import { useSettings, useUpdateSettings } from "../settings/api";
import { useViewStore } from "../navigation/viewStore";
import { AddToPlaylist } from "../playlists/AddToPlaylist";
import { playlistApi, usePlaylist, usePlaylistMutation } from "../playlists/api";
import { hasConditions } from "../playlists/filter";
import { SmartPlaylistDialog } from "../playlists/SmartPlaylistDialog";
import {
  cancelAnalysis,
  cancelImport,
  fetchAllIds,
  isNonEmpty,
  type ListParams,
  useLibraryTotal,
} from "./api";
import { useAnalysisStore } from "./analysisStore";
import { useImportStore } from "./importStore";
import { ActiveFilters, FiltersButton } from "./Filters";
import { JobBar } from "./JobBar";
import { useLibraryStore } from "./store";
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
    <label className="flex h-8 w-[180px] shrink-0 items-center gap-2 xl:w-[260px] rounded-sm border border-border bg-surface-3 pl-2.5 pr-2 text-text-3 focus-within:border-primary">
      <Search aria-hidden size={16} strokeWidth={1.5} />
      <input
        ref={inputRef}
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && setSearch("")}
        placeholder={t("library.search")}
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

// DESIGN 6.2: quick notation switch (8A / 1m / Am); flats are chosen in Settings.
const QUICK_NOTATIONS: readonly Notation[] = ["alphanumeric", "open_key", "classical"];
const SAMPLE_KEY = makeKey(9, "minor");

function NotationToggle() {
  const { t } = useTranslation();
  const { notation } = useSettings();
  const update = useUpdateSettings((error) => t("settings.saveFailed", { error }));
  const active = notation === "classical_flat" ? "classical" : notation;
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
          {formatKey(SAMPLE_KEY, n)}
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

export type LibraryScope = "all" | "review" | "playlist";

export function LibraryView({
  scope = "all",
  onAddMusic,
}: {
  scope?: LibraryScope;
  onAddMusic: () => void;
}) {
  const { t, i18n } = useTranslation();
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
    filter: filtering ? filter : null,
    search: deferredSearch || null,
    sort,
    descending,
    qualityIssues: scope === "review" ? true : null,
    playlistId: playlist?.id ?? null,
  };
  const title =
    scope === "review" ? t("nav.reviewQuality") : playlist ? playlist.name : t("library.title");
  const selected = useLibraryStore((s) => s.selected);
  const openTags = useViewStore((s) => s.openTags);
  const { total } = useLibraryTotal(params);
  const removeTracks = usePlaylistMutation(playlistApi.removeTracks);
  const [editingSmart, setEditingSmart] = useState(false);
  const reorderable =
    regular && sort === "position" && !descending && !deferredSearch && !filtering;

  return (
    <section className="relative flex min-h-0 flex-1 flex-col" aria-label={title}>
      <header
        data-tauri-drag-region
        className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-5"
      >
        <div className="flex min-w-0 flex-1 items-baseline gap-2.5" data-tauri-drag-region>
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
        <NotationToggle />
        <DensityToggle />
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
        <button
          type="button"
          onClick={onAddMusic}
          className="flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-sm bg-primary px-3 font-semibold text-white transition-colors duration-hover hover:bg-primary-hover"
        >
          <FolderPlus size={16} strokeWidth={1.5} />
          {t("library.addMusic")}
        </button>
      </header>
      <ActiveFilters />
      {/* Floating, so selecting a row never shifts the table under the pointer. */}
      {isNonEmpty(selected) && (
        <div
          role="toolbar"
          aria-label={t("library.selectionActions")}
          className="absolute bottom-4 left-1/2 z-20 flex h-11 -translate-x-1/2 items-center gap-2 rounded-md border border-border bg-surface-1 px-2 shadow-overlay"
        >
          {selected.length > 0 && (
            <button
              type="button"
              onClick={() => useLibraryStore.getState().setSelected([])}
              title={t("library.clearSelection")}
              className="flex h-8 items-center gap-1 whitespace-nowrap rounded-sm px-2 text-[12px] text-text-2 hover:bg-surface-2 hover:text-text"
            >
              {t("library.selected", { count: selected.length })}
              <X size={12} strokeWidth={1.5} />
            </button>
          )}
          {isNonEmpty(selected) && <AddToPlaylist trackIds={selected} />}
          <PrepareStemsButton trackIds={selected} />
          <ExportButton trackIds={selected} />
          {regular && isNonEmpty(selected) && (
            <button
              type="button"
              onClick={() =>
                removeTracks.mutate(
                  { playlistId: playlist.id, trackIds: selected },
                  { onSuccess: () => useLibraryStore.getState().setSelected([]) },
                )
              }
              className="flex h-8 items-center gap-1.5 whitespace-nowrap rounded-sm border border-border bg-surface-3 px-3 text-text transition-colors duration-hover hover:border-border-strong"
            >
              <ListMinus size={16} strokeWidth={1.5} />
              <span>{t("playlists.removeFrom")}</span>
            </button>
          )}
          {selected.length === 1 && (
            <button
              type="button"
              onClick={() =>
                selected[0] !== undefined && useViewStore.getState().openInfo(selected[0])
              }
              className="flex h-8 items-center gap-1.5 whitespace-nowrap rounded-sm border border-border bg-surface-3 px-3 text-text transition-colors duration-hover hover:border-border-strong"
            >
              <Pencil size={14} strokeWidth={1.5} />
              <span>{t("info.open")}</span>
            </button>
          )}
          {selected.length === 1 && (
            <button
              type="button"
              onClick={() =>
                selected[0] !== undefined && useViewStore.getState().openPro(selected[0])
              }
              className="flex h-8 items-center gap-1.5 whitespace-nowrap rounded-sm border border-border bg-surface-3 px-3 text-text transition-colors duration-hover hover:border-border-strong"
            >
              <Disc3 size={14} strokeWidth={1.5} className="text-accent" />
              <span>{t("pro.open")}</span>
            </button>
          )}
        </div>
      )}
      <ImportBar />
      <AnalysisBar />
      <StemsBar />
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
        />
      )}
      {editingSmart && playlist?.smart && (
        <SmartPlaylistDialog editing={playlist} onClose={() => setEditingSmart(false)} />
      )}
    </section>
  );
}
