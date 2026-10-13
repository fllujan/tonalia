// Stems UI (SPEC 2.16, DESIGN 6.5, 6.13 and 6.15): model download dialog, the stems panel
// of the track detail, the settings section and the library progress bar.
import { convertFileSrc } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { Download, FolderOpen, Layers, Pause, Play, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "../../components/Modal";
import { formatBytes } from "../../lib/format";
import type { StemSet } from "../../lib/rpc.types";
import { JobBar } from "../library/JobBar";
import { useSettings, useUpdateSettings } from "../settings/api";
import {
  cancelStemJob,
  requestSeparation,
  startModelDownload,
  useClearStemsCache,
  useStemsStatus,
  useTrackStems,
} from "./api";
import { EXPORT_FORMATS } from "./exportOptions";
import { type StemDevice, type StemModel, useStemsStore } from "./stemsStore";
import { inkOf } from "../../lib/keyStyle";

const STEM_NAMES = ["vocals", "drums", "bass", "other", "instrumental"] as const;
const MODELS: readonly StemModel[] = ["htdemucs_ft", "htdemucs"];
const DEVICES: readonly StemDevice[] = ["auto", "cpu"];

const BUTTON =
  "flex h-8 items-center gap-1.5 whitespace-nowrap rounded-sm border border-border bg-surface-3 px-3 text-text transition-colors duration-hover hover:border-border-strong disabled:opacity-40";

function Progress({ label, percent }: { label: string; percent: number }) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(percent)}
      className="h-1.5 w-full overflow-hidden rounded-pill bg-surface-3"
    >
      <div
        className="h-full rounded-pill bg-aurora transition-[width] duration-panel"
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

/** "Download the stems model" (DESIGN 6.15): size, progress, "only downloaded once". */
export function ModelDownloadDialog() {
  const { t, i18n } = useTranslation();
  const open = useStemsStore((s) => s.dialogOpen);
  const download = useStemsStore((s) => s.download);
  const settings = useSettings();
  const status = useStemsStatus().data;
  if (!open) return null;
  const model = settings.stemModel;
  const info = status?.models.find((m) => m.model === model);
  const close = () => {
    if (download) void cancelStemJob(download.jobId);
    useStemsStore.getState().closeDialog();
  };
  return (
    <Modal label={t("stems.dialog.title")} onClose={close} width={460}>
      <div className="flex flex-col gap-4 p-5">
        <h2 className="font-display text-title">{t("stems.dialog.title")}</h2>
        <p className="text-body text-text-2">
          {t("stems.dialog.text", {
            model: t(`stems.models.${model}`),
            size: formatBytes(info?.missingBytes ?? info?.totalBytes ?? 0, i18n.language),
          })}
        </p>
        <p className="text-[12px] text-text-3">{t("stems.dialog.once")}</p>
        {download && (
          <div className="flex flex-col gap-1.5">
            <Progress label={t("stems.downloading")} percent={download.percent} />
            <span className="font-mono text-[12px] text-text-2">
              {Math.round(download.percent)} %
            </span>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={close} className={BUTTON}>
            {t("edit.cancel")}
          </button>
          <button
            type="button"
            data-autofocus
            disabled={download != null}
            onClick={() => void startModelDownload(model)}
            className="flex h-8 items-center gap-1.5 rounded-sm bg-primary px-3 font-semibold text-white hover:bg-primary-hover disabled:opacity-50"
          >
            <Download size={14} strokeWidth={1.5} />
            {t("stems.dialog.download")}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function StemList({ stems }: { stems: StemSet }) {
  const { t } = useTranslation();
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  useEffect(() => () => audio.current?.pause(), []);

  const toggle = (name: (typeof STEM_NAMES)[number]) => {
    if (playing === name) {
      audio.current?.pause();
      setPlaying(null);
      return;
    }
    audio.current?.pause();
    const el = new Audio(convertFileSrc(stems[name]));
    el.onended = () => setPlaying(null);
    audio.current = el;
    void el.play().catch(() => setPlaying(null));
    setPlaying(name);
  };

  return (
    <ul aria-label={t("stems.title")} className="flex flex-wrap gap-2">
      {STEM_NAMES.map((name) => {
        const label = t(`stems.names.${name}`);
        const on = playing === name;
        return (
          <li
            key={name}
            className="flex h-9 items-center gap-2 rounded-md border border-border bg-surface-2 pl-1 pr-3"
          >
            <button
              type="button"
              aria-label={t(on ? "stems.pause" : "stems.listen", { stem: label })}
              onClick={() => toggle(name)}
              className="grid size-7 place-items-center rounded-pill text-text hover:bg-surface-3"
              style={{ color: inkOf(`var(--color-stem-${name})`) }}
            >
              {on ? <Pause size={14} strokeWidth={1.5} /> : <Play size={14} strokeWidth={1.5} />}
            </button>
            <span className="text-control">{label}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** Share of voice in the main sections (SPEC 2.16), estimated or measured on the stems. */
function VocalPresence({ value, source }: { value: number; source: "estimate" | "stems" }) {
  const { t, i18n } = useTranslation();
  const percent = new Intl.NumberFormat(i18n.language, { style: "percent" }).format(value);
  return (
    <p className="text-[12px] text-text-2">
      {t("stems.vocalPresence")}: <span className="font-mono text-text">{percent}</span>{" "}
      <span className="text-text-3">· {t(`stems.vocalSource.${source}`)}</span>
    </p>
  );
}

/** Stems of one track in the detail view: separate, follow the progress, listen. */
export function StemsPanel({
  trackId,
  vocalPresence = null,
  vocalSource = null,
}: {
  trackId: number;
  vocalPresence?: number | null;
  vocalSource?: "estimate" | "stems" | null;
}) {
  const { t } = useTranslation();
  const settings = useSettings();
  const status = useStemsStatus().data;
  const stems = useTrackStems(trackId).data;
  const separation = useStemsStore((s) => s.separation);
  const mine = separation?.trackIds.includes(trackId) ? separation : null;
  return (
    <section aria-labelledby="detail-stems" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 id="detail-stems" className="text-section">
          {t("stems.title")}
        </h2>
        <ExportButton trackIds={[trackId]} />
      </div>
      {vocalPresence != null && vocalSource && (
        <VocalPresence value={vocalPresence} source={vocalSource} />
      )}
      {stems ? (
        <StemList stems={stems} />
      ) : mine ? (
        <div className="flex max-w-[420px] items-center gap-3">
          <div className="flex flex-1 flex-col gap-1.5">
            <span className="text-[12px] text-text-2">
              {t("stems.separating", { percent: Math.round(mine.percent) })}
            </span>
            <Progress label={t("stems.separatingLabel")} percent={mine.percent} />
          </div>
          <button type="button" onClick={() => void cancelStemJob(mine.jobId)} className={BUTTON}>
            {t("edit.cancel")}
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={separation != null}
            onClick={() => requestSeparation([trackId], status, settings.stemModel)}
            className={BUTTON}
          >
            <Layers size={14} strokeWidth={1.5} />
            {t("stems.separate")}
          </button>
          <span className="text-[12px] text-text-3">{t("stems.separateHint")}</span>
        </div>
      )}
    </section>
  );
}

/** Opens the "Export stems" dialog for these tracks. */
export function ExportButton({ trackIds }: { trackIds: number[] }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={() => useStemsStore.getState().openExport(trackIds)}
      className={BUTTON}
    >
      <Upload size={14} strokeWidth={1.5} />
      <span>{t("stems.export.open")}</span>
    </button>
  );
}

/** "Prepare stems" for the selected tracks (SPEC 2.16: batch for a playlist). */
export function PrepareStemsButton({ trackIds }: { trackIds: number[] }) {
  const { t } = useTranslation();
  const settings = useSettings();
  const status = useStemsStatus().data;
  const busy = useStemsStore((s) => s.separation != null);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => requestSeparation(trackIds, status, settings.stemModel)}
      className={BUTTON}
    >
      <Layers size={14} strokeWidth={1.5} />
      <span>{t("stems.prepare")}</span>
    </button>
  );
}

export function StemsBar() {
  const { t } = useTranslation();
  const separation = useStemsStore((s) => s.separation);
  if (!separation) return null;
  return (
    <JobBar
      label={t("stems.separatingLabel")}
      percent={separation.percent}
      onCancel={() => void cancelStemJob(separation.jobId)}
    />
  );
}

/** Settings → Stems (DESIGN 6.13): model, acceleration, download and cache. */
export function StemsSettings() {
  const { t, i18n } = useTranslation();
  const settings = useSettings();
  const update = useUpdateSettings((error) => t("settings.saveFailed", { error }));
  const status = useStemsStatus().data;
  const clear = useClearStemsCache();
  const download = useStemsStore((s) => s.download);
  const current = status?.models.find((m) => m.model === settings.stemModel);
  const accelerator = status?.accelerator ?? null;

  const card = (on: boolean) =>
    `flex min-w-[200px] cursor-pointer flex-col gap-1 rounded-md border p-3 transition-colors duration-hover focus-within:ring-2 focus-within:ring-primary ${on ? "border-primary bg-primary-soft" : "border-border bg-surface-2 hover:border-border-strong"}`;

  return (
    <div className="flex max-w-[720px] flex-col gap-8">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-section">{t("stems.model")}</legend>
        <div className="flex flex-wrap gap-2">
          {MODELS.map((m) => {
            const info = status?.models.find((x) => x.model === m);
            return (
              <label key={m} className={card(settings.stemModel === m)}>
                <input
                  type="radio"
                  name="stem-model"
                  checked={settings.stemModel === m}
                  onChange={() => update.mutate({ stemModel: m })}
                  className="sr-only"
                />
                <span className="font-medium">{t(`stems.models.${m}`)}</span>
                <span className="text-[12px] text-text-2">{t(`stems.modelHints.${m}`)}</span>
                {info && (
                  <span className="text-[12px] text-text-3">
                    {formatBytes(info.totalBytes, i18n.language)} ·{" "}
                    {info.installed ? t("stems.installed") : t("stems.notInstalled")}
                  </span>
                )}
              </label>
            );
          })}
        </div>
        <div className="flex items-center gap-3 pt-1">
          {current?.installed ? (
            <span className="text-[12px] text-success">{t("stems.installed")}</span>
          ) : download ? (
            <div className="flex w-[320px] items-center gap-2">
              <Progress label={t("stems.downloading")} percent={download.percent} />
              <span className="font-mono text-[12px] text-text-2">
                {Math.round(download.percent)} %
              </span>
            </div>
          ) : (
            current && (
              <button
                type="button"
                onClick={() => void startModelDownload(settings.stemModel)}
                className={BUTTON}
              >
                <Download size={14} strokeWidth={1.5} />
                {t("stems.downloadModel", {
                  size: formatBytes(current.missingBytes, i18n.language),
                })}
              </button>
            )
          )}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-section">{t("stems.acceleration")}</legend>
        <div className="flex flex-wrap gap-2">
          {DEVICES.map((d) => (
            <label key={d} className={card(settings.stemDevice === d)}>
              <input
                type="radio"
                name="stem-device"
                checked={settings.stemDevice === d}
                onChange={() => update.mutate({ stemDevice: d })}
                className="sr-only"
              />
              <span className="font-medium">{t(`stems.devices.${d}`)}</span>
              <span className="text-[12px] text-text-2">
                {d === "cpu"
                  ? t("stems.devices.cpuHint")
                  : t(`stems.accelerators.${accelerator ?? "none"}`)}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <ExportSettings />

      <section className="flex flex-col gap-2">
        <h2 className="text-section">{t("stems.cache")}</h2>
        <div className="flex items-center gap-3">
          <span className="text-body text-text-2">
            {t("stems.cacheUsed", {
              size: formatBytes(status?.cache.bytes ?? 0, i18n.language),
              count: status?.cache.tracks ?? 0,
            })}
          </span>
          <button
            type="button"
            disabled={!status?.cache.bytes || clear.isPending}
            onClick={() => clear.mutate()}
            className={BUTTON}
          >
            {t("stems.clear")}
          </button>
        </div>
      </section>
    </div>
  );
}

/** Settings → Stems → Export: DAW project folder, default format and file name template. */
function ExportSettings() {
  const { t } = useTranslation();
  const settings = useSettings();
  const update = useUpdateSettings((error) => t("settings.saveFailed", { error }));
  const [template, setTemplate] = useState<string | null>(null);
  const pick = async () => {
    const folder = await open({ directory: true, title: t("stems.export.dawFolder") });
    if (typeof folder === "string") update.mutate({ dawFolder: folder });
  };
  const saveTemplate = () => {
    const value = template?.trim();
    if (value && value !== settings.stemExportTemplate)
      update.mutate({ stemExportTemplate: value });
    setTemplate(null);
  };
  return (
    <fieldset className="flex flex-col gap-4">
      <legend className="mb-2 text-section">{t("stems.export.settings")}</legend>
      <div className="flex flex-col gap-1.5">
        <span className="text-control font-medium">{t("stems.export.dawFolder")}</span>
        <div className="flex items-center gap-2">
          <span
            className={`min-w-0 flex-1 truncate text-text-2 ${settings.dawFolder ? "font-mono text-[12px]" : "text-control"}`}
            title={settings.dawFolder}
          >
            {settings.dawFolder || t("stems.export.noDawFolder")}
          </span>
          {settings.dawFolder && (
            <button
              type="button"
              onClick={() => update.mutate({ dawFolder: "" })}
              className={BUTTON}
            >
              {t("stems.export.removeFolder")}
            </button>
          )}
          <button type="button" onClick={() => void pick()} className={BUTTON}>
            <FolderOpen size={14} strokeWidth={1.5} />
            {t("stems.export.chooseFolder")}
          </button>
        </div>
      </div>
      <div
        className="flex flex-col gap-1.5"
        role="radiogroup"
        aria-label={t("stems.export.format")}
      >
        <span className="text-control font-medium">{t("stems.export.format")}</span>
        <div className="flex items-center gap-2">
          {EXPORT_FORMATS.map((f) => (
            <label
              key={f}
              className={`flex h-8 cursor-pointer items-center rounded-sm border px-3 text-control font-medium focus-within:ring-2 focus-within:ring-primary ${settings.stemExportFormat === f ? "border-primary bg-primary-soft" : "border-border bg-surface-3"}`}
            >
              <input
                type="radio"
                name="settings-export-format"
                checked={settings.stemExportFormat === f}
                onChange={() => update.mutate({ stemExportFormat: f })}
                className="sr-only"
              />
              {f.toUpperCase()}
            </label>
          ))}
          <span className="text-[12px] text-text-3">{t("stems.export.bits")}</span>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="stem-export-template" className="text-control font-medium">
          {t("stems.export.template")}
        </label>
        <input
          id="stem-export-template"
          aria-describedby="stem-export-template-hint"
          value={template ?? settings.stemExportTemplate}
          onChange={(e) => setTemplate(e.target.value)}
          onBlur={saveTemplate}
          onKeyDown={(e) => e.key === "Enter" && saveTemplate()}
          className="h-8 rounded-sm border border-border bg-surface-3 px-2 font-mono text-control"
        />
        <span id="stem-export-template-hint" className="text-[12px] text-text-3">
          {t("stems.export.templateHint")}
        </span>
      </div>
    </fieldset>
  );
}
