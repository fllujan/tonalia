import { useState } from "react";
import { useTranslation } from "react-i18next";
import { LogoMark } from "./components/brand/Logo";
import { EngineStatusBadge } from "./features/engine/EngineStatusBadge";
import { useEngineStatus } from "./features/engine/useEngineStatus";
import { LANGUAGES, type Language } from "./i18n";
import { loadTheme, saveTheme, THEMES, type Theme } from "./lib/theme";

export default function App() {
  const { t, i18n } = useTranslation();
  const { status, retry } = useEngineStatus();
  const [theme, setTheme] = useState<Theme>(loadTheme);

  const changeTheme = (next: Theme) => {
    setTheme(next);
    saveTheme(next);
  };

  return (
    <main className="relative flex h-full flex-col items-center justify-center gap-6 overflow-hidden bg-bg">
      <div
        aria-hidden
        className="pointer-events-none absolute size-[480px] rounded-pill bg-aurora opacity-20 blur-3xl"
      />
      <div className="relative flex flex-col items-center gap-4">
        <LogoMark size={96} spinning />
        <h1 className="font-display text-display">{t("app.name")}</h1>
        <p className="text-section font-normal text-text-2">{t("app.tagline")}</p>
        <EngineStatusBadge status={status} onRetry={retry} />
      </div>

      <div className="relative flex gap-4 text-control text-text-2">
        <label className="flex items-center gap-2">
          {t("theme.label")}
          <select
            value={theme}
            onChange={(e) => changeTheme(e.target.value as Theme)}
            className="rounded-sm border border-border bg-surface-3 px-2 py-1 text-text"
          >
            {THEMES.map((th) => (
              <option key={th} value={th}>
                {t(`theme.${th}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          {t("language.label")}
          <select
            value={i18n.language}
            onChange={(e) => void i18n.changeLanguage(e.target.value as Language)}
            className="rounded-sm border border-border bg-surface-3 px-2 py-1 text-text"
          >
            {LANGUAGES.map((lng) => (
              <option key={lng} value={lng}>
                {t(`language.${lng}`)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <p className="absolute bottom-6 text-label uppercase text-text-3">{t("footer")}</p>
    </main>
  );
}
