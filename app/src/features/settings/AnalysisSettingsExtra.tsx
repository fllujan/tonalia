// Settings › Analysis (SPEC 2.4, 2.6 and 2.14, DESIGN 6.13): BPM range, parallel
// processes and the cue colour palette. The engine validates the same limits
// (rpc_schema.Settings); checking here only gives the message before saving.
import { Pipette, RotateCcw } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SettingsUpdate } from "../../lib/rpc.types";
import { CUE_PALETTE } from "../../lib/sections";
import { BPM_LIMITS, bpmRangeError, DEFAULT_CUE_COLORS } from "./analysisLimits";
import type { AppSettings } from "./api";

/** Section of each palette entry, in the engine's order (cues.SECTION_ORDER). */
const PALETTE_SECTIONS = [
  "intro",
  "build",
  "drop",
  "breakdown",
  "build2",
  "drop2",
  "verse",
  "outro",
];

const FIELD =
  "h-8 rounded-sm border border-border bg-surface-3 px-2 font-mono text-control text-text aria-[invalid=true]:border-danger";

type Save = (update: SettingsUpdate) => void;
type CueColors = AppSettings["cueColors"];

export function BpmRangeSetting({ settings, save }: { settings: AppSettings; save: Save }) {
  const { t } = useTranslation();
  const hintId = useId();
  const [stored, storedHi] = settings.bpmRange as [number, number];
  const [lo, setLo] = useState(String(stored));
  const [hi, setHi] = useState(String(storedHi));
  const error = bpmRangeError(Number(lo), Number(hi));
  const commit = () => {
    const range = [Number(lo), Number(hi)];
    if (!error && (range[0] !== stored || range[1] !== storedHi)) save({ bpmRange: range });
  };
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-section">{t("settings.bpmRange")}</legend>
      <p id={hintId} className="text-control text-text-2">
        {t("settings.bpmRangeHint")}
      </p>
      <div className="mt-1 flex items-center gap-2">
        {(
          [
            ["min", lo, setLo],
            ["max", hi, setHi],
          ] as const
        ).map(([which, value, set], i) => (
          <span key={which} className="contents">
            {i === 1 && (
              <span aria-hidden className="text-text-3">
                –
              </span>
            )}
            <input
              type="number"
              inputMode="numeric"
              min={BPM_LIMITS.min}
              max={BPM_LIMITS.max}
              value={value}
              aria-label={t(`settings.bpmRange_${which}`)}
              aria-describedby={hintId}
              aria-invalid={error ? true : undefined}
              onChange={(e) => set(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => e.key === "Enter" && commit()}
              className={`${FIELD} w-20`}
            />
          </span>
        ))}
        <span className="text-control text-text-2">BPM</span>
      </div>
      {error && (
        <p role="alert" className="text-[12px] text-danger">
          {t(`settings.bpmRangeError_${error}`, BPM_LIMITS)}
        </p>
      )}
    </fieldset>
  );
}

export function WorkersSetting({ settings, save }: { settings: AppSettings; save: Save }) {
  const { t } = useTranslation();
  const cores = Math.max(2, navigator.hardwareConcurrency || 4);
  const auto = Math.max(1, cores - 1);
  return (
    <label className="flex flex-col gap-2">
      <span className="text-section">{t("settings.workers")}</span>
      <span className="text-control text-text-2">{t("settings.workersHint")}</span>
      <select
        value={settings.analysisWorkers}
        onChange={(e) => save({ analysisWorkers: Number(e.target.value) })}
        className="h-8 w-56 rounded-sm border border-border bg-surface-3 px-2 text-control text-text"
      >
        <option value={0}>{t("settings.workersAuto", { count: auto })}</option>
        {Array.from({ length: cores }, (_, i) => i + 1).map((n) => (
          <option key={n} value={n}>
            {t("settings.workersN", { count: n })}
          </option>
        ))}
      </select>
    </label>
  );
}

export function CuePaletteSetting({ settings, save }: { settings: AppSettings; save: Save }) {
  const { t } = useTranslation();
  const stored = settings.cueColors.join();
  // The colour picker reports every move: show them at once, save once it settles.
  // (The parent remounts this with a new key when the stored palette changes.)
  const [colors, setColors] = useState<CueColors>(settings.cueColors);
  useEffect(() => {
    if (colors.join() === stored) return;
    const timer = window.setTimeout(() => save({ cueColors: colors }), 400);
    return () => window.clearTimeout(timer);
  }, [colors, stored, save]);
  const isDefault = colors.every((c, i) => c.toUpperCase() === CUE_PALETTE[i]?.toUpperCase());
  const set = (index: number, color: string) =>
    setColors(
      (current) => current.map((c, i) => (i === index ? color.toUpperCase() : c)) as CueColors,
    );
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-section">{t("settings.cueColors")}</legend>
      <p className="text-control text-text-2">{t("settings.cueColorsHint")}</p>
      <ul className="mt-1 grid grid-cols-4 gap-2">
        {PALETTE_SECTIONS.map((section, i) => (
          <li key={section}>
            <label className="flex h-9 cursor-pointer items-center gap-2 rounded-sm border border-border bg-surface-2 px-2 hover:border-border-strong focus-within:ring-2 focus-within:ring-primary">
              {/* A plain swatch: the palette is per section, and a number would read as
                  the cue slot (cue 3 is not always the drop). */}
              <span
                aria-hidden
                className="size-4 shrink-0 rounded-[4px] border border-border-strong"
                style={{ backgroundColor: colors[i] }}
              />
              <span className="min-w-0 flex-1 truncate text-control">
                {t(`sections.${section}`)}
              </span>
              <Pipette aria-hidden size={14} strokeWidth={1.5} className="shrink-0 text-text-3" />
              <input
                type="color"
                value={(colors[i] ?? "#888888").toLowerCase()}
                onChange={(e) => set(i, e.target.value)}
                aria-label={t("settings.cueColorFor", { section: t(`sections.${section}`) })}
                className="sr-only"
              />
            </label>
          </li>
        ))}
      </ul>
      {!isDefault && (
        <button
          type="button"
          onClick={() => setColors(DEFAULT_CUE_COLORS)}
          className="flex h-8 w-fit items-center gap-1.5 rounded-sm px-2 text-text-2 hover:bg-surface-2 hover:text-text"
        >
          <RotateCcw aria-hidden size={14} strokeWidth={1.5} />
          {t("settings.cueColorsReset")}
        </button>
      )}
    </fieldset>
  );
}
