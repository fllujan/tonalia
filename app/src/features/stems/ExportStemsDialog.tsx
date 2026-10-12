// "Export stems" (SPEC 2.16): voice, instrumental, each stem or the whole track, original
// or with the pitch shift and tempo applied, as WAV/AIFF/FLAC 24-bit, to the DAW project
// folder or a folder chosen here. File names follow the template set in Settings → Stems.
import { useQueries } from "@tanstack/react-query";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, Minus, Plus, Upload } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "../../components/Modal";
import { request } from "../../lib/rpc";
import type { StemExportParams } from "../../lib/rpc.types";
import { isNonEmpty } from "../library/api";
import {
  EXPORT_FORMATS,
  EXPORT_SOURCES,
  type RenderSource,
  type StemExportFormat,
} from "./exportOptions";
import { useSettings } from "../settings/api";
import {
  cancelStemJob,
  requestSeparation,
  startExport,
  stemsKeys,
  useExportPreview,
  useStemsStatus,
} from "./api";
import { useStemsStore } from "./stemsStore";

const MAX_SHIFT = 6;
const PREVIEW_NAMES = 4;

const BUTTON =
  "flex h-8 items-center gap-1.5 whitespace-nowrap rounded-sm border border-border bg-surface-3 px-3 text-text transition-colors duration-hover hover:border-border-strong disabled:opacity-40";

function Stepper({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const { t } = useTranslation();
  const clamp = (v: number) => Math.max(-MAX_SHIFT, Math.min(MAX_SHIFT, v));
  return (
    <div className="flex items-center gap-1" role="group" aria-label={t("stems.export.semitones")}>
      <button
        type="button"
        aria-label={t("stems.export.down")}
        disabled={value <= -MAX_SHIFT}
        onClick={() => onChange(clamp(value - 1))}
        className="grid size-8 place-items-center rounded-sm border border-border bg-surface-3 disabled:opacity-40"
      >
        <Minus size={14} strokeWidth={1.5} />
      </button>
      <output aria-live="polite" className="w-16 text-center font-mono text-control">
        {t("stems.export.shift", { value: value > 0 ? `+${value}` : String(value) })}
      </output>
      <button
        type="button"
        aria-label={t("stems.export.up")}
        disabled={value >= MAX_SHIFT}
        onClick={() => onChange(clamp(value + 1))}
        className="grid size-8 place-items-center rounded-sm border border-border bg-surface-3 disabled:opacity-40"
      >
        <Plus size={14} strokeWidth={1.5} />
      </button>
    </div>
  );
}

export function ExportStemsDialog() {
  const trackIds = useStemsStore((s) => s.exportTracks);
  if (!trackIds?.length) return null;
  return <ExportStemsForm trackIds={trackIds} />;
}

function ExportStemsForm({ trackIds }: { trackIds: number[] }) {
  const { t } = useTranslation();
  const settings = useSettings();
  const status = useStemsStatus().data;
  const job = useStemsStore((s) => s.exportJob);
  const separating = useStemsStore((s) => s.separation != null);
  const stemSets = useQueries({
    queries: trackIds.map((trackId) => ({
      queryKey: stemsKeys.track(trackId),
      queryFn: async () => (await request("stems.get", { trackId })).stems ?? null,
    })),
  });
  const missing = trackIds.filter((_, i) => !stemSets[i]?.data);
  const haveStems = missing.length === 0 && stemSets.every((q) => q.isSuccess);

  const [sources, setSources] = useState<RenderSource[]>(["mix"]);
  const [processed, setProcessed] = useState(false);
  const [semitones, setSemitones] = useState(0);
  const [bpm, setBpm] = useState("");
  const [format, setFormat] = useState<StemExportFormat>(settings.stemExportFormat);
  const [custom, setCustom] = useState<string | null>(null);
  const destination = custom ?? (settings.dawFolder || null);

  const targetBpm = processed && bpm.trim() ? Number(bpm.replace(",", ".")) : null;
  const bpmInvalid = targetBpm != null && !(targetBpm > 0);
  const labels = Object.fromEntries(EXPORT_SOURCES.map((s) => [s, t(`stems.names.${s}`)]));
  const usable = sources.filter((s) => s === "mix" || haveStems);
  const usableKey = usable.join();
  const tracksKey = trackIds.join();
  const params: StemExportParams | null = useMemo(() => {
    const items = tracksKey
      .split(",")
      .map(Number)
      .flatMap((trackId) =>
        (usableKey ? (usableKey.split(",") as RenderSource[]) : []).map((source) => ({
          trackId,
          source,
          semitones: processed ? semitones : 0,
          targetBpm,
        })),
      );
    if (!destination || bpmInvalid || !isNonEmpty(items)) return null;
    return {
      items,
      format,
      destination,
      stemLabels: Object.fromEntries(EXPORT_SOURCES.map((s) => [s, t(`stems.names.${s}`)])),
    };
  }, [destination, usableKey, bpmInvalid, tracksKey, processed, semitones, targetBpm, format, t]);
  const preview = useExportPreview(params);

  const close = () => {
    if (job) void cancelStemJob(job.jobId);
    useStemsStore.getState().closeExport();
  };
  const pick = async () => {
    const folder = await open({ directory: true, title: t("stems.export.chooseFolder") });
    if (typeof folder === "string") setCustom(folder);
  };
  const toggle = (source: RenderSource) =>
    setSources((list) =>
      list.includes(source) ? list.filter((s) => s !== source) : [...list, source],
    );

  const names = preview.data?.names ?? [];
  return (
    <Modal label={t("stems.export.title")} onClose={close} width={560}>
      <div className="flex flex-col gap-5 p-5">
        <h2 className="font-display text-title">{t("stems.export.title")}</h2>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-section">{t("stems.export.what")}</legend>
          <div className="grid grid-cols-3 gap-2">
            {EXPORT_SOURCES.map((source) => {
              const disabled = source !== "mix" && !haveStems;
              return (
                <label
                  key={source}
                  className={`flex h-9 items-center gap-2 rounded-md border border-border bg-surface-2 px-3 ${disabled ? "opacity-40" : "cursor-pointer"}`}
                >
                  <input
                    type="checkbox"
                    checked={sources.includes(source) && !disabled}
                    disabled={disabled}
                    onChange={() => toggle(source)}
                    className="accent-primary"
                  />
                  <span
                    aria-hidden
                    className="size-2 rounded-pill"
                    style={{
                      background:
                        source === "mix" ? "var(--color-text-2)" : `var(--color-stem-${source})`,
                    }}
                  />
                  <span className="text-control">{labels[source]}</span>
                </label>
              );
            })}
          </div>
          {!haveStems && (
            <div className="flex items-center gap-3">
              <span className="text-[12px] text-text-3">
                {t("stems.export.needStems", { count: missing.length })}
              </span>
              <button
                type="button"
                disabled={separating}
                onClick={() => requestSeparation(missing, status, settings.stemModel)}
                className={BUTTON}
              >
                {t("stems.separate")}
              </button>
            </div>
          )}
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-section">{t("stems.export.pitchTempo")}</legend>
          <div className="flex gap-4">
            {[false, true].map((on) => (
              <label key={String(on)} className="flex items-center gap-2 text-control">
                <input
                  type="radio"
                  name="export-processing"
                  checked={processed === on}
                  onChange={() => setProcessed(on)}
                  className="accent-primary"
                />
                {t(on ? "stems.export.processed" : "stems.export.original")}
              </label>
            ))}
          </div>
          {processed && (
            <div className="flex flex-wrap items-center gap-4">
              <Stepper value={semitones} onChange={setSemitones} />
              <label className="flex items-center gap-2 text-control">
                {t("stems.export.targetBpm")}
                <input
                  inputMode="decimal"
                  value={bpm}
                  onChange={(e) => setBpm(e.target.value)}
                  placeholder={t("stems.export.originalTempo")}
                  aria-invalid={bpmInvalid}
                  className="h-8 w-28 rounded-sm border border-border bg-surface-3 px-2 font-mono aria-[invalid=true]:border-danger"
                />
              </label>
            </div>
          )}
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-section">{t("stems.export.format")}</legend>
          <div className="flex items-center gap-2">
            {EXPORT_FORMATS.map((f) => (
              <label
                key={f}
                className={`flex h-8 cursor-pointer items-center rounded-sm border px-3 font-mono text-control focus-within:ring-2 focus-within:ring-primary ${format === f ? "border-primary bg-primary-soft" : "border-border bg-surface-3"}`}
              >
                <input
                  type="radio"
                  name="export-format"
                  checked={format === f}
                  onChange={() => setFormat(f)}
                  className="sr-only"
                />
                {f.toUpperCase()}
              </label>
            ))}
            <span className="text-[12px] text-text-3">{t("stems.export.bits")}</span>
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-section">{t("stems.export.destination")}</legend>
          <div className="flex items-center gap-2">
            <span
              className="min-w-0 flex-1 truncate font-mono text-[12px] text-text-2"
              title={destination ?? ""}
            >
              {destination ?? t("stems.export.noFolder")}
            </span>
            {custom && settings.dawFolder && (
              <button type="button" onClick={() => setCustom(null)} className={BUTTON}>
                {t("stems.export.useDaw")}
              </button>
            )}
            <button type="button" onClick={() => void pick()} className={BUTTON}>
              <FolderOpen size={14} strokeWidth={1.5} />
              {t("stems.export.chooseFolder")}
            </button>
          </div>
          {names.length > 0 && (
            <ul aria-label={t("stems.export.names")} className="flex flex-col gap-0.5">
              {names.slice(0, PREVIEW_NAMES).map((name) => (
                <li key={name} className="truncate font-mono text-[12px] text-text-2" title={name}>
                  {name}
                </li>
              ))}
              {names.length > PREVIEW_NAMES && (
                <li className="text-[12px] text-text-3">
                  {t("stems.export.more", { count: names.length - PREVIEW_NAMES })}
                </li>
              )}
            </ul>
          )}
        </fieldset>

        {job && (
          <div
            role="progressbar"
            aria-label={t("stems.export.exporting")}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(job.percent)}
            className="h-1.5 w-full overflow-hidden rounded-pill bg-surface-3"
          >
            <div className="h-full rounded-pill bg-aurora" style={{ width: `${job.percent}%` }} />
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={close} className={BUTTON}>
            {t("edit.cancel")}
          </button>
          <button
            type="button"
            data-autofocus
            disabled={!params || job != null}
            onClick={() => params && void startExport(params)}
            className="flex h-8 items-center gap-1.5 rounded-sm bg-primary px-3 font-semibold text-white hover:bg-primary-hover disabled:opacity-50"
          >
            <Upload size={14} strokeWidth={1.5} />
            {t("stems.export.submit", { count: trackIds.length * usable.length })}
          </button>
        </div>
      </div>
    </Modal>
  );
}
