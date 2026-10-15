import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { KeyChip } from "../../components/KeyChip";
import { LANGUAGES, type Language, languageName, saveLanguage } from "../../i18n";
import { formatBpm } from "../../lib/format";
import { makeKey, NOTATIONS, type Notation } from "../../lib/keys";
import { THEMES, type Theme } from "../../lib/theme";
import { useSettings, useUpdateSettings } from "./api";
import { StemsSettings } from "../stems/StemsUi";
import { WatchedFolders } from "./WatchedFolders";
import { useQuery } from "@tanstack/react-query";
import { Logo } from "../../components/brand/Logo";
import { request } from "../../lib/rpc";
import { APP_VERSION, openLogsFolder } from "../../lib/system";
import { UpdatesSettings } from "../updates/UpdatesSettings";
import { ThirdPartyDialog } from "./ThirdParty";
import { BpmRangeSetting, CuePaletteSetting, WorkersSetting } from "./AnalysisSettingsExtra";

const SECTIONS = ["general", "analysis", "watched", "stems", "updates", "about"] as const;
type Section = (typeof SECTIONS)[number];

const SECTION_KEY = "tonalia.settings.section";

/** The section the DJ last opened, so coming back to Settings lands where they left. */
function loadSection(): Section {
  try {
    const stored = localStorage.getItem(SECTION_KEY);
    return SECTIONS.find((s) => s === stored) ?? "analysis";
  } catch {
    return "analysis";
  }
}

function saveSection(section: Section): void {
  try {
    localStorage.setItem(SECTION_KEY, section);
  } catch {
    // Not remembered; the section still opens.
  }
}

const ROW_KEYS = ["bg-key-8a", "bg-key-9a", "bg-key-10b"];

/** A tiny window in one theme: sidebar, a few rows, one key chip and the violet. */
function ThemeWindow({ theme }: { theme: "light" | "dark" }) {
  return (
    <span data-theme-preview={theme} className="flex h-full w-full bg-bg">
      <span className="flex w-[30%] flex-col gap-1 border-r border-border bg-surface-1 p-1.5">
        <span className="h-1.5 w-3/4 rounded-full bg-primary" />
        <span className="h-1 w-full rounded-full bg-surface-3" />
        <span className="h-1 w-2/3 rounded-full bg-surface-3" />
      </span>
      <span className="flex flex-1 flex-col gap-1 p-1.5">
        {[0, 1, 2].map((row) => (
          <span key={row} className="flex h-3 items-center gap-1 rounded-[3px] bg-surface-2 px-1">
            <span className="h-1 flex-1 rounded-full bg-border" />
            <span className={`h-1.5 w-3 rounded-full ${ROW_KEYS[row] ?? ""}`} />
          </span>
        ))}
      </span>
    </span>
  );
}

/** Thumbnail for a theme option; System shows both halves. */
function ThemeThumb({ theme }: { theme: Theme }) {
  return (
    <span
      aria-hidden
      className="relative block h-[60px] w-full overflow-hidden rounded-sm border border-border"
    >
      {theme === "system" ? (
        <>
          <span className="absolute inset-0">
            <ThemeWindow theme="light" />
          </span>
          <span className="absolute inset-0 [clip-path:polygon(100%_0,100%_100%,0_100%)]">
            <ThemeWindow theme="dark" />
          </span>
        </>
      ) : (
        <ThemeWindow theme={theme} />
      )}
    </span>
  );
}

// F♯m and D♭: both are spelt differently in Classical and Classical with flats, so every
// notation's preview looks different from the others.
const PREVIEW_KEYS = [makeKey(6, "minor"), makeKey(1, "major")];
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

function About() {
  const { t } = useTranslation();
  const [licenses, setLicenses] = useState(false);
  const engine = useQuery({
    queryKey: ["engine.version"],
    queryFn: () => request("engine.version"),
  });
  return (
    <div className="flex max-w-[720px] flex-col gap-6">
      <div className="flex items-center gap-4">
        <Logo />
        <span className="font-mono text-data text-text-2">
          {t("settings.version", { version: APP_VERSION })}
        </span>
      </div>
      {engine.data && (
        <p className="font-mono text-control text-text-3">
          {t("settings.engineVersion", {
            version: engine.data.version,
            python: engine.data.python,
          })}
        </p>
      )}
      <p className="text-body text-text-2">{t("settings.license")}</p>
      <dl className="flex flex-col gap-1">
        <dt className="text-label uppercase text-text-3">{t("settings.source")}</dt>
        <dd className="font-mono text-control text-text">github.com/fllujan/tonalia</dd>
        <dd className="text-control text-text-3">{t("settings.sourceHint")}</dd>
      </dl>
      <div className="flex flex-col items-start gap-2">
        <button
          type="button"
          onClick={() => setLicenses(true)}
          className="h-8 rounded-sm border border-border bg-surface-3 px-3 text-text hover:border-border-strong"
        >
          {t("licenses.title")}
        </button>
        <span className="text-control text-text-3">{t("licenses.hint")}</span>
      </div>
      {licenses && <ThirdPartyDialog onClose={() => setLicenses(false)} />}
      <div className="flex flex-col items-start gap-2">
        <button
          type="button"
          onClick={() => void openLogsFolder().catch(() => undefined)}
          className="h-8 rounded-sm border border-border bg-surface-3 px-3 text-text hover:border-border-strong"
        >
          {t("settings.openLogs")}
        </button>
        <span className="text-control text-text-3">{t("settings.logsHint")}</span>
      </div>
    </div>
  );
}

interface SettingsViewProps {
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
}

// DESIGN 6.13 — sections appear as their features land.
export function SettingsView({ theme, onThemeChange }: SettingsViewProps) {
  const { t, i18n } = useTranslation();
  const [section, setSectionState] = useState<Section>(loadSection);
  const setSection = (next: Section) => {
    setSectionState(next);
    saveSection(next);
  };
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
                render={(th) => (
                  <>
                    <ThemeThumb theme={th} />
                    <span>{t(`theme.${th}`)}</span>
                  </>
                )}
              />
              <Choice<Language>
                label={t("language.label")}
                value={LANGUAGES.includes(i18n.language) ? i18n.language : "es"}
                options={LANGUAGES}
                onChange={(lng) => {
                  saveLanguage(lng);
                  void i18n.changeLanguage(lng);
                }}
                // Each language by its own name, as speakers of it look for it.
                render={(lng) => <span lang={lng}>{languageName(lng)}</span>}
              />
            </div>
          ) : section === "watched" ? (
            <WatchedFolders />
          ) : section === "stems" ? (
            <StemsSettings />
          ) : section === "updates" ? (
            <UpdatesSettings />
          ) : section === "about" ? (
            <About />
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
              {/* DESIGN 6.13 order: notation, BPM range, rounding, cues, palette, workers. */}
              <BpmRangeSetting
                key={settings.bpmRange.join()}
                settings={settings}
                save={update.mutate}
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
              <CuePaletteSetting
                key={settings.cueColors.join()}
                settings={settings}
                save={update.mutate}
              />
              <WorkersSetting settings={settings} save={update.mutate} />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
