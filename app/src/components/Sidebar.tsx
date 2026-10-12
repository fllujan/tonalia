import { SegmentThumb } from "./SegmentThumb";
import {
  BookOpen,
  Compass,
  FileOutput,
  Keyboard,
  type LucideIcon,
  Music,
  Settings,
  Star,
  TriangleAlert,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { EngineStatus } from "../features/engine/useEngineStatus";
import { useFavorites } from "../features/favorites/api";
import { useLibraryTotal } from "../features/library/api";
import { useViewStore } from "../features/navigation/viewStore";
import { useShortcutsDialog } from "../features/shortcuts/shortcuts";
import { PlaylistSections } from "../features/playlists/PlaylistSections";
import { formatCount } from "../lib/format";
import { Logo } from "./brand/Logo";

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

// DESIGN.md 6 — 240 px sidebar. Sections appear as their features land.
export function Sidebar({ trackCount, engineStatus }: SidebarProps) {
  const { t, i18n } = useTranslation();
  const view = useViewStore((s) => s.view);
  const show = useViewStore((s) => s.show);
  const review = useLibraryTotal(REVIEW_QUALITY);
  const favorites = useFavorites().data?.length ?? 0;
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
          {(["library", "pro"] as const).map((space) => {
            const active = space === "pro" ? view === "pro" : view !== "pro";
            return (
              <button
                key={space}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => !active && show(space)}
                className={`flex h-8 items-center justify-center gap-1.5 rounded-[5px] text-control font-medium transition-colors duration-hover ${active ? "bg-surface-3 text-text" : "text-text-3 hover:text-text"}`}
              >
                {t(space === "pro" ? "nav.pro" : "nav.library")}
                {space === "pro" && (
                  <span aria-hidden className="size-1.5 rounded-pill bg-accent" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      <nav className="min-h-0 flex-1 overflow-auto px-2 pb-3" aria-label={t("nav.library")}>
        <div className="px-2 pb-1 pt-2.5 text-label uppercase text-text-3">{t("nav.library")}</div>
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
          aria-current={view === "review" ? "page" : undefined}
          onClick={() => show("review")}
          className={item(view === "review")}
        >
          <NavIcon icon={TriangleAlert} active={view === "review"} />
          <span className="min-w-0 flex-1 truncate">{t("nav.reviewQuality")}</span>
          <span className="font-mono text-[11px] text-text-3 tabular">
            {formatCount(review.total, i18n.language)}
          </span>
        </button>
        <PlaylistSections />
        <div className="px-2 pb-1 pt-4 text-label uppercase text-text-3">{t("nav.proSection")}</div>
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
      </nav>

      <div className="flex flex-col gap-2 border-t border-border p-3">
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
