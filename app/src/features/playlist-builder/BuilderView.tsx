// Set builder screen (SPEC 2.17, DESIGN 6.12). Left (360 px): origin (a playlist or the
// library selection), length (minutes or tracks), first track, energy curve and "Generate
// set". Right: target-versus-real energy chart and the set as a vertical timeline, each
// track joined to the previous one by its transition bar (green ✓ / amber ~ / red ✕).
// Tracks can be dragged (or moved with ↑/↓), replaced with an alternative or removed; each
// edit asks the engine to score the new order. Footer: mean score, key clashes, save as a
// playlist and export (Rekordbox / Traktor through the Export screen, or M3U).
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Artwork } from "../../components/Artwork";
import { trackKey } from "../../lib/keyStyle";
import { save } from "@tauri-apps/plugin-dialog";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ChevronDown,
  Compass,
  GripVertical,
  Loader2,
  Replace,
  TriangleAlert,
  Sparkles,
  X,
} from "lucide-react";
import { type PointerEvent, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { EnergyMeter } from "../../components/EnergyMeter";
import { KeyChip } from "../../components/KeyChip";
import { Popover } from "../../components/Popover";
import { Segmented } from "../../components/Segmented";
import { playlistLabel } from "../../lib/playlistIcons";
import { Switch } from "../../components/Switch";
import { fileStem, formatBpm, formatDuration, formatSemitones } from "../../lib/format";
import { makeKey, shift as shiftKey } from "../../lib/keys";
import { request } from "../../lib/rpc";
import type {
  BuilderAlternative,
  BuilderItem,
  BuilderPool,
  BuilderResult,
  BuilderTransition,
  PlaylistNode,
  TrackSummary,
} from "../../lib/rpc.types";
import { isNonEmpty, libraryKeys } from "../library/api";
import { useLibraryStore } from "../library/store";
import { useViewStore } from "../navigation/viewStore";
import { playlistApi, usePlaylistTree } from "../playlists/api";
import { useSettings } from "../settings/api";
import { useToastStore } from "../toast/toastStore";
import { builderApi } from "./api";
import { type BuilderSource, curveOf, useBuilderStore } from "./builderStore";
import { CurveEditor } from "./CurveEditor";
import { shortfall } from "./shortfall";
import { errorMessage } from "../../lib/errors";
import { EmptyState } from "../../components/EmptyState";

/** Height of a track row plus its transition bar, when the DOM cannot be measured. */
const ROW_PITCH = 96;
const M3U_FILTER = [{ name: "M3U", extensions: ["m3u8", "m3u"] }];

const BUTTON =
  "flex h-8 items-center gap-1.5 whitespace-nowrap rounded-sm border border-border bg-surface-3 px-3 text-text transition-colors duration-hover hover:border-border-strong disabled:opacity-40";
const ICON =
  "grid size-7 place-items-center rounded-sm text-text-3 hover:bg-surface-3 hover:text-text disabled:opacity-30";

const titleOf = (t: TrackSummary) => t.title ?? fileStem(t.path);
const keyOf = (t: TrackSummary) =>
  t.keyRoot != null && t.keyMode ? makeKey(t.keyRoot, t.keyMode) : null;

function poolOf(source: BuilderSource | null): BuilderPool {
  if (!source) return {};
  return source.kind === "playlist"
    ? { playlistId: source.playlistId }
    : { trackIds: source.trackIds };
}

/** Score an edited order and show it. */
function useRescore() {
  const { t } = useTranslation();
  return async (trackIds: number[]) => {
    const { preset, points, allowShift, result, setResult } = useBuilderStore.getState();
    if (!isNonEmpty(trackIds)) {
      setResult(null);
      return;
    }
    // Show the new order at once; the engine fills in the transitions.
    if (result) {
      const byId = new Map(result.items.map((it) => [it.track.id, it]));
      const items = trackIds.flatMap((id) => {
        const it = byId.get(id);
        return it ? [it] : [];
      });
      useBuilderStore.setState({ result: { ...result, items }, saved: null });
    }
    try {
      setResult(await builderApi.score({ trackIds, curve: curveOf(preset, points), allowShift }));
    } catch (err) {
      useToastStore.getState().push({
        title: t("builder.failed", { error: errorMessage(err) }),
        tone: "danger",
      });
    }
  };
}

// ---- configuration ----

/** A whole number typed freely: kept when valid, put back in range when leaving the field. */
function NumberField({
  value,
  min,
  max,
  label,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  label: string;
  onChange: (value: number) => void;
}) {
  const [text, setText] = useState(String(value));
  return (
    <input
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      value={text}
      aria-label={label}
      onChange={(e) => {
        setText(e.target.value);
        const n = Math.round(Number(e.target.value));
        if (e.target.value.trim() && n >= min && n <= max) onChange(n);
      }}
      onBlur={() => {
        const n = Math.round(Number(text));
        const fixed = Number.isFinite(n) && text.trim() ? Math.min(max, Math.max(min, n)) : value;
        setText(String(fixed));
        onChange(fixed);
      }}
      className="h-8 w-20 rounded-sm border border-border bg-surface-3 px-2 font-mono text-control text-text"
    />
  );
}

/** A playlist with the folders above it ("Bolos › Warm-up Ibiza"), to tell namesakes apart. */
function sourceLabel(p: PlaylistNode, tree: PlaylistNode[]): string {
  const path: string[] = [];
  let parent = tree.find((x) => x.id === p.parentId);
  while (parent) {
    path.unshift(parent.name);
    const above = parent.parentId;
    parent = tree.find((x) => x.id === above);
  }
  return [...path, playlistLabel(p)].join(" › ");
}

function ConfigPanel() {
  const { t } = useTranslation();
  const tree = usePlaylistTree();
  const selected = useLibraryStore((s) => s.selected);
  const s = useBuilderStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const playlists = tree.filter((p) => !p.isFolder);
  const value =
    s.source?.kind === "playlist"
      ? `playlist:${s.source.playlistId}`
      : s.source?.kind === "selection"
        ? "selection"
        : "";
  const pool = poolOf(s.source);
  const candidates = useQuery({
    queryKey: [...libraryKeys.all, "builder-pool", pool],
    enabled: s.source != null,
    queryFn: async () => {
      if (pool.playlistId != null)
        return (await request("library.list", { playlistId: pool.playlistId, limit: 5000 })).items;
      const ids = new Set(pool.trackIds ?? []);
      return (await request("library.list", { limit: 5000 })).items.filter((t) => ids.has(t.id));
    },
  });
  const startOptions = (candidates.data ?? []).filter((t) => t.keyRoot != null && t.bpm != null);

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      s.setResult(
        await builderApi.generate({
          pool,
          curve: curveOf(s.preset, s.points),
          ...(s.lengthMode === "count" ? { count: s.count } : { durationMin: s.durationMin }),
          ...(s.startTrackId != null ? { startTrackId: s.startTrackId } : {}),
          allowShift: s.allowShift,
        }),
        s.lengthMode === "count"
          ? { mode: "count", count: s.count }
          : { mode: "duration", minutes: s.durationMin },
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const field = "flex flex-col gap-1.5";
  const input =
    "h-8 rounded-sm border border-border bg-surface-3 px-2 text-control text-text disabled:opacity-40";
  return (
    <aside
      aria-label={t("builder.settings")}
      className="flex w-[360px] shrink-0 flex-col gap-5 overflow-auto border-r border-border p-5"
    >
      <label className={field}>
        <span className="text-label uppercase text-text-3">{t("builder.source")}</span>
        <select
          value={value}
          onChange={(e) => {
            const v = e.target.value;
            s.setSource(
              v === "selection"
                ? { kind: "selection", trackIds: selected }
                : v.startsWith("playlist:")
                  ? { kind: "playlist", playlistId: Number(v.slice(9)) }
                  : null,
            );
          }}
          className={input}
        >
          <option value="">{t("builder.pickSource")}</option>
          {selected.length > 1 && (
            <option value="selection">{t("builder.selection", { count: selected.length })}</option>
          )}
          {(
            [
              ["builder.sourcePlaylists", playlists.filter((p) => !p.smart)],
              ["builder.sourceSmart", playlists.filter((p) => p.smart)],
            ] as const
          ).map(
            ([label, group]) =>
              group.length > 0 && (
                <optgroup key={label} label={t(label)}>
                  {group.map((p) => (
                    <option key={p.id} value={`playlist:${p.id}`}>
                      {sourceLabel(p, tree)}
                    </option>
                  ))}
                </optgroup>
              ),
          )}
        </select>
      </label>

      <div className={field}>
        <span className="text-label uppercase text-text-3">{t("builder.length")}</span>
        <div className="flex items-center gap-2">
          <Segmented
            size="sm"
            value={s.lengthMode}
            options={[
              { value: "duration" as const, label: t("builder.byDuration") },
              { value: "count" as const, label: t("builder.byCount") },
            ]}
            onChange={s.setLengthMode}
            label={t("builder.length")}
          />
          {s.lengthMode === "duration" ? (
            <NumberField
              key="duration"
              value={s.durationMin}
              min={1}
              max={1440}
              label={t("builder.minutes")}
              onChange={s.setDuration}
            />
          ) : (
            <NumberField
              key="count"
              value={s.count}
              min={2}
              max={200}
              label={t("builder.tracks")}
              onChange={s.setCount}
            />
          )}
          <span className="text-[12px] text-text-3">
            {t(s.lengthMode === "duration" ? "builder.minutesUnit" : "builder.tracksUnit")}
          </span>
        </div>
      </div>

      <label className={field}>
        <span className="text-label uppercase text-text-3">{t("builder.start")}</span>
        <select
          value={s.startTrackId ?? ""}
          disabled={!s.source}
          onChange={(e) => s.setStart(e.target.value ? Number(e.target.value) : null)}
          className={input}
        >
          <option value="">{t("builder.anyStart")}</option>
          {startOptions.map((t) => (
            <option key={t.id} value={t.id}>
              {titleOf(t)}
            </option>
          ))}
        </select>
      </label>

      <div className={field}>
        <span className="text-label uppercase text-text-3">{t("builder.curve")}</span>
        <CurveEditor />
      </div>

      <Switch checked={s.allowShift} onChange={s.setAllowShift} label={t("builder.allowShift")} />

      {error && (
        <p role="alert" className="text-[12px] text-danger">
          {t("builder.failed", { error })}
        </p>
      )}
      <button
        type="button"
        disabled={!s.source || busy}
        onClick={() => void generate()}
        className="flex h-9 items-center justify-center gap-2 rounded-sm bg-primary font-semibold text-white hover:bg-primary-hover disabled:opacity-50"
      >
        {busy ? (
          <Loader2 aria-hidden size={16} strokeWidth={1.5} className="animate-spin" />
        ) : (
          <Sparkles aria-hidden size={16} strokeWidth={1.5} />
        )}
        {t("builder.generate")}
      </button>
    </aside>
  );
}

// ---- the set ----

const QUALITY_COLOR: Record<BuilderTransition["quality"], string> = {
  good: "var(--color-success)",
  fair: "var(--color-warning)",
  bad: "var(--color-danger)",
};
const QUALITY_ICON: Record<BuilderTransition["quality"], string> = {
  good: "✓",
  fair: "~",
  bad: "✕",
};

function TransitionBar({
  from,
  to,
  index,
  transition: tr,
}: {
  from: TrackSummary;
  to: TrackSummary;
  index: number;
  transition: BuilderTransition;
}) {
  const { t, i18n } = useTranslation();
  const settings = useSettings();
  const num = (v: number, digits = 2) =>
    new Intl.NumberFormat(i18n.language, {
      maximumFractionDigits: digits,
      minimumFractionDigits: digits,
    }).format(v);
  const signed = (v: number, digits: number) =>
    `${v > 0 ? "+" : v < 0 ? "−" : "±"}${num(Math.abs(v), digits)}`;
  const color = QUALITY_COLOR[tr.quality];
  const ka = keyOf(from);
  const kb = keyOf(to);
  const label = t("builder.transition", {
    from: index,
    to: index + 1,
    quality: t(`builder.quality.${tr.quality}`),
    score: num(tr.score),
  });
  return (
    <div
      role="group"
      aria-label={label}
      className="ml-[34px] flex flex-wrap items-center gap-x-3 gap-y-1 border-l-2 py-1.5 pl-4 text-[12px] text-text-2"
      style={{ borderColor: color }}
    >
      <span
        className="grid size-5 place-items-center rounded-pill font-semibold text-black"
        style={{ backgroundColor: color }}
      >
        {QUALITY_ICON[tr.quality]}
      </span>
      <span className="font-mono text-text">{num(tr.score)}</span>
      {ka && kb && (
        <span className="flex items-center gap-1">
          <KeyChip musicalKey={ka} notation={settings.notation} />
          <ArrowRight aria-hidden size={12} strokeWidth={1.5} className="text-text-3" />
          <KeyChip
            musicalKey={tr.shift ? shiftKey(kb, tr.shift) : kb}
            notation={settings.notation}
          />
          {tr.shift !== 0 && (
            <span className="font-mono">
              {t("pro.semitones", { value: formatSemitones(tr.shift) })}
            </span>
          )}
        </span>
      )}
      <span className="font-mono">{t("builder.bpmDelta", { value: signed(tr.bpmDelta, 1) })}</span>
      {tr.energyDelta != null && from.energy != null && to.energy != null && (
        <span className="font-mono">
          E{from.energy} → E{to.energy} {tr.energyDelta > 0 ? "↑" : tr.energyDelta < 0 ? "↓" : "="}
        </span>
      )}
      {tr.clash && (
        <span
          className="rounded-pill px-2 font-medium text-danger"
          style={{ backgroundColor: "color-mix(in srgb, var(--color-danger) 16%, transparent)" }}
        >
          {t("builder.clash")}
        </span>
      )}
    </div>
  );
}

function Alternatives({
  anchor,
  position,
  onClose,
  onPick,
}: {
  anchor: HTMLElement;
  position: number;
  onClose: () => void;
  onPick: (trackId: number) => void;
}) {
  const { t, i18n } = useTranslation();
  const s = useBuilderStore.getState();
  const trackIds = s.result?.items.map((it) => it.track.id) ?? [];
  const query = useQuery({
    queryKey: [
      "builder-alternatives",
      trackIds,
      position,
      s.preset,
      s.points,
      s.allowShift,
      s.source,
    ],
    queryFn: () =>
      builderApi.alternatives({
        trackIds: trackIds as [number, ...number[]],
        position,
        curve: curveOf(s.preset, s.points),
        allowShift: s.allowShift,
        pool: poolOf(s.source),
        limit: 8,
      }),
  });
  const num = new Intl.NumberFormat(i18n.language, {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    signDisplay: "always",
  });
  const describe = (a: BuilderAlternative) =>
    [a.into, a.out]
      .filter((x): x is BuilderTransition => x != null)
      .map((x) => QUALITY_ICON[x.quality])
      .join(" ");
  return (
    <Popover anchor={anchor} label={t("builder.alternatives")} onClose={onClose}>
      <div
        role="menu"
        aria-label={t("builder.alternatives")}
        className="-m-1.5 flex max-h-[360px] w-[320px] flex-col overflow-auto"
      >
        {query.isPending ? (
          <p className="p-2 text-[12px] text-text-3">{t("detail.loading")}</p>
        ) : !query.data?.length ? (
          <p className="p-2 text-[12px] text-text-3">{t("builder.noAlternatives")}</p>
        ) : (
          query.data.map((a) => (
            <button
              key={a.track.id}
              type="button"
              role="menuitem"
              onClick={() => onPick(a.track.id)}
              className="flex h-10 w-full items-center gap-2 rounded-sm px-2 text-left hover:bg-surface-3"
            >
              <span className="min-w-0 flex-1 truncate">{titleOf(a.track)}</span>
              <span aria-hidden className="font-mono text-[11px] text-text-3">
                {describe(a)}
              </span>
              <span
                className={`w-12 text-right font-mono text-[12px] ${a.delta >= 0 ? "text-success" : "text-text-3"}`}
              >
                {num.format(a.delta)}
              </span>
            </button>
          ))
        )}
      </div>
    </Popover>
  );
}

function EnergyChart({ items }: { items: BuilderItem[] }) {
  const { t } = useTranslation();
  const w = 600;
  const h = 90;
  // Positions in % so the dots stay round while the line stretches with the panel.
  const px = (i: number) => (items.length > 1 ? 2 + (i / (items.length - 1)) * 96 : 50);
  const py = (e: number) => 6 + (1 - (e - 1) / 9) * 88;
  const line = (values: (number | null)[]) =>
    values
      .map((e, i) => (e != null ? `${(px(i) / 100) * w},${(py(e) / 100) * h}` : null))
      .filter(Boolean)
      .join(" ");
  return (
    <figure className="flex flex-col gap-1">
      <div role="img" aria-label={t("builder.chart")} className="relative h-[90px] w-full">
        <svg
          viewBox={`0 0 ${w} ${h}`}
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full"
        >
          <polyline
            points={line(items.map((it) => it.targetEnergy))}
            fill="none"
            stroke="var(--color-text-3)"
            strokeWidth={1.5}
            strokeDasharray="5 4"
            vectorEffect="non-scaling-stroke"
          />
          <polyline
            points={line(items.map((it) => it.track.energy ?? null))}
            fill="none"
            stroke="var(--color-primary)"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        {items.map((it, i) =>
          it.track.energy != null ? (
            <span
              key={it.track.id}
              aria-hidden
              className="absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-pill"
              style={{
                left: `${px(i)}%`,
                top: `${py(it.track.energy)}%`,
                backgroundColor: `var(--color-energy-${it.track.energy})`,
              }}
            />
          ) : null,
        )}
      </div>
      <figcaption className="flex gap-4 text-[11px] text-text-3">
        <span>┄ {t("builder.target")}</span>
        <span className="text-primary-ink">— {t("builder.real")}</span>
      </figcaption>
    </figure>
  );
}

function SetRow({
  item,
  index,
  total,
  previous,
  dragOffset,
  onMove,
  onRemove,
  onReplace,
  onDragStart,
}: {
  item: BuilderItem;
  index: number;
  total: number;
  previous: TrackSummary | undefined;
  dragOffset: number;
  onMove: (to: number) => void;
  onRemove: () => void;
  onReplace: (anchor: HTMLElement) => void;
  onDragStart: (e: PointerEvent<HTMLButtonElement>) => void;
}) {
  const { t } = useTranslation();
  const settings = useSettings();
  const track = item.track;
  const key = keyOf(track);
  const title = titleOf(track);
  return (
    <li
      aria-label={`${index + 1}. ${title}`}
      data-row
      className="relative flex flex-col"
      style={dragOffset ? { transform: `translateY(${dragOffset}px)`, zIndex: 10 } : undefined}
    >
      {item.transition && previous && (
        <TransitionBar from={previous} to={track} index={index} transition={item.transition} />
      )}
      <div
        className={`group relative flex h-14 items-center gap-2 rounded-md border border-border bg-surface-2 px-2 @min-[44rem]:gap-3 ${dragOffset ? "shadow-lg" : ""}`}
      >
        <button
          type="button"
          aria-label={t("builder.drag")}
          onPointerDown={onDragStart}
          className="grid h-8 w-6 shrink-0 cursor-grab touch-none place-items-center text-text-3 active:cursor-grabbing"
        >
          <GripVertical aria-hidden size={14} strokeWidth={1.5} />
        </button>
        <span className="w-5 shrink-0 text-right font-mono text-[12px] text-text-3">
          {index + 1}
        </span>
        <Artwork
          path={track.artworkPath}
          musicalKey={trackKey(track)}
          size={36}
          className="size-9 rounded-sm"
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-control font-medium" title={title}>
            {title}
          </span>
          <span className="truncate text-[12px] text-text-2">
            {track.artist ?? t("library.unknownArtist")}
          </span>
        </div>
        {key && (
          <KeyChip musicalKey={key} notation={settings.notation} confidence={track.keyConfidence} />
        )}
        <span className="w-14 shrink-0 text-right font-mono text-data tabular">
          {formatBpm(track.bpm, settings.bpmDecimals)}
        </span>
        <span className="w-16 shrink-0">
          {track.energy != null && <EnergyMeter level={track.energy} />}
        </span>
        <span className="w-11 shrink-0 text-right font-mono text-[12px] text-text-3">
          {formatDuration(track.duration)}
        </span>
        {/* In a narrow set column the actions float over the row's end on hover or focus,
            so the title keeps its room; with space to spare they sit inline. */}
        <div className="absolute inset-y-0 right-0 flex items-center rounded-r-md bg-surface-2 px-2 opacity-0 transition-opacity duration-hover group-focus-within:opacity-100 group-hover:opacity-100 @min-[44rem]:static @min-[44rem]:bg-transparent @min-[44rem]:px-0 @min-[44rem]:opacity-60">
          <button
            type="button"
            aria-label={t("builder.up")}
            disabled={index === 0}
            onClick={() => onMove(index - 1)}
            className={ICON}
          >
            <ArrowUp aria-hidden size={14} strokeWidth={1.5} />
          </button>
          <button
            type="button"
            aria-label={t("builder.down")}
            disabled={index === total - 1}
            onClick={() => onMove(index + 1)}
            className={ICON}
          >
            <ArrowDown aria-hidden size={14} strokeWidth={1.5} />
          </button>
          <button
            type="button"
            aria-label={t("builder.replace")}
            title={t("builder.replace")}
            onClick={(e) => onReplace(e.currentTarget)}
            className={ICON}
          >
            <Replace aria-hidden size={14} strokeWidth={1.5} />
          </button>
          <button
            type="button"
            aria-label={t("builder.remove")}
            title={t("builder.remove")}
            onClick={onRemove}
            className={ICON}
          >
            <X aria-hidden size={14} strokeWidth={1.5} />
          </button>
        </div>
      </div>
    </li>
  );
}

function ExportMenu({ onSave }: { onSave: () => Promise<{ id: number; name: string } | null> }) {
  const { t } = useTranslation();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const push = useToastStore((s) => s.push);
  const toDj = async () => {
    setAnchor(null);
    const saved = await onSave();
    if (!saved) return;
    push({ title: t("builder.exportHint", { name: saved.name }), tone: "neutral" });
    useViewStore.getState().show("export");
  };
  const toM3u = async () => {
    setAnchor(null);
    const saved = await onSave();
    if (!saved) return;
    const path = await save({
      defaultPath: `${saved.name}.m3u8`,
      filters: M3U_FILTER,
      title: t("playlists.export"),
    });
    if (!path) return;
    try {
      const result = await playlistApi.exportM3u({ playlistId: saved.id, path });
      push({
        title: t("playlists.exported", { count: result.written }),
        detail: result.path,
        tone: "success",
      });
    } catch (err) {
      push({
        title: t("playlists.failed", { error: errorMessage(err) }),
        tone: "danger",
      });
    }
  };
  return (
    <>
      <button
        type="button"
        aria-haspopup="menu"
        aria-label={t("builder.exportSet")}
        onClick={(e) => setAnchor(e.currentTarget)}
        className={BUTTON}
      >
        {t("builder.export")}
        <ChevronDown aria-hidden size={14} strokeWidth={1.5} />
      </button>
      {anchor && (
        <Popover anchor={anchor} label={t("builder.export")} onClose={() => setAnchor(null)}>
          <div role="menu" className="-m-1.5 flex w-[200px] flex-col">
            {(["Rekordbox", "Traktor"] as const).map((name) => (
              <button
                key={name}
                type="button"
                role="menuitem"
                onClick={() => void toDj()}
                className="flex h-8 items-center rounded-sm px-2 text-left hover:bg-surface-3"
              >
                {name}
              </button>
            ))}
            <button
              type="button"
              role="menuitem"
              onClick={() => void toM3u()}
              className="flex h-8 items-center rounded-sm px-2 text-left hover:bg-surface-3"
            >
              {t("builder.m3u")}
            </button>
          </div>
        </Popover>
      )}
    </>
  );
}

function SetPanel({ result }: { result: BuilderResult }) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const rescore = useRescore();
  const push = useToastStore((s) => s.push);
  const items = result.items;
  const ids = items.map((it) => it.track.id);
  const short = shortfall(
    result,
    useBuilderStore((s) => s.requested),
  );
  const [replacing, setReplacing] = useState<{ anchor: HTMLElement; position: number } | null>(
    null,
  );
  const [drag, setDrag] = useState<{ index: number; startY: number; offset: number } | null>(null);
  const list = useRef<HTMLOListElement>(null);

  const move = (from: number, to: number) => {
    if (to < 0 || to >= ids.length || to === from) return;
    const next = [...ids];
    const [id] = next.splice(from, 1);
    next.splice(to, 0, id as number);
    void rescore(next);
  };
  /** Where a drag ends: the row whose middle is nearest (or a fixed pitch without layout). */
  const dropIndex = (index: number, clientY: number, offset: number) => {
    const rows = [...(list.current?.querySelectorAll<HTMLElement>("[data-row]") ?? [])];
    const rects = rows.map((r) => r.getBoundingClientRect());
    if (!rects.length || rects.every((r) => r.height === 0))
      return Math.max(0, Math.min(ids.length - 1, index + Math.round(offset / ROW_PITCH)));
    let best = index;
    let distance = Infinity;
    rects.forEach((r, i) => {
      const d = Math.abs(r.top + r.height / 2 - clientY);
      if (d < distance) [distance, best] = [d, i];
    });
    return best;
  };
  const startDrag = (index: number) => (e: PointerEvent<HTMLButtonElement>) => {
    const target = e.currentTarget;
    target.setPointerCapture?.(e.pointerId);
    const startY = e.clientY;
    setDrag({ index, startY, offset: 0 });
    const onMoveEvt = (ev: globalThis.PointerEvent) =>
      setDrag((d) => (d ? { ...d, offset: ev.clientY - d.startY } : d));
    const onUp = (ev: globalThis.PointerEvent) => {
      target.removeEventListener("pointermove", onMoveEvt);
      target.removeEventListener("pointerup", onUp);
      setDrag(null);
      move(index, dropIndex(index, ev.clientY, ev.clientY - startY));
    };
    target.addEventListener("pointermove", onMoveEvt);
    target.addEventListener("pointerup", onUp);
  };

  const saveAsPlaylist = async (): Promise<{ id: number; name: string } | null> => {
    const { saved } = useBuilderStore.getState();
    if (saved) return saved;
    const name = t("builder.playlistName", {
      date: new Intl.DateTimeFormat(i18n.language, {
        dateStyle: "short",
        timeStyle: "short",
      }).format(new Date()),
    });
    try {
      const node = await playlistApi.create({ name, emoji: "🧭" });
      if (isNonEmpty(ids)) await playlistApi.addTracks({ playlistId: node.id, trackIds: ids });
      useBuilderStore.getState().setSaved({ id: node.id, name: node.name });
      void qc.invalidateQueries({ queryKey: libraryKeys.all });
      push({
        title: t("builder.saved", { name: node.name }),
        tone: "success",
        action: {
          label: t("builder.openPlaylist"),
          run: () => useViewStore.getState().openPlaylist(node.id),
        },
      });
      return { id: node.id, name: node.name };
    } catch (err) {
      push({
        title: t("playlists.failed", { error: errorMessage(err) }),
        tone: "danger",
      });
      return null;
    }
  };

  const score = new Intl.NumberFormat(i18n.language, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(result.meanScore);
  return (
    <section aria-label={t("builder.setLabel")} className="flex min-w-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-border px-5 py-3">
        <EnergyChart items={items} />
      </div>
      {short && (
        <div
          role="status"
          className="mx-5 mt-4 flex items-start gap-2 rounded-md border border-warning/40 bg-surface-1 px-3 py-2.5 text-control"
        >
          <TriangleAlert
            aria-hidden
            size={16}
            strokeWidth={1.5}
            className="mt-0.5 shrink-0 text-warning"
          />
          <span>
            <span className="font-medium">
              {short.mode === "duration"
                ? t("builder.short.duration", { got: short.got, wanted: short.wanted })
                : t("builder.short.count", { got: short.got, wanted: short.wanted })}
            </span>{" "}
            <span className="text-text-2">
              {t("builder.short.why", { count: result.poolSize })}
              {result.skipped > 0 && ` ${t("builder.short.skipped", { count: result.skipped })}`}
            </span>
          </span>
        </div>
      )}
      <ol
        ref={list}
        aria-label={t("builder.set")}
        className="@container flex min-h-0 flex-1 flex-col gap-0 overflow-auto px-5 py-4"
      >
        {items.map((item, i) => (
          <SetRow
            key={item.track.id}
            item={item}
            index={i}
            total={items.length}
            previous={items[i - 1]?.track}
            dragOffset={drag?.index === i ? drag.offset : 0}
            onMove={(to) => move(i, to)}
            onRemove={() => void rescore(ids.filter((_, k) => k !== i))}
            onReplace={(anchor) => setReplacing({ anchor, position: i })}
            onDragStart={startDrag(i)}
          />
        ))}
      </ol>
      <footer className="flex shrink-0 items-center gap-3 border-t border-border px-5 py-3">
        <span className="min-w-0 flex-1 text-control text-text-2">
          {t("builder.summary", { score, count: result.clashes })}
          {" · "}
          {t("builder.totalDuration", { minutes: Math.round(result.duration / 60) })}
        </span>
        <button type="button" onClick={() => void saveAsPlaylist()} className={BUTTON}>
          {t("builder.save")}
        </button>
        <ExportMenu onSave={saveAsPlaylist} />
      </footer>
      {replacing && (
        <Alternatives
          anchor={replacing.anchor}
          position={replacing.position}
          onClose={() => setReplacing(null)}
          onPick={(trackId) => {
            const next = [...ids];
            next[replacing.position] = trackId;
            setReplacing(null);
            void rescore(next);
          }}
        />
      )}
    </section>
  );
}

export function BuilderView() {
  const { t } = useTranslation();
  const result = useBuilderStore((s) => s.result);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header
        data-tauri-drag-region
        className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-5"
      >
        <h1 className="font-display text-title">{t("builder.title")}</h1>
        {result && (
          <span className="text-text-3">
            {t("builder.fromPool", { count: result.items.length, pool: result.poolSize })}
          </span>
        )}
      </header>
      <div className="flex min-h-0 flex-1">
        <ConfigPanel />
        {result?.items.length ? (
          <SetPanel result={result} />
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <EmptyState
              icon={Compass}
              title={t("builder.emptyTitle")}
              text={t("builder.emptyHint")}
            />
          </div>
        )}
      </div>
    </div>
  );
}
