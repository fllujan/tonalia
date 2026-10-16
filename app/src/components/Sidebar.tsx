import { SegmentThumb } from "./SegmentThumb";
import {
  BookOpen,
  Compass,
  CopyCheck,
  FileInput,
  FileOutput,
  Gauge,
  Hourglass,
  Keyboard,
  Music,
  Settings,
  Star,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { EngineStatus } from "../features/engine/useEngineStatus";
import { useDuplicates } from "../features/duplicates/api";
import { useFavorites } from "../features/favorites/api";
import { type ListParams, QUEUE_STATUSES, useLibraryTotal } from "../features/library/api";
import { type View, useViewStore } from "../features/navigation/viewStore";
import { useShortcutsDialog } from "../features/shortcuts/shortcuts";
import { PlaylistSections } from "../features/playlists/PlaylistSections";
import { formatCount } from "../lib/format";
import { Logo } from "./brand/Logo";
import { ScrollArea } from "./ScrollArea";

const DOT: Record<EngineStatus, string> = {
  connecting: "bg-text-3",
  connected:
    "bg-success shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-success)_18%,transparent)]",
  restarting: "bg-warning",
  disconnected: "bg-danger",
};

interface SidebarProps {
  trackCount: number;
  engineStatus: EngineStatus;
}

const QUEUE: ListParams = {
  search: null,
  sort: "added_at",
  descending: true,
  filter: { statuses: [...QUEUE_STATUSES] },
};

const REVIEW_QUALITY = {
  search: null,
  sort: "added_at",
  descending: true,
  qualityIssues: true,
} as const;

/** Sidebar icon: muted, brighter on hover, primary when its view is open. */
function NavIcon({ icon: Icon, active }: { icon: LucideIcon; active: boolean }) {
  return (
    <span
      aria-hidden
      className={`grid w-[18px] shrink-0 place-items-center transition-colors duration-hover ${active ? "text-primary-ink" : "text-text-3 group-hover:text-text-2"}`}
    >
      <Icon size={17} strokeWidth={1.5} />
    </span>
  );
}

const PRO_VIEWS = new Set<View>(["pro", "favorites", "builder"]);
/** Views of neither workspace: opening them leaves the Library | Pro switch as it was. */
const SHARED_VIEWS = new Set<View>(["import", "export", "guides", "settings"]);

// DESIGN.md 6 — 240 px sidebar. Sections appear as their features land.
export function Sidebar({ trackCount, engineStatus }: SidebarProps) {
  const { t, i18n } = useTranslation();
  const view = useViewStore((s) => s.view);
  const show = useViewStore((s) => s.show);
  const review = useLibraryTotal(REVIEW_QUALITY);
  const duplicates = useDuplicates().data?.groups.length ?? 0;
  const queue = useLibraryTotal(QUEUE);
  const favorites = useFavorites().data?.length ?? 0;
  const [space, setSpace] = useState<"library" | "pro">(PRO_VIEWS.has(view) ? "pro" : "library");
  if (!SHARED_VIEWS.has(view)) {
    const current = PRO_VIEWS.has(view) ? "pro" : "library";
    if (current !== space) setSpace(current);
  }
  // In a short window the active item can sit below the fold (a playlist): bring it
  // into view whenever the view changes.
  const nav = useRef<HTMLElement>(null);
  useEffect(() => {
    nav.current
      ?.querySelector<HTMLElement>("[aria-current=page]")
      ?.scrollIntoView?.({ block: "nearest" });
  }, [view]);
  const item = (active: boolean) =>
    `group flex h-[30px] w-full items-center gap-2 rounded-sm px-2 text-left transition-colors duration-hover ${active ? "bg-primary-soft text-text" : "text-text-2 hover:bg-surface-2 hover:text-text"}`;
  const engineLabel =
    engineStatus === "connected"
      ? t("engine.ready")
      : `${t("engine.label")}: ${t(`engine.status.${engineStatus}`)}`;

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-surface-1">
      {/* Space for the macOS traffic lights (overlay title bar) and window dragging. */}
      <div data-tauri-drag-region className="h-10 shrink-0" />
      <div className="px-4 pb-4 pt-1">
        <Logo />
      </div>
      {/* DESIGN 6: big Library | Pro switch; Pro carries a coral dot. */}
      <div className="px-3 pb-3">
        <div
          role="radiogroup"
          aria-label={t("nav.workspace")}
          className="relative grid grid-cols-2 gap-0.5 rounded-[7px] border border-border bg-bg p-0.5"
        >
          <SegmentThumb />
          {(["library", "pro"] as const).map((option) => {
            // Favourites and the set builder live under PRO in the sidebar, so the
            // switch says Pro there too; clicking it opens the decks. Export, Guides and
            // Settings belong to both, so they leave the switch where it was.
            const active = option === space;
            return (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => view !== option && show(option)}
                className={`flex h-8 items-center justify-center gap-1.5 rounded-[5px] text-control font-medium transition-colors duration-hover ${active ? "bg-surface-3 text-text" : "text-text-3 hover:text-text"}`}
              >
                {t(option === "pro" ? "nav.pro" : "nav.library")}
                {option === "pro" && (
                  <span aria-hidden className="size-1.5 rounded-pill bg-accent" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      <nav ref={nav} className="flex min-h-0 flex-1 flex-col" aria-label={t("nav.library")}>
        <ScrollArea frameClassName="flex-1" className="min-h-0 flex-1 overflow-auto px-2 pb-3">
          <div className="px-2 pb-1 pt-2.5 text-label uppercase text-text-3">
            {t("nav.library")}
          </div>
          <button
            type="button"
            aria-current={view === "library" ? "page" : undefined}
            onClick={() => show("library")}
            className={item(view === "library")}
          >
            <NavIcon icon={Music} active={view === "library"} />
            <span className="min-w-0 flex-1 truncate">{t("nav.allTracks")}</span>
            <span className="font-mono text-[11px] text-text-3 tabular">
              {formatCount(trackCount, i18n.language)}
            </span>
          </button>
          <button
            type="button"
            aria-current={view === "queue" ? "page" : undefined}
            onClick={() => show("queue")}
            className={item(view === "queue")}
          >
            <NavIcon icon={Hourglass} active={view === "queue"} />
            <span className="min-w-0 flex-1 truncate">{t("nav.analyze")}</span>
            <span className="font-mono text-[11px] text-text-3 tabular">
              {formatCount(queue.total, i18n.language)}
            </span>
          </button>
          <button
            type="button"
            aria-current={view === "review" ? "page" : undefined}
            onClick={() => show("review")}
            className={item(view === "review")}
          >
            <NavIcon icon={Gauge} active={view === "review"} />
            <span className="min-w-0 flex-1 truncate">{t("nav.reviewQuality")}</span>
            <span className="font-mono text-[11px] text-text-3 tabular">
              {formatCount(review.total, i18n.language)}
            </span>
          </button>
          <button
            type="button"
            aria-current={view === "duplicates" ? "page" : undefined}
            onClick={() => show("duplicates")}
            className={item(view === "duplicates")}
          >
            <NavIcon icon={CopyCheck} active={view === "duplicates"} />
            <span className="min-w-0 flex-1 truncate">{t("nav.duplicates")}</span>
            <span className="font-mono text-[11px] text-text-3 tabular">
              {formatCount(duplicates, i18n.language)}
            </span>
          </button>
          {/* PRO goes before the playlists: they grow without limit and would push it
              below the fold of a short window. */}
          <div className="px-2 pb-1 pt-4 text-label uppercase text-text-3">
            {t("nav.proSection")}
          </div>
          <button
            type="button"
            aria-current={view === "favorites" ? "page" : undefined}
            onClick={() => show("favorites")}
            className={item(view === "favorites")}
          >
            <NavIcon icon={Star} active={view === "favorites"} />
            <span className="min-w-0 flex-1 truncate">{t("nav.favorites")}</span>
            <span className="font-mono text-[11px] text-text-3 tabular">
              {formatCount(favorites, i18n.language)}
            </span>
          </button>
          <button
            type="button"
            aria-current={view === "builder" ? "page" : undefined}
            onClick={() => show("builder")}
            className={item(view === "builder")}
          >
            <NavIcon icon={Compass} active={view === "builder"} />
            <span className="min-w-0 flex-1 truncate">{t("nav.builder")}</span>
          </button>
          <PlaylistSections />
        </ScrollArea>
      </nav>

      <div className="flex flex-col gap-2 border-t border-border p-3">
        <button
          type="button"
          aria-current={view === "import" ? "page" : undefined}
          onClick={() => show("import")}
          className={item(view === "import")}
        >
          <NavIcon icon={FileInput} active={view === "import"} />
          <span className="min-w-0 flex-1 truncate">{t("nav.import")}</span>
        </button>
        <button
          type="button"
          aria-current={view === "export" ? "page" : undefined}
          onClick={() => show("export")}
          className={item(view === "export")}
        >
          <NavIcon icon={FileOutput} active={view === "export"} />
          <span className="min-w-0 flex-1 truncate">{t("nav.export")}</span>
        </button>
        <button
          type="button"
          aria-current={view === "guides" ? "page" : undefined}
          onClick={() => show("guides")}
          className={item(view === "guides")}
        >
          <NavIcon icon={BookOpen} active={view === "guides"} />
          <span className="min-w-0 flex-1 truncate">{t("nav.guides")}</span>
        </button>
        <button
          type="button"
          aria-haspopup="dialog"
          onClick={() => useShortcutsDialog.getState().setOpen(true)}
          className={item(false)}
        >
          <NavIcon icon={Keyboard} active={false} />
          <span className="min-w-0 flex-1 truncate">{t("shortcuts.open")}</span>
          <kbd className="font-mono text-[11px] text-text-3">?</kbd>
        </button>
        <button
          type="button"
          aria-current={view === "settings" ? "page" : undefined}
          onClick={() => show("settings")}
          className={item(view === "settings")}
        >
          <NavIcon icon={Settings} active={view === "settings"} />
          <span className="min-w-0 flex-1 truncate">{t("nav.settings")}</span>
        </button>
        <div
          role="status"
          aria-live="polite"
          className="flex items-center gap-2 px-1 text-[12px] text-text-2"
        >
          <span aria-hidden className={`size-2 rounded-pill ${DOT[engineStatus]}`} />
          <span className="truncate">{engineLabel}</span>
        </div>
      </div>
    </aside>
  );
}
