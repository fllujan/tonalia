import { Artwork } from "../../components/Artwork";
import { Popover } from "../../components/Popover";
import { SpectrogramView } from "../quality/Spectrogram";
import { trackKey } from "../../lib/keyStyle";
import { useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowDown,
  ArrowUp,
  Check,
  CheckCheck,
  Circle,
  Gauge,
  LoaderCircle,
  Pause,
  Play,
  RotateCcw,
  TriangleAlert,
} from "lucide-react";
import { Fragment, type ReactNode, useCallback, useRef, useState, useEffect } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { EnergyMeter } from "../../components/EnergyMeter";
import { KeyChip } from "../../components/KeyChip";
import { useViewStore } from "../navigation/viewStore";
import { EqualizerIcon } from "../player/EqualizerIcon";
import { togglePlayback, usePlayerStore } from "../player/playerStore";
import { beginDrag, dropTargetProps, useDragStore } from "../playlists/dragStore";
import {
  fileStem,
  formatBpm,
  formatCount,
  formatDate,
  formatDuration,
  signedDb,
} from "../../lib/format";
import { displayKey } from "../../lib/keys";
import type { TrackSummary } from "../../lib/rpc.types";
import { type AppSettings, useSettings } from "../settings/api";
import { isNonEmpty, type ListParams, reanalyze, useLibraryRows, useUpdateTrack } from "./api";
import { useToastStore } from "../toast/toastStore";
import { ROW_HEIGHT, type SortColumn, useLibraryStore } from "./store";
import { stageProgress, useAnalysisStore } from "./analysisStore";
import { BpmEditor, KeyEditor } from "./TrackEditors";
import {
  type Column,
  COLUMNS,
  gridTemplate,
  QUEUE_COLUMNS,
  REVIEW_COLUMNS,
  visibleColumns,
  withGain,
  withPlays,
} from "./columns";
import { StageSteps } from "../analysis/StageSteps";
import { markReviewed } from "./markReviewed";
import { pendingQuality } from "./quality";
import { describeFailure, errorMessage } from "../../lib/errors";

/** Analyse one failed track again; a refusal of the engine comes back as a toast. */
function retry(trackId: number, t: TFunction) {
  void reanalyze([trackId]).catch((err: unknown) =>
    useToastStore.getState().push({
      title: t("analysis.failed", { error: errorMessage(err) }),
      tone: "danger",
    }),
  );
}

function Placeholder() {
  return <span className="text-text-3">—</span>;
}

/** A 14 px ring filling clockwise with `value` (0–1), for a track being analysed. */
function ProgressRing({ value }: { value: number }) {
  const r = 5.5;
  const length = 2 * Math.PI * r;
  return (
    <svg aria-hidden width={14} height={14} viewBox="0 0 14 14" className="-rotate-90">
      <circle cx={7} cy={7} r={r} fill="none" strokeWidth={1.5} className="stroke-surface-3" />
      <circle
        cx={7}
        cy={7}
        r={r}
        fill="none"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeDasharray={length}
        strokeDashoffset={length * (1 - Math.max(0.04, value))}
        className="stroke-primary-ink transition-[stroke-dashoffset] duration-panel"
      />
    </svg>
  );
}

/**
 * What is wrong with a file, written out (Revisar calidad): one amber chip per quality
 * flag still to review, the bitrate next to "low bitrate", and what to do about it in each
 * chip's tooltip. Tonalia can't fix the audio, so the list is a to-do list: ✓ marks the
 * track as reviewed and it leaves the list (the toast undoes it).
 */
function ProblemChips({ track }: { track: TrackSummary }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const flags = pendingQuality(track);
  const [spectrum, setSpectrum] = useState<HTMLElement | null>(null);
  if (!flags.length) return <Placeholder />;
  const full = flags.map((f) => t(`quality.flags.${f}`)).join(" · ");
  const title = track.title ?? fileStem(track.path);
  return (
    <div className="flex min-w-0 items-center gap-1">
      <ul aria-label={full} className="flex min-w-0 flex-1 gap-1 overflow-hidden">
        {flags.map((f) => {
          const label = (
            <>
              {t(`quality.short.${f}`)}
              {f === "low_bitrate" && track.bitrate ? (
                <span className="font-mono">
                  {" · "}
                  {t("quality.chips.bitrate", { kbps: track.bitrate })}
                </span>
              ) : null}
            </>
          );
          const chip = "whitespace-nowrap rounded-sm px-1.5 text-[11px] leading-5 text-warning";
          const tint = {
            backgroundColor: "color-mix(in srgb, var(--color-warning) 14%, transparent)",
          };
          return (
            <li key={f} className="shrink-0">
              {/* Frequency problems open the spectrogram (SPEC 13.5). */}
              {f === "fake_hq" || f === "low_bitrate" ? (
                <button
                  type="button"
                  title={`${t(`quality.flags.${f}`)}: ${t(`quality.fix.${f}`)}`}
                  aria-label={t("spectrogram.open", { title })}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSpectrum(e.currentTarget);
                  }}
                  onDoubleClick={(e) => e.stopPropagation()}
                  className={`${chip} underline decoration-dotted underline-offset-2 hover:brightness-125`}
                  style={tint}
                >
                  {label}
                </button>
              ) : (
                <span
                  title={`${t(`quality.flags.${f}`)}: ${t(`quality.fix.${f}`)}`}
                  className={`${chip} block`}
                  style={tint}
                >
                  {label}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        aria-label={t("quality.markReviewedTrack", { title })}
        title={t("quality.markReviewed")}
        onClick={(e) => {
          e.stopPropagation();
          markReviewed([track.id], title, t, qc);
        }}
        onDoubleClick={(e) => e.stopPropagation()}
        className="grid size-6 shrink-0 place-items-center rounded-sm text-text-3 transition-colors duration-hover hover:bg-surface-3 hover:text-success"
      >
        <CheckCheck aria-hidden size={14} strokeWidth={1.5} />
      </button>
      {spectrum && (
        <Popover anchor={spectrum} label={t("spectrogram.title")} onClose={() => setSpectrum(null)}>
          <div
            className="flex w-[460px] flex-col gap-2 p-3"
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            <span className="truncate font-medium text-text">{title}</span>
            <SpectrogramView trackId={track.id} height={112} />
          </div>
        </Popover>
      )}
    </div>
  );
}

function StatusCell({ track: row, wide = false }: { track: TrackSummary; wide?: boolean }) {
  const { t, i18n } = useTranslation();
  // A stale "analyzing" row (no job running) reads as pending: the engine puts such
  // tracks back to pending when it starts.
  const running = useAnalysisStore((s) => s.jobId !== null);
  const track: TrackSummary =
    row.status === "analyzing" && !running ? { ...row, status: "pending" } : row;
  const stage = useAnalysisStore((s) =>
    track.status === "analyzing" ? s.stages[track.id] : undefined,
  );
  const progress = stage ? stageProgress(stage) : 0;
  const percent = new Intl.NumberFormat(i18n.language, { style: "percent" }).format(progress);
  // Reviewed problems no longer count: the track reads as plainly analysed.
  const issues = track.status === "ready" ? pendingQuality(track) : [];
  const label = issues.length
    ? `${t("library.status.ready")} · ${issues.map((f) => t(`quality.flags.${f}`)).join(" · ")}`
    : stage
      ? t("library.analyzingStage", {
          stage: t(`library.stages.${stage}`),
          percent,
        })
      : t(`library.status.${track.status}`);
  let content: ReactNode;
  switch (track.status) {
    case "ready":
      content = issues.length ? (
        // A gauge, not the ⚠ of a low-confidence key: analysed, with a quality issue.
        <Gauge size={16} strokeWidth={1.5} className="text-warning" />
      ) : (
        <Check size={16} strokeWidth={1.5} className="text-success" />
      );
      break;
    case "analyzing":
      content = stage ? (
        <span className="flex items-center gap-1">
          <ProgressRing value={progress} />
          <span className="whitespace-nowrap font-mono text-[11px] tabular text-text-2">
            {percent}
          </span>
        </span>
      ) : (
        <LoaderCircle
          size={16}
          strokeWidth={1.5}
          className="text-primary-ink motion-safe:animate-spin"
        />
      );
      break;
    case "error": {
      // A failed track says why and retries where it shows (SPEC 3: a broken file never
      // blocks the queue; the DJ can try again after fixing it).
      const title = track.title ?? fileStem(track.path);
      const reason = track.error ? describeFailure(track) : label;
      return (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            retry(track.id, t);
          }}
          onDoubleClick={(e) => e.stopPropagation()}
          aria-label={t("analysis.retryTrack", { title })}
          title={`${reason} · ${t("analysis.clickToRetry")}`}
          className="group/retry -mx-1 flex h-7 min-w-0 max-w-full items-center gap-1 rounded-sm px-1 text-control text-danger transition-colors duration-hover hover:bg-surface-3"
        >
          <TriangleAlert
            size={16}
            strokeWidth={1.5}
            className="shrink-0 group-hover/retry:hidden"
          />
          <RotateCcw
            size={16}
            strokeWidth={1.5}
            className="hidden shrink-0 group-hover/retry:block"
          />
          {/* The reason sits under the title, where it has room; the wide Analyse cell
              says what the button does. */}
          <span className="truncate">{wide ? t("analysis.retry") : label}</span>
        </button>
      );
    }
    default:
      content = <Circle size={14} strokeWidth={1.5} className="text-text-3" />;
  }
  return (
    <span role="img" className="flex items-center" title={label} aria-label={label}>
      {content}
    </span>
  );
}

type EditField = "key" | "bpm";

interface Editing {
  track: TrackSummary;
  field: EditField;
  anchor: HTMLElement;
}

/**
 * The "#" cell (DESIGN 6.2 and 5.5): the row number, a play button on hover, and for the
 * loaded track the equalizer plus a 2 px violet bar along the row's left edge.
 */
function PlayCell({ track, index, title }: { track: TrackSummary; index: number; title: string }) {
  const { t } = useTranslation();
  const loaded = usePlayerStore((s) => s.track?.id === track.id);
  const playing = usePlayerStore((s) => s.track?.id === track.id && s.playing);
  return (
    <>
      {loaded && <span aria-hidden className="absolute inset-y-0 left-0 w-0.5 bg-primary" />}
      <button
        type="button"
        aria-label={t(playing ? "player.pauseTrack" : "player.playTrack", { title })}
        onClick={() => togglePlayback(track)}
        className="peer col-start-1 row-start-1 grid size-6 place-items-center rounded-pill text-text opacity-0 transition-opacity duration-hover hover:bg-surface-3 focus-visible:opacity-100 group-hover:opacity-100"
      >
        {playing ? (
          <Pause size={14} strokeWidth={1.5} fill="currentColor" />
        ) : (
          <Play size={14} strokeWidth={1.5} fill="currentColor" />
        )}
      </button>
      <span className="col-start-1 row-start-1 transition-opacity duration-hover pointer-events-none group-hover:opacity-0 peer-focus-visible:opacity-0">
        {loaded ? (
          <EqualizerIcon playing={playing} />
        ) : (
          <span className="font-mono text-[11px] text-text-3">{index + 1}</span>
        )}
      </span>
    </>
  );
}

const CELL_BUTTON =
  "-mx-1 flex h-7 min-w-6 items-center rounded-sm px-1 text-left transition-colors duration-hover hover:bg-surface-3";

function Row({
  track,
  index,
  comfortable,
  settings,
  columns,
  onEdit,
  queue,
}: {
  track: TrackSummary;
  index: number;
  comfortable: boolean;
  settings: AppSettings;
  columns: Column[];
  queue: boolean;
  onEdit: (track: TrackSummary, field: EditField, anchor: HTMLElement) => void;
}) {
  const { t, i18n } = useTranslation();
  const key = trackKey(track);
  const edited = new Set(track.editedFields ?? []);
  const keyText = key ? displayKey(key, settings.notation) : t("edit.none");
  const bpmText = track.bpm == null ? t("edit.none") : formatBpm(track.bpm, settings.bpmDecimals);
  const title = track.title ?? fileStem(track.path);
  const artist = track.artist ?? t("library.unknownArtist");
  // Every list says why a track failed under its title (the Analyse view in full width).
  const failure =
    track.status === "error"
      ? track.error
        ? describeFailure(track)
        : t("library.status.error")
      : null;
  const cells: Record<string, ReactNode> = {
    number: (
      <div role="gridcell" className="grid place-items-center">
        <PlayCell track={track} index={index} title={title} />
      </div>
    ),
    cover: (
      <div role="gridcell">
        <Artwork
          path={track.artworkPath}
          musicalKey={trackKey(track)}
          size={28}
          lazy
          className="size-7 rounded-[4px]"
        />
      </div>
    ),
    title: (
      <div
        role="gridcell"
        className={`flex min-w-0 ${comfortable ? "flex-col" : "items-baseline gap-2"}`}
      >
        <span className="truncate font-medium leading-[18px]" title={title}>
          {title}
        </span>
        {failure ? (
          <FailureReason trackId={track.id} title={title} reason={failure} />
        ) : (
          <span className="truncate text-[12px] leading-4 text-text-2" title={artist}>
            {artist}
          </span>
        )}
      </div>
    ),
    key: (
      <div role="gridcell" className="min-w-0">
        <button
          type="button"
          aria-label={t("edit.keyLabel", { value: keyText })}
          onClick={(e) => onEdit(track, "key", e.currentTarget)}
          className={CELL_BUTTON}
        >
          {key ? (
            <KeyChip
              musicalKey={key}
              notation={settings.notation}
              confidence={track.keyConfidence}
              edited={edited.has("key")}
            />
          ) : (
            <Placeholder />
          )}
        </button>
      </div>
    ),
    bpm: (
      <div role="gridcell" className="min-w-0">
        <button
          type="button"
          aria-label={t("edit.bpmLabel", { value: bpmText })}
          title={edited.has("bpm") ? t("key.edited") : undefined}
          onClick={(e) => onEdit(track, "bpm", e.currentTarget)}
          className={`${CELL_BUTTON} font-mono font-medium tabular`}
        >
          {track.bpm == null ? <Placeholder /> : bpmText}
          {edited.has("bpm") && <span aria-hidden className="ml-1 size-1 rounded-pill bg-text-3" />}
        </button>
      </div>
    ),
    energy: (
      <div role="gridcell">
        {track.energy == null ? <Placeholder /> : <EnergyMeter level={track.energy} />}
      </div>
    ),
    // The count and a dot per cue in its colour (DESIGN 6.2), like the flags on the wave.
    cues: (
      <span
        role="gridcell"
        className="flex min-w-0 items-center gap-1.5 font-mono text-[12px] text-text-2"
      >
        {track.cueCount || <Placeholder />}
        {track.cueDots && track.cueDots.length > 0 && (
          <span aria-hidden data-testid="cue-dots" className="flex gap-0.5">
            {track.cueDots.map((d) => (
              <span
                key={d.slot}
                className="size-1 rounded-pill"
                style={{ backgroundColor: d.color ?? `var(--color-cue-${d.slot + 1})` }}
              />
            ))}
          </span>
        )}
      </span>
    ),
    genre: (
      <span role="gridcell" className="truncate text-text-2" title={track.genre ?? undefined}>
        {track.genre ?? <Placeholder />}
      </span>
    ),
    duration: (
      <span role="gridcell" className="font-mono text-[12px] text-text-2 tabular">
        {formatDuration(track.duration)}
      </span>
    ),
    status: (
      <div role="gridcell" className="min-w-0">
        {queue && track.status !== "error" ? (
          <StageSteps track={track} />
        ) : (
          <StatusCell track={track} wide={queue} />
        )}
      </div>
    ),
    problems: (
      <div role="gridcell" className="min-w-0">
        <ProblemChips track={track} />
      </div>
    ),
    plays: (
      <span role="gridcell" className="font-mono text-[12px] text-text-2 tabular">
        {track.timesPlayed ? formatCount(track.timesPlayed, i18n.language) : <Placeholder />}
      </span>
    ),
    gain: (
      <span role="gridcell" className="font-mono text-[12px] text-text-2 tabular">
        {track.replaygainDb != null ? signedDb(track.replaygainDb, i18n.language) : <Placeholder />}
      </span>
    ),
    lastPlayed: (
      <span role="gridcell" className="text-[12px] text-text-2">
        {track.lastPlayed ? formatDate(track.lastPlayed, i18n.language) : <Placeholder />}
      </span>
    ),
    added: (
      <span role="gridcell" className="text-[12px] text-text-3">
        {formatDate(track.addedAt, i18n.language)}
      </span>
    ),
  };
  return (
    <>
      {columns.map((column) => (
        <Fragment key={column.id}>{cells[column.id]}</Fragment>
      ))}
    </>
  );
}

export function TrackTable({
  params,
  total,
  onSort,
  positionSort = false,
  reorderable = false,
  queue = false,
  review = false,
  showPlays = false,
}: {
  params: ListParams;
  total: number;
  onSort: (column: SortColumn) => void;
  /** The "#" column sorts by playlist position (regular playlists). */
  positionSort?: boolean;
  /** The Analyse view: wide status with each track's stages (DESIGN 6.4). */
  queue?: boolean;
  /** Revisar calidad: a problem column instead of the status icon. */
  review?: boolean;
  /** Rows can be dragged to new positions (playlist in its own order, unfiltered). */
  reorderable?: boolean;
  /** "Times played" and "Last played" (SPEC 13.4): once some track has been played. */
  showPlays?: boolean;
}) {
  const { t } = useTranslation();
  const density = useLibraryStore((s) => s.density);
  const sort = params.sort ?? "added_at";
  const descending = params.descending ?? true;
  const dragging = useDragStore((s) => s.payload);
  const dropRow = useDragStore((s) =>
    s.payload?.kind === "tracks" && s.target?.kind === "row" ? s.target.index : null,
  );
  const settings = useSettings();
  const update = useUpdateTrack();
  const [editing, setEditing] = useState<Editing | null>(null);
  const onEdit = useCallback(
    (track: TrackSummary, field: EditField, anchor: HTMLElement) =>
      setEditing({ track, field, anchor }),
    [],
  );
  const closeEditor = useCallback(() => setEditing(null), []);
  const openDetail = useViewStore((s) => s.openDetail);
  const selected = useLibraryStore((s) => s.selected);
  const setSelected = useLibraryStore((s) => s.setSelected);
  const selectedSet = new Set(selected);
  const anchor = useRef<number | null>(null);
  const select = (index: number, id: number, e: React.MouseEvent) => {
    if (e.shiftKey && anchor.current !== null) {
      const [from, to] = [Math.min(anchor.current, index), Math.max(anchor.current, index)];
      const range: number[] = [];
      for (let i = from; i <= to; i++) {
        const row = getRow(i);
        if (row) range.push(row.id);
      }
      setSelected([...new Set([...selected, ...range])]);
    } else if (e.metaKey || e.ctrlKey) {
      setSelected(selectedSet.has(id) ? selected.filter((x) => x !== id) : [...selected, id]);
      anchor.current = index;
    } else {
      setSelected([id]);
      anchor.current = index;
    }
  };
  const scrollRef = useRef<HTMLDivElement>(null);
  const rowHeight = ROW_HEIGHT[density];
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const base = queue ? QUEUE_COLUMNS : review ? REVIEW_COLUMNS : COLUMNS;
  const gainColumn = useLibraryStore((s) => s.gainColumn);
  const withHistory = showPlays && !queue ? withPlays(base) : base;
  const columns = visibleColumns(width, gainColumn && !queue ? withGain(withHistory) : withHistory);
  const grid = gridTemplate(columns);

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual is not memoizable.
  const virtualizer = useVirtualizer({
    count: total,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 12,
    initialRect: { width: 1200, height: 800 },
  });
  const items = virtualizer.getVirtualItems();
  const getRow = useLibraryRows(params, items[0]?.index ?? 0, items[items.length - 1]?.index ?? 0);

  // Keyboard (SPEC 3): one tab stop for the rows; arrows move it and select like a file
  // list (Shift extends), Home/End jump, Enter opens the detail, Escape clears.
  const [focusIndex, setFocusIndex] = useState(0);
  const pendingFocus = useRef<number | null>(null);
  const tabStop = Math.min(focusIndex, Math.max(0, total - 1));
  useEffect(() => {
    const index = pendingFocus.current;
    if (index == null) return;
    const row = scrollRef.current?.querySelector<HTMLElement>(`[aria-rowindex="${index + 1}"]`);
    if (row) {
      pendingFocus.current = null;
      row.focus();
    }
  });
  const moveTo = (index: number, extend: boolean) => {
    const next = Math.max(0, Math.min(total - 1, index));
    setFocusIndex(next);
    pendingFocus.current = next;
    virtualizer.scrollToIndex(next);
    const row = getRow(next);
    if (!row) return;
    if (extend && anchor.current !== null) {
      const [from, to] = [Math.min(anchor.current, next), Math.max(anchor.current, next)];
      const range: number[] = [];
      for (let i = from; i <= to; i++) {
        const r = getRow(i);
        if (r) range.push(r.id);
      }
      setSelected(range);
    } else {
      setSelected([row.id]);
      anchor.current = next;
    }
  };
  const page = Math.max(1, Math.floor((scrollRef.current?.clientHeight ?? 400) / rowHeight) - 1);

  return (
    <div
      ref={scrollRef}
      role="grid"
      aria-label={t("library.tableLabel")}
      aria-multiselectable
      aria-rowcount={total}
      // A click on empty space (below the rows) clears the selection and keeps the focus
      // here, so Escape still has somewhere to land.
      tabIndex={-1}
      onMouseDown={(e) => {
        const target = e.target as HTMLElement;
        if (target === e.currentTarget || target.dataset.rows !== undefined) {
          setSelected([]);
          e.currentTarget.focus({ preventScroll: true });
        }
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && e.target === e.currentTarget) setSelected([]);
      }}
      className="min-h-0 flex-1 overflow-auto outline-none"
    >
      <div
        role="row"
        className="sticky top-0 z-10 grid h-8 items-center gap-3 border-b border-border bg-bg px-5"
        style={{ gridTemplateColumns: grid }}
      >
        {columns.map((column) => {
          const col: Column =
            column.id === "number" && positionSort ? { ...column, sort: "position" } : column;
          const label = col.label ? t(`library.columns.${col.label}`) : "";
          if (!col.sort) {
            return (
              <span key={col.id} role="columnheader" className="text-label uppercase text-text-3">
                {label}
              </span>
            );
          }
          const active = sort === col.sort;
          const Arrow = descending ? ArrowDown : ArrowUp;
          return (
            <div
              key={col.id}
              role="columnheader"
              aria-sort={active ? (descending ? "descending" : "ascending") : "none"}
              className="min-w-0"
            >
              <button
                type="button"
                title={t("library.sortBy", { column: label })}
                onClick={() => onSort(col.sort as SortColumn)}
                className={`flex h-6 min-w-0 items-center gap-1 whitespace-nowrap text-left text-label uppercase transition-colors duration-hover hover:text-text ${active ? "text-text" : "text-text-3"}`}
              >
                {label}
                {active && <Arrow aria-hidden size={12} strokeWidth={1.5} />}
              </button>
            </div>
          );
        })}
      </div>

      <div data-rows="" className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {items.map((item) => {
          const track = getRow(item.index);
          return (
            <div
              key={item.key}
              role="row"
              aria-rowindex={item.index + 1}
              tabIndex={track && item.index === tabStop ? 0 : -1}
              onFocus={(e) => {
                if (e.target === e.currentTarget) setFocusIndex(item.index);
              }}
              aria-selected={track ? selectedSet.has(track.id) : undefined}
              onClick={(e) => {
                if (track && !(e.target as HTMLElement).closest("button"))
                  select(item.index, track.id, e);
              }}
              onMouseDown={(e) => {
                // ⇧-click extends the selection and a double click opens the track: neither
                // should also select the rows' text. Keep the focus the browser would give.
                if ((e.shiftKey || e.detail > 1) && !(e.target as HTMLElement).closest("input")) {
                  e.preventDefault();
                  e.currentTarget.focus({ preventScroll: true });
                }
              }}
              onPointerDown={(e) => {
                if (!track || (e.target as HTMLElement).closest("button, input")) return;
                beginDrag(e, () => {
                  const current = useLibraryStore.getState().selected;
                  const ids: [number, ...number[]] =
                    isNonEmpty(current) && current.includes(track.id) ? current : [track.id];
                  if (ids.length === 1) setSelected(ids);
                  return {
                    kind: "tracks",
                    trackIds: ids,
                    label:
                      ids.length === 1
                        ? (track.title ?? fileStem(track.path))
                        : t("playlists.dragTracks", { count: ids.length }),
                  };
                });
              }}
              {...dropTargetProps(reorderable && dragging?.kind === "tracks", (e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const after = rect.height > 0 && e.clientY - rect.top > rect.height / 2;
                return { kind: "row", index: item.index + (after ? 1 : 0) };
              })}
              title={track ? t("library.openHint") : undefined}
              onDoubleClick={(e) => {
                if (track && !(e.target as HTMLElement).closest("button")) openDetail(track.id);
              }}
              onKeyDown={(e) => {
                if (e.target !== e.currentTarget) return;
                const moves: Record<string, number> = {
                  ArrowDown: item.index + 1,
                  ArrowUp: item.index - 1,
                  PageDown: item.index + page,
                  PageUp: item.index - page,
                  Home: 0,
                  End: total - 1,
                };
                const to = moves[e.key];
                if (to !== undefined) {
                  e.preventDefault();
                  moveTo(to, e.shiftKey);
                } else if (track && e.key === "Enter") openDetail(track.id);
                else if (track && e.key === " ") {
                  e.preventDefault();
                  togglePlayback(track);
                } else if (e.key === "Escape") setSelected([]);
              }}
              data-drop={
                dropRow === item.index ? "before" : dropRow === item.index + 1 ? "after" : undefined
              }
              className={`group absolute left-0 grid w-full items-center gap-3 border-b border-border px-5 outline-none ${dropRow === item.index ? "shadow-[inset_0_2px_0_var(--color-primary)]" : ""} ${dropRow === item.index + 1 ? "shadow-[inset_0_-2px_0_var(--color-primary)]" : ""} transition-colors duration-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary ${track && selectedSet.has(track.id) ? "bg-primary-row" : "hover:bg-surface-2"}`}
              style={{
                gridTemplateColumns: grid,
                height: rowHeight,
                transform: `translateY(${item.start}px)`,
              }}
            >
              {track ? (
                <Row
                  track={track}
                  index={item.index}
                  comfortable={density === "comfortable"}
                  settings={settings}
                  columns={columns}
                  onEdit={onEdit}
                  queue={queue}
                />
              ) : (
                <div role="gridcell" className="col-span-full">
                  <div className="h-2 w-1/3 rounded-pill bg-surface-2" aria-hidden />
                </div>
              )}
            </div>
          );
        })}
      </div>
      {editing?.field === "key" && (
        <KeyEditor
          anchor={editing.anchor}
          current={trackKey(editing.track)}
          notation={settings.notation}
          onClose={closeEditor}
          onSave={(key) => {
            update.mutate({ trackId: editing.track.id, key });
            closeEditor();
          }}
        />
      )}
      {editing?.field === "bpm" && (
        <BpmEditor
          anchor={editing.anchor}
          current={editing.track.bpm}
          onClose={closeEditor}
          onSave={(bpm) => {
            update.mutate({ trackId: editing.track.id, bpm });
            closeEditor();
          }}
        />
      )}
    </div>
  );
}

/** Why a track failed, under its title. The row is one line high, so the whole reason
 * opens in a popover (by mouse or keyboard) instead of living only in a tooltip. */
function FailureReason({
  trackId,
  title,
  reason,
}: {
  trackId: number;
  title: string;
  reason: string;
}) {
  const { t } = useTranslation();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-label={t("analysis.showReason", { title })}
        title={reason}
        onClick={(e) => {
          e.stopPropagation();
          setAnchor(e.currentTarget);
        }}
        onDoubleClick={(e) => e.stopPropagation()}
        className="min-w-0 truncate text-left text-[12px] leading-4 text-danger underline decoration-dotted underline-offset-2 hover:decoration-solid"
      >
        {reason}
      </button>
      {anchor && (
        <Popover anchor={anchor} label={t("analysis.reasonTitle")} onClose={() => setAnchor(null)}>
          <div className="flex max-w-[360px] flex-col gap-1.5">
            <span className="text-label uppercase text-text-3">{t("analysis.reasonTitle")}</span>
            <p className="select-text text-control text-text">{reason}</p>
            <button
              type="button"
              onClick={() => {
                setAnchor(null);
                retry(trackId, t);
              }}
              className="mt-1 flex h-8 items-center gap-1.5 self-start rounded-sm border border-border bg-surface-3 px-3 text-control hover:border-border-strong"
            >
              <RotateCcw aria-hidden size={16} strokeWidth={1.5} />
              {t("analysis.retry")}
            </button>
          </div>
        </Popover>
      )}
    </>
  );
}
