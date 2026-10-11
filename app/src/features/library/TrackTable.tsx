import { useVirtualizer } from "@tanstack/react-virtual";
import { convertFileSrc } from "@tauri-apps/api/core";
import { ArrowDown, ArrowUp, Check, Circle, LoaderCircle, TriangleAlert } from "lucide-react";
import { type ReactNode, useRef } from "react";
import { useTranslation } from "react-i18next";
import { fileStem, formatBpm, formatDate, formatDuration } from "../../lib/format";
import type { TrackSummary } from "../../lib/rpc.types";
import { type ListParams, useLibraryRows } from "./api";
import { ROW_HEIGHT, type SortColumn, useLibraryStore } from "./store";

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
  const label = t(`library.status.${track.status}`);
  let content: ReactNode;
  switch (track.status) {
    case "ready":
      content = <Check size={16} strokeWidth={1.5} className="text-success" />;
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
      title={track.status === "error" && track.error ? track.error : label}
      aria-label={label}
    >
      {content}
    </span>
  );
}

function Row({
  track,
  index,
  comfortable,
}: {
  track: TrackSummary;
  index: number;
  comfortable: boolean;
}) {
  const { t, i18n } = useTranslation();
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
      <div>
        <Placeholder />
      </div>
      <span className="font-mono font-medium tabular">
        {track.bpm == null ? <Placeholder /> : formatBpm(track.bpm)}
      </span>
      <div>
        {track.energy == null ? <Placeholder /> : <span className="font-mono">{track.energy}</span>}
      </div>
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

export function TrackTable({ params, total }: { params: ListParams; total: number }) {
  const { t } = useTranslation();
  const { sort, descending, density, toggleSort } = useLibraryStore();
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
        {COLUMNS.map((col) => {
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
              onClick={() => toggleSort(col.sort as SortColumn)}
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
              className="absolute left-0 grid w-full items-center gap-3 border-b border-border px-5 transition-colors duration-hover hover:bg-surface-2"
              style={{
                gridTemplateColumns: GRID,
                height: rowHeight,
                transform: `translateY(${item.start}px)`,
              }}
            >
              {track ? (
                <Row track={track} index={item.index} comfortable={density === "comfortable"} />
              ) : (
                <div className="col-span-full h-2 w-1/3 rounded-pill bg-surface-2" aria-hidden />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
