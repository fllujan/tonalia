// "Export favorite" (SPEC 2.15 and 2.16): the two files of a combination, ready for the
// DAW — deck A and deck B with their stems, by default with the key changes applied and B
// at A's tempo — as WAV/AIFF/FLAC 24-bit, to the DAW folder or a folder chosen here.
import { useQueries } from "@tanstack/react-query";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, Layers, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "../../components/Modal";
import { formatSemitones } from "../../lib/format";
import { request } from "../../lib/rpc";
import type { StemExportParams } from "../../lib/rpc.types";
import { useSettings } from "../settings/api";
import {
  cancelStemJob,
  requestSeparation,
  startExport,
  stemsKeys,
  useExportPreview,
  useStemsStatus,
} from "../stems/api";
import { EXPORT_FORMATS, EXPORT_SOURCES, type StemExportFormat } from "../stems/exportOptions";
import { useStemsStore } from "../stems/stemsStore";
import { exportItems } from "./exportItems";
import { type ExportCombination, useFavoritesStore } from "./favoritesStore";
import { inkOf } from "../../lib/keyStyle";

const BUTTON =
  "flex h-8 items-center gap-1.5 whitespace-nowrap rounded-sm border border-border bg-surface-3 px-3 text-text transition-colors duration-hover hover:border-border-strong disabled:opacity-40";

export function FavoriteExportDialog() {
  const combination = useFavoritesStore((s) => s.exporting);
  if (!combination) return null;
  return <ExportForm combination={combination} />;
}

function ExportForm({ combination }: { combination: ExportCombination }) {
  const { t } = useTranslation();
  const settings = useSettings();
  const status = useStemsStatus().data;
  const job = useStemsStore((s) => s.exportJob);
  const separating = useStemsStore((s) => s.separation != null);
  const [processed, setProcessed] = useState(true);
  const [format, setFormat] = useState<StemExportFormat>(settings.stemExportFormat);
  const [custom, setCustom] = useState<string | null>(null);
  const destination = custom ?? (settings.dawFolder || null);
  const close = useFavoritesStore((s) => s.closeExport);

  const items = exportItems(combination, processed);
  const stemSets = useQueries({
    queries: items.map((item) => ({
      queryKey: stemsKeys.track(item.trackId),
      queryFn: async () => (await request("stems.get", { trackId: item.trackId })).stems ?? null,
    })),
  });
  const missing = items
    .filter((item, i) => item.source !== "mix" && stemSets[i]?.isSuccess && !stemSets[i]?.data)
    .map((item) => item.trackId);
  const loading = stemSets.some((q) => q.isPending);

  // The preview query hashes the params, so a new object with the same content is free.
  const params: StemExportParams | null =
    !destination || loading || missing.length
      ? null
      : {
          items,
          format,
          destination,
          stemLabels: Object.fromEntries(EXPORT_SOURCES.map((s) => [s, t(`stems.names.${s}`)])),
        };
  const preview = useExportPreview(params);
  const names = preview.data?.names ?? [];

  // The export finished (the stems store clears its job): close.
  const started = useRef(false);
  useEffect(() => {
    if (job) started.current = true;
    else if (started.current) close();
  }, [job, close]);

  const cancel = () => {
    if (job) void cancelStemJob(job.jobId);
    close();
  };
  const pick = async () => {
    const folder = await open({ directory: true, title: t("stems.export.chooseFolder") });
    if (typeof folder === "string") setCustom(folder);
  };

  return (
    <Modal label={t("favorites.exportTitle")} onClose={cancel} width={560}>
      <div className="flex flex-col gap-5 p-5">
        <h2 className="font-display text-title">{t("favorites.exportTitle")}</h2>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-section">{t("stems.export.pitchTempo")}</legend>
          <div className="flex gap-4">
            {[true, false].map((on) => (
              <label key={String(on)} className="flex items-center gap-2 text-control">
                <input
                  type="radio"
                  name="favorite-processing"
                  checked={processed === on}
                  onChange={() => setProcessed(on)}
                  className="accent-primary"
                />
                {t(on ? "favorites.processed" : "stems.export.original")}
              </label>
            ))}
          </div>
          <ul className="flex flex-col gap-1 text-[12px] text-text-2">
            {items.map((item, i) => (
              <li key={item.trackId} className="flex items-center gap-2">
                <span
                  className="text-label uppercase"
                  style={{ color: inkOf(i === 0 ? "var(--color-deck-a)" : "var(--color-deck-b)") }}
                >
                  {t(i === 0 ? "pro.deckA" : "pro.deckB")}
                </span>
                <span>{t(`stems.names.${item.source ?? "mix"}`)}</span>
                {item.semitones ? (
                  <span className="font-mono">
                    {t("pro.semitones", { value: formatSemitones(item.semitones ?? 0) })}
                  </span>
                ) : null}
                {item.targetBpm ? (
                  <span className="font-mono">{t("favorites.atBpm", { bpm: item.targetBpm })}</span>
                ) : null}
              </li>
            ))}
          </ul>
          {missing.length > 0 && (
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
                <Layers aria-hidden size={14} strokeWidth={1.5} />
                {t("stems.separate")}
              </button>
            </div>
          )}
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-section">{t("stems.export.format")}</legend>
          <div className="flex items-center gap-2">
            {EXPORT_FORMATS.map((f) => (
              <label
                key={f}
                className={`flex h-8 cursor-pointer items-center rounded-sm border px-3 text-control font-medium focus-within:ring-2 focus-within:ring-primary ${format === f ? "border-primary bg-primary-soft" : "border-border bg-surface-3"}`}
              >
                <input
                  type="radio"
                  name="favorite-format"
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
              {names.map((name) => (
                <li key={name} className="truncate font-mono text-[12px] text-text-2" title={name}>
                  {name}
                </li>
              ))}
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
          <button type="button" onClick={cancel} className={BUTTON}>
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
            {t("stems.export.submit", { count: items.length })}
          </button>
        </div>
      </div>
    </Modal>
  );
}
