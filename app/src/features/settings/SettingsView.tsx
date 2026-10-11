import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { KeyChip } from "../../components/KeyChip";
import { LANGUAGES, type Language } from "../../i18n";
import { formatBpm } from "../../lib/format";
import { makeKey, NOTATIONS, type Notation } from "../../lib/keys";
import { THEMES, type Theme } from "../../lib/theme";
import { useSettings, useUpdateSettings } from "./api";
import { WatchedFolders } from "./WatchedFolders";

const SECTIONS = ["general", "analysis", "watched"] as const;
type Section = (typeof SECTIONS)[number];

// Am and F# major show how every notation writes minor/major and sharps/flats.
const PREVIEW_KEYS = [makeKey(9, "minor"), makeKey(6, "major")];
const DECIMALS = [0, 1, 2] as const;
const CUE_COUNTS = [0, 1, 2, 3, 4, 5, 6, 7, 8] as const;

interface ChoiceProps<T extends string | number> {
  label: string;
  value: T;
  options: readonly T[];
  onChange: (value: T) => void;
  render: (option: T) => ReactNode;
}

/** Radio cards: keyboard and screen-reader friendly (native radios). */
function Choice<T extends string | number>({
  label,
  value,
  options,
  onChange,
  render,
}: ChoiceProps<T>) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-section">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <label
            key={option}
            className={`flex min-w-[150px] cursor-pointer flex-col gap-1.5 rounded-md border p-3 transition-colors duration-hover focus-within:ring-2 focus-within:ring-primary ${option === value ? "border-primary bg-primary-soft" : "border-border bg-surface-2 hover:border-border-strong"}`}
          >
            <input
              type="radio"
              name={label}
              checked={option === value}
              onChange={() => onChange(option)}
              className="sr-only"
            />
            {render(option)}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

interface SettingsViewProps {
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
}

// DESIGN 6.13 — sections appear as their features land.
export function SettingsView({ theme, onThemeChange }: SettingsViewProps) {
  const { t, i18n } = useTranslation();
  const [section, setSection] = useState<Section>("analysis");
  const settings = useSettings();
  const update = useUpdateSettings((error) => t("settings.saveFailed", { error }));

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label={t("settings.title")}>
      <header
        data-tauri-drag-region
        className="flex h-14 shrink-0 items-center border-b border-border px-5"
      >
        <h1 className="font-display text-title">{t("settings.title")}</h1>
      </header>
      <div className="flex min-h-0 flex-1">
        <nav aria-label={t("settings.title")} className="flex w-48 shrink-0 flex-col gap-0.5 p-3">
          {SECTIONS.map((s) => (
            <button
              key={s}
              type="button"
              aria-current={section === s ? "page" : undefined}
              onClick={() => setSection(s)}
              className={`h-[30px] rounded-sm px-2 text-left transition-colors duration-hover ${section === s ? "bg-primary-soft text-text" : "text-text-2 hover:bg-surface-2 hover:text-text"}`}
            >
              {t(`settings.sections.${s}`)}
            </button>
          ))}
        </nav>
        <div className="min-w-0 flex-1 overflow-auto px-8 py-6">
          {section === "general" ? (
            <div className="flex max-w-[720px] flex-col gap-8">
              <Choice<Theme>
                label={t("theme.label")}
                value={theme}
                options={THEMES}
                onChange={onThemeChange}
                render={(th) => <span>{t(`theme.${th}`)}</span>}
              />
              <Choice<Language>
                label={t("language.label")}
                value={
                  (LANGUAGES as readonly string[]).includes(i18n.language)
                    ? (i18n.language as Language)
                    : "es"
                }
                options={LANGUAGES}
                onChange={(lng) => void i18n.changeLanguage(lng)}
                render={(lng) => <span>{t(`language.${lng}`)}</span>}
              />
            </div>
          ) : section === "watched" ? (
            <WatchedFolders />
          ) : (
            <div className="flex max-w-[720px] flex-col gap-8">
              <Choice<Notation>
                label={t("settings.notation")}
                value={settings.notation}
                options={NOTATIONS}
                onChange={(notation) => update.mutate({ notation })}
                render={(n) => (
                  <>
                    <span className="font-medium">{t(`settings.notations.${n}`)}</span>
                    <span className="flex gap-1.5">
                      {PREVIEW_KEYS.map((k) => (
                        <KeyChip key={`${k.root}${k.mode}`} musicalKey={k} notation={n} />
                      ))}
                    </span>
                  </>
                )}
              />
              <Choice<(typeof DECIMALS)[number]>
                label={t("settings.bpmDecimals")}
                value={settings.bpmDecimals as (typeof DECIMALS)[number]}
                options={DECIMALS}
                onChange={(bpmDecimals) => update.mutate({ bpmDecimals })}
                render={(d) => (
                  <>
                    <span className="font-medium">{t(`settings.decimals.${d}`)}</span>
                    <span className="font-mono text-data text-text-2">{formatBpm(124, d)}</span>
                  </>
                )}
              />
              <label className="flex flex-col gap-2">
                <span className="text-section">{t("settings.cueCount")}</span>
                <span className="text-control text-text-2">{t("settings.cueCountHint")}</span>
                <select
                  value={settings.cueCount}
                  onChange={(e) => update.mutate({ cueCount: Number(e.target.value) })}
                  className="h-8 w-28 rounded-sm border border-border bg-surface-3 px-2 text-control text-text"
                >
                  {CUE_COUNTS.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
