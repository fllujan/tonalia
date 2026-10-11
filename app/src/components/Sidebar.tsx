import { useTranslation } from "react-i18next";
import type { EngineStatus } from "../features/engine/useEngineStatus";
import { LANGUAGES, type Language } from "../i18n";
import { formatCount } from "../lib/format";
import { THEMES, type Theme } from "../lib/theme";
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
  onRetryEngine: () => void;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
}

// DESIGN.md 6 — 240 px sidebar. Sections appear as their features land.
export function Sidebar({
  trackCount,
  engineStatus,
  onRetryEngine,
  theme,
  onThemeChange,
}: SidebarProps) {
  const { t, i18n } = useTranslation();
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

      <nav className="min-h-0 flex-1 overflow-auto px-2 pb-3" aria-label={t("nav.library")}>
        <div className="px-2 pb-1 pt-2.5 text-label uppercase text-text-3">{t("nav.library")}</div>
        <button
          type="button"
          aria-current="page"
          className="flex h-[30px] w-full items-center gap-2.5 rounded-sm bg-primary-soft px-2 text-left text-text"
        >
          <span aria-hidden className="w-[18px] text-center text-[14px] leading-none">
            🎵
          </span>
          <span className="min-w-0 flex-1 truncate">{t("nav.allTracks")}</span>
          <span className="font-mono text-[11px] text-text-3 tabular">
            {formatCount(trackCount, i18n.language)}
          </span>
        </button>
      </nav>

      <div className="flex flex-col gap-2 border-t border-border p-3">
        <div className="flex gap-2">
          <select
            aria-label={t("theme.label")}
            value={theme}
            onChange={(e) => onThemeChange(e.target.value as Theme)}
            className="h-7 min-w-0 flex-1 rounded-sm border border-border bg-surface-3 px-1.5 text-control text-text"
          >
            {THEMES.map((th) => (
              <option key={th} value={th}>
                {t(`theme.${th}`)}
              </option>
            ))}
          </select>
          <select
            aria-label={t("language.label")}
            value={i18n.language}
            onChange={(e) => void i18n.changeLanguage(e.target.value as Language)}
            className="h-7 min-w-0 flex-1 rounded-sm border border-border bg-surface-3 px-1.5 text-control text-text"
          >
            {LANGUAGES.map((lng) => (
              <option key={lng} value={lng}>
                {t(`language.${lng}`)}
              </option>
            ))}
          </select>
        </div>
        <div
          role="status"
          aria-live="polite"
          className="flex items-center gap-2 px-1 text-[12px] text-text-2"
        >
          <span aria-hidden className={`size-2 rounded-pill ${DOT[engineStatus]}`} />
          <span className="truncate">{engineLabel}</span>
          {engineStatus === "disconnected" && (
            <button
              type="button"
              onClick={onRetryEngine}
              className="ml-auto text-primary hover:text-primary-hover"
            >
              {t("engine.retry")}
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}
