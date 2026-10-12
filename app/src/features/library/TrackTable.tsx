import { useVirtualizer } from "@tanstack/react-virtual";
import { convertFileSrc } from "@tauri-apps/api/core";
import { ArrowDown, ArrowUp, Check, Circle, LoaderCircle, TriangleAlert } from "lucide-react";
import { type ReactNode, useCallback, useRef, useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { EnergyMeter } from "../../components/EnergyMeter";
import { KeyChip } from "../../components/KeyChip";
import { useViewStore } from "../navigation/viewStore";
import { beginDrag, dropTargetProps, useDragStore } from "../playlists/dragStore";
import { fileStem, formatBpm, formatDate, formatDuration } from "../../lib/format";
import { formatKey, type Key, makeKey } from "../../lib/keys";
import type { TrackSummary } from "../../lib/rpc.types";
import { type AppSettings, useSettings } from "../settings/api";
import { isNonEmpty, type ListParams, useLibraryRows, useUpdateTrack } from "./api";
import { ROW_HEIGHT, type SortColumn, useLibraryStore } from "./store";
import { BpmEditor, KeyEditor } from "./TrackEditors";
import { describeMessage } from "../../lib/errors";

// Column grid from the design export (DESIGN.md 6.2).
const GRID = "36px 28px minmax(0,1fr) 84px 64px 92px 80px 112px 64px 64px 84px";

interface Column {
  id: string;
  label: string;
  sort?: SortColumn;
  align?: "end";
}

const COLUMNS: Column[] = [
  { id: "number", label: "number" },
  { id: "cover", label: "" },
  { id: "title", label: "title", sort: "title" },
  { id: "key", label: "key", sort: "key" },
  { id: "bpm", label: "bpm", sort: "bpm" },
  { id: "energy", label: "energy", sort: "energy" },
  { id: "cues", label: "cues" },
  { id: "genre", label: "genre", sort: "genre" },
  { id: "duration", label: "duration", sort: "duration" },
  { id: "status", label: "status", sort: "status" },
  { id: "added", label: "added", sort: "added_at" },
];

function Placeholder() {
  return <span className="text-text-3">—</span>;
}

function Cover({ path }: { path: string | null }) {
  if (!path) return <div aria-hidden className="size-7 rounded-[4px] bg-surface-3" />;
  return (
    <img
      alt=""
      src={convertFileSrc(path)}
      loading="lazy"
      className="size-7 rounded-[4px] bg-surface-3 object-cover"
    />
  );
}

function StatusCell({ track }: { track: TrackSummary }) {
  const { t } = useTranslation();
  const issues = track.status === "ready" ? (track.qualityFlags ?? []) : [];
  const label = issues.length
    ? `${t("library.status.ready")} · ${issues.map((f) => t(`quality.flags.${f}`)).join(" · ")}`
    : t(`library.status.${track.status}`);
  let content: ReactNode;
  switch (track.status) {
    case "ready":
      content = issues.length ? (
        <TriangleAlert size={16} strokeWidth={1.5} className="text-warning" />
      ) : (
        <Check size={16} strokeWidth={1.5} className="text-success" />
      );
      break;
    case "analyzing":
      content = (
        <LoaderCircle
          size={16}
          strokeWidth={1.5}
          className="text-primary motion-safe:animate-spin"
        />
      );
      break;
    case "error":
      content = (
        <span className="flex items-center gap-1 text-control text-danger">
          <TriangleAlert size={16} strokeWidth={1.5} />
          {label}
        </span>
      );
      break;
    default:
      content = <Circle size={14} strokeWidth={1.5} className="text-text-3" />;
  }
  return (
    <span
      className="flex items-center"
      title={track.status === "error" && track.error ? describeMessage(track.error) : label}
      aria-label={label}
    >
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

function trackKey(track: TrackSummary): Key | null {
  return track.keyRoot == null || track.keyMode == null
    ? null
    : makeKey(track.keyRoot, track.keyMode);
}

const CELL_BUTTON =
  "-mx-1 flex h-7 min-w-0 items-center rounded-sm px-1 text-left transition-colors duration-hover hover:bg-surface-3";

function Row({
  track,
  index,
  comfortable,
  settings,
  onEdit,
}: {
  track: TrackSummary;
  index: number;
  comfortable: boolean;
  settings: AppSettings;
  onEdit: (track: TrackSummary, field: EditField, anchor: HTMLElement) => void;
}) {
  const { t, i18n } = useTranslation();
  const key = trackKey(track);
  const edited = new Set(track.editedFields ?? []);
  const keyText = key ? formatKey(key, settings.notation) : t("edit.none");
  const bpmText = track.bpm == null ? t("edit.none") : formatBpm(track.bpm, settings.bpmDecimals);
  const title = track.title ?? fileStem(track.path);
  const artist = track.artist ?? t("library.unknownArtist");
  return (
    <>
      <span className="text-center font-mono text-[11px] text-text-3 tabular">{index + 1}</span>
      <Cover path={track.artworkPath} />
      <div className={`flex min-w-0 ${comfortable ? "flex-col" : "items-baseline gap-2"}`}>
        <span className="truncate font-medium leading-[18px]" title={title}>
          {title}
        </span>
        <span className="truncate text-[12px] leading-4 text-text-2" title={artist}>
          {artist}
        </span>
      </div>
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
      <div>{track.energy == null ? <Placeholder /> : <EnergyMeter level={track.energy} />}</div>
      <span className="font-mono text-[12px] text-text-2">{track.cueCount || <Placeholder />}</span>
      <span className="truncate text-text-2" title={track.genre ?? undefined}>
        {track.genre ?? <Placeholder />}
      </span>
      <span className="font-mono text-[12px] text-text-2 tabular">
        {formatDuration(track.duration)}
      </span>
      <StatusCell track={track} />
      <span className="text-[12px] text-text-3">{formatDate(track.addedAt, i18n.language)}</span>
    </>
  );
}

export function TrackTable({
  params,
  total,
  onSort,
  positionSort = false,
  reorderable = false,
}: {
  params: ListParams;
  total: number;
  onSort: (column: SortColumn) => void;
  /** The "#" column sorts by playlist position (regular playlists). */
  positionSort?: boolean;
  /** Rows can be dragged to new positions (playlist in its own order, unfiltered). */
  reorderable?: boolean;
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
      role="table"
      aria-rowcount={total}
      className="min-h-0 flex-1 overflow-auto"
    >
      <div
        role="row"
        className="sticky top-0 z-10 grid h-8 items-center gap-3 border-b border-border bg-bg px-5"
        style={{ gridTemplateColumns: GRID }}
      >
        {COLUMNS.map((column) => {
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
            <button
              key={col.id}
              type="button"
              role="columnheader"
              aria-sort={active ? (descending ? "descending" : "ascending") : "none"}
              title={t("library.sortBy", { column: label })}
              onClick={() => onSort(col.sort as SortColumn)}
              className={`flex min-w-0 items-center gap-1 whitespace-nowrap text-left text-label uppercase transition-colors duration-hover hover:text-text ${active ? "text-text" : "text-text-3"}`}
            >
              {label}
              {active && <Arrow aria-hidden size={12} strokeWidth={1.5} />}
            </button>
          );
        })}
      </div>

      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
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
                else if (e.key === "Escape") setSelected([]);
              }}
              data-drop={
                dropRow === item.index ? "before" : dropRow === item.index + 1 ? "after" : undefined
              }
              className={`absolute left-0 grid w-full items-center gap-3 border-b border-border px-5 outline-none ${dropRow === item.index ? "shadow-[inset_0_2px_0_var(--color-primary)]" : ""} ${dropRow === item.index + 1 ? "shadow-[inset_0_-2px_0_var(--color-primary)]" : ""} transition-colors duration-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary ${track && selectedSet.has(track.id) ? "bg-primary-soft" : "hover:bg-surface-2"}`}
              style={{
                gridTemplateColumns: GRID,
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
                  onEdit={onEdit}
                />
              ) : (
                <div className="col-span-full h-2 w-1/3 rounded-pill bg-surface-2" aria-hidden />
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
