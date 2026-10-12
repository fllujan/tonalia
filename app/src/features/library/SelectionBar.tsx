// Floating toolbar of the library selection (DESIGN 6.2). The same actions show for one
// track or many, so the bar never reshuffles under the pointer: the common bulk actions
// stay visible (Tags, Reanalyse, Add to playlist, Build a set) and the rest live in
// "More"; an action that needs another count is disabled with the reason, not removed.
import {
  Compass,
  Disc3,
  Layers,
  ListMinus,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  Tags,
  Upload,
  X,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { Popover } from "../../components/Popover";
import { errorMessage } from "../../lib/errors";
import { useViewStore } from "../navigation/viewStore";
import { AddToPlaylist } from "../playlists/AddToPlaylist";
import { useBuilderStore } from "../playlist-builder/builderStore";
import { useSettings } from "../settings/api";
import { requestSeparation, useStemsStatus } from "../stems/api";
import { useStemsStore } from "../stems/stemsStore";
import { useToastStore } from "../toast/toastStore";
import { reanalyze } from "./api";
import { useLibraryStore } from "./store";

const BUTTON =
  "flex h-8 items-center gap-1.5 whitespace-nowrap rounded-sm border border-border bg-surface-3 px-3 text-text transition-colors duration-hover hover:border-border-strong disabled:opacity-40 disabled:hover:border-border";

interface SelectionBarProps {
  selected: [number, ...number[]];
  /** Tracks still to analyse have no results to write (the Analyse queue). */
  canWriteTags: boolean;
  /** "Remove from playlist", for a regular playlist. */
  onRemoveFromPlaylist?: (() => void) | undefined;
}

export function SelectionBar({ selected, canWriteTags, onRemoveFromPlaylist }: SelectionBarProps) {
  const { t } = useTranslation();
  const [more, setMore] = useState<HTMLElement | null>(null);
  const settings = useSettings();
  const stems = useStemsStatus().data;
  const separating = useStemsStore((s) => s.separation != null);
  const single = selected.length === 1 ? selected[0] : null;
  const report = (err: unknown) =>
    useToastStore
      .getState()
      .push({ title: t("analysis.failed", { error: errorMessage(err) }), tone: "danger" });

  const item = (
    icon: ReactNode,
    label: string,
    run: () => void,
    disabledReason: string | null = null,
  ) => (
    <button
      type="button"
      role="menuitem"
      disabled={disabledReason != null}
      title={disabledReason ?? undefined}
      onClick={() => {
        setMore(null);
        run();
      }}
      className="flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left text-text hover:bg-surface-3 disabled:opacity-40 disabled:hover:bg-transparent"
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  );

  return (
    <div
      role="toolbar"
      aria-label={t("library.selectionActions")}
      className="absolute bottom-4 left-1/2 z-20 flex h-11 -translate-x-1/2 items-center gap-2 rounded-md border border-border bg-surface-1 px-2 shadow-overlay"
    >
      <button
        type="button"
        onClick={() => useLibraryStore.getState().setSelected([])}
        title={t("library.clearSelection")}
        className="flex h-8 items-center gap-1 whitespace-nowrap rounded-sm px-2 text-[12px] text-text-2 hover:bg-surface-2 hover:text-text"
      >
        {t("library.selected", { count: selected.length })}
        <X size={12} strokeWidth={1.5} />
      </button>
      {canWriteTags && (
        <button
          type="button"
          onClick={() => useViewStore.getState().openTags(selected, "selection")}
          title={t("tags.forSelection")}
          className={BUTTON}
        >
          <Tags size={14} strokeWidth={1.5} />
          <span>{t("library.selection.tags")}</span>
        </button>
      )}
      <button
        type="button"
        onClick={() => void reanalyze(selected).catch(report)}
        className={BUTTON}
      >
        <RotateCcw size={14} strokeWidth={1.5} />
        <span>{t("library.selection.reanalyze")}</span>
      </button>
      <AddToPlaylist trackIds={selected} />
      <button
        type="button"
        disabled={single != null}
        title={single != null ? t("library.selection.buildSetNeedsTwo") : undefined}
        onClick={() => {
          useBuilderStore.getState().setSource({ kind: "selection", trackIds: selected });
          useViewStore.getState().show("builder");
        }}
        className={BUTTON}
      >
        <Compass size={14} strokeWidth={1.5} />
        <span>{t("library.buildSet")}</span>
      </button>
      <button
        type="button"
        aria-haspopup="menu"
        aria-label={t("library.selection.more")}
        title={t("library.selection.more")}
        onClick={(e) => setMore(e.currentTarget)}
        className="grid size-8 place-items-center rounded-sm border border-border bg-surface-3 text-text transition-colors duration-hover hover:border-border-strong"
      >
        <MoreHorizontal size={16} strokeWidth={1.5} />
      </button>
      {more && (
        <Popover anchor={more} label={t("library.selection.more")} onClose={() => setMore(null)}>
          <div role="menu" aria-label={t("library.selection.more")} className="flex w-56 flex-col">
            {item(
              <Pencil size={14} strokeWidth={1.5} className="text-text-3" />,
              t("info.open"),
              () => single != null && useViewStore.getState().openInfo(single),
              single == null ? t("library.selection.oneOnly") : null,
            )}
            {item(
              <Disc3 size={14} strokeWidth={1.5} className="text-accent" />,
              t("pro.open"),
              () => single != null && useViewStore.getState().openPro(single),
              single == null ? t("library.selection.oneOnly") : null,
            )}
            {item(
              <Layers size={14} strokeWidth={1.5} className="text-text-3" />,
              t("stems.prepare"),
              () => requestSeparation(selected, stems, settings.stemModel),
              separating ? t("library.selection.separating") : null,
            )}
            {item(
              <Upload size={14} strokeWidth={1.5} className="text-text-3" />,
              t("library.selection.exportStems"),
              () => useStemsStore.getState().openExport(selected),
            )}
            {onRemoveFromPlaylist &&
              item(
                <ListMinus size={14} strokeWidth={1.5} className="text-text-3" />,
                t("playlists.removeFrom"),
                onRemoveFromPlaylist,
              )}
          </div>
        </Popover>
      )}
    </div>
  );
}
