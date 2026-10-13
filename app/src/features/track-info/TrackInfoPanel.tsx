// "Track info" sliding panel (DESIGN 6.6, SPEC 2.14). Key, BPM and energy are stored as
// manual edits that prevail over the analysis; the other fields are written into the
// file through the safe tag path (backup + undo from the toast).
import { useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { KeyGrid } from "../../components/KeyGrid";
import { formatBpm, fileStem } from "../../lib/format";
import { type Key, makeKey } from "../../lib/keys";
import { request } from "../../lib/rpc";
import type { EditParams, TrackDetail, TrackUpdateParams } from "../../lib/rpc.types";
import { tapBpm } from "../../lib/tapTempo";
import { libraryKeys, useGenres } from "../library/api";
import { useSettings } from "../settings/api";
import { startEdit } from "../tags/api";
import { detailKey, useTrackDetail } from "../track-detail/api";
import { useToastStore } from "../toast/toastStore";
import { errorMessage } from "../../lib/errors";

type MetaField = "title" | "artist" | "album" | "genre" | "year" | "comment";
const META_FIELDS: MetaField[] = ["title", "artist", "album", "genre", "year", "comment"];

interface Draft {
  meta: Record<MetaField, string>;
  key: Key | null;
  bpm: string;
  energy: number | null;
}

/** BPM in the field as everywhere else in the app (DESIGN: "124.00", the user's decimals). */
function draftOf(track: TrackDetail, bpmDecimals: number): Draft {
  return {
    meta: {
      title: track.title ?? "",
      artist: track.artist ?? "",
      album: track.album ?? "",
      genre: track.genre ?? "",
      year: track.year == null ? "" : String(track.year),
      comment: track.comment ?? "",
    },
    key: track.keyRoot != null && track.keyMode ? makeKey(track.keyRoot, track.keyMode) : null,
    bpm: track.bpm == null ? "" : formatBpm(track.bpm, bpmDecimals),
    energy: track.energy ?? null,
  };
}

function Field({
  label,
  edited,
  children,
}: {
  label: string;
  edited: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-1">
      <span className="flex items-center gap-2 text-label uppercase text-text-3">
        {label}
        {edited && (
          <span className="rounded-pill bg-primary-soft px-1.5 text-[10px] normal-case tracking-normal text-primary-ink">
            {t("info.edited")}
          </span>
        )}
      </span>
      {children}
    </div>
  );
}

const INPUT =
  "h-8 w-full rounded-sm border border-border bg-surface-3 px-2 text-control text-text outline-none focus:border-primary aria-[invalid=true]:border-danger";

export function TrackInfoPanel({ trackId, onClose }: { trackId: number; onClose: () => void }) {
  const { t } = useTranslation();
  const settings = useSettings();
  const client = useQueryClient();
  const detail = useTrackDetail(trackId);
  const genres = useGenres();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [taps, setTaps] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const track = detail.data;
  const initial = track ? draftOf(track, settings.bpmDecimals) : null;
  const current = draft ?? initial;

  useEffect(() => {
    panel.current?.querySelector<HTMLElement>("input")?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, track?.id]);

  if (!track || !current || !initial) {
    return (
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={t("info.title")}
        className="fixed inset-y-0 right-0 z-40 w-[420px] border-l border-border bg-surface-1 p-5 text-text-3"
      >
        {t("detail.loading")}
      </aside>
    );
  }

  const update = (next: Partial<Draft>) => setDraft({ ...current, ...next });
  const setMeta = (field: MetaField, value: string) =>
    update({ meta: { ...current.meta, [field]: value } });
  const bpmValue = Number(current.bpm.replace(",", "."));
  const bpmValid =
    current.bpm.trim() === "" || (Number.isFinite(bpmValue) && bpmValue > 0 && bpmValue <= 400);
  const yearValid = current.meta.year === "" || /^\d{4}$/.test(current.meta.year);
  const persistent = new Set(track.editedFields ?? []);
  const keyChanged =
    current.key?.root !== initial.key?.root || current.key?.mode !== initial.key?.mode;
  const bpmChanged = current.bpm !== initial.bpm;
  const energyChanged = current.energy !== initial.energy;
  const metaChanged = META_FIELDS.filter((f) => current.meta[f] !== initial.meta[f]);
  const dirty = keyChanged || bpmChanged || energyChanged || metaChanged.length > 0;

  const tap = (at: number) => {
    const next = [...taps, at];
    setTaps(next);
    const bpm = tapBpm(next);
    if (bpm != null) update({ bpm: formatBpm(bpm, settings.bpmDecimals) });
  };
  const scaleBpm = (factor: number) => {
    if (current.bpm && bpmValid)
      update({ bpm: formatBpm(bpmValue * factor, settings.bpmDecimals) });
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!dirty || !bpmValid || !yearValid) return;
    setSaving(true);
    try {
      const analysis: TrackUpdateParams = { trackId };
      if (keyChanged) analysis.key = current.key;
      if (bpmChanged) analysis.bpm = current.bpm.trim() ? Number(bpmValue.toFixed(3)) : null;
      if (energyChanged) analysis.energy = current.energy;
      if (keyChanged || bpmChanged || energyChanged) await request("track.update", analysis);
      if (metaChanged.length) {
        const values = Object.fromEntries(
          metaChanged.map((f) => [f, current.meta[f].trim()]),
        ) as EditParams["values"];
        await startEdit([trackId], values);
      }
      void client.invalidateQueries({ queryKey: detailKey(trackId) });
      void client.invalidateQueries({ queryKey: libraryKeys.all });
      onClose();
    } catch (err) {
      useToastStore.getState().push({
        title: t("edit.failed", { error: errorMessage(err) }),
        tone: "danger",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div
        aria-hidden
        className="fixed inset-0 z-30 bg-black/30 motion-safe:animate-[fade-in_220ms_var(--ease-out)]"
        onClick={onClose}
      />
      <aside
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={t("info.title")}
        className="fixed inset-y-0 right-0 z-40 flex w-[420px] flex-col border-l border-border bg-surface-1 shadow-overlay motion-safe:animate-[slide-in_220ms_var(--ease-out)]"
      >
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-5">
          <h2 className="min-w-0 flex-1 truncate text-section">{t("info.title")}</h2>
          <button
            type="button"
            aria-label={t("toast.dismiss")}
            onClick={onClose}
            className="grid size-7 place-items-center rounded-sm text-text-3 hover:bg-surface-3 hover:text-text"
          >
            <X size={16} strokeWidth={1.5} />
          </button>
        </header>
        <form onSubmit={(e) => void save(e)} className="flex min-h-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-5">
            <p className="truncate text-[12px] text-text-3" title={track.path}>
              {fileStem(track.path)}
            </p>
            {(["title", "artist", "album"] as const).map((f) => (
              <Field
                key={f}
                label={t(`tags.fieldNames.${f}`)}
                edited={current.meta[f] !== initial.meta[f]}
              >
                <input
                  aria-label={t(`tags.fieldNames.${f}`)}
                  value={current.meta[f]}
                  maxLength={300}
                  onChange={(e) => setMeta(f, e.target.value)}
                  className={INPUT}
                />
              </Field>
            ))}
            <div className="grid grid-cols-[1fr_96px] gap-3">
              <Field
                label={t("tags.fieldNames.genre")}
                edited={current.meta.genre !== initial.meta.genre}
              >
                <input
                  aria-label={t("tags.fieldNames.genre")}
                  list="tonalia-genres"
                  value={current.meta.genre}
                  maxLength={100}
                  onChange={(e) => setMeta("genre", e.target.value)}
                  className={INPUT}
                />
                <datalist id="tonalia-genres">
                  {genres.map((g) => (
                    <option key={g.name} value={g.name} />
                  ))}
                </datalist>
              </Field>
              <Field
                label={t("tags.fieldNames.year")}
                edited={current.meta.year !== initial.meta.year}
              >
                <input
                  aria-label={t("tags.fieldNames.year")}
                  inputMode="numeric"
                  aria-invalid={!yearValid}
                  value={current.meta.year}
                  maxLength={4}
                  onChange={(e) => setMeta("year", e.target.value)}
                  className={`${INPUT} font-mono`}
                />
              </Field>
            </div>
            <Field label={t("library.columns.key")} edited={keyChanged || persistent.has("key")}>
              <KeyGrid
                current={current.key}
                notation={settings.notation}
                onPick={(key) => update({ key })}
                columns={6}
              />
              <button
                type="button"
                onClick={() => update({ key: null })}
                className="self-start text-[12px] text-text-2 hover:text-text"
              >
                {t("edit.noKey")}
              </button>
            </Field>
            <Field label={t("library.columns.bpm")} edited={bpmChanged || persistent.has("bpm")}>
              <div className="flex gap-1.5">
                <input
                  aria-label={t("library.columns.bpm")}
                  inputMode="decimal"
                  aria-invalid={!bpmValid}
                  value={current.bpm}
                  onChange={(e) => update({ bpm: e.target.value })}
                  className={`${INPUT} font-mono`}
                />
                <button
                  type="button"
                  aria-label={t("edit.double")}
                  onClick={() => scaleBpm(2)}
                  className="h-8 rounded-sm border border-border bg-surface-3 px-2 font-mono text-control text-text"
                >
                  ×2
                </button>
                <button
                  type="button"
                  aria-label={t("edit.half")}
                  onClick={() => scaleBpm(0.5)}
                  className="h-8 rounded-sm border border-border bg-surface-3 px-2 font-mono text-control text-text"
                >
                  ÷2
                </button>
                <button
                  type="button"
                  onClick={(e) => tap(e.timeStamp)}
                  className="h-8 whitespace-nowrap rounded-sm border border-border bg-surface-3 px-2 text-control text-text active:bg-primary-soft"
                >
                  {t("info.tap")}
                </button>
              </div>
              {track.bpm != null && current.bpm !== initial.bpm && (
                <span className="text-[12px] text-text-3">
                  {t("info.analysed", { value: formatBpm(track.bpm, settings.bpmDecimals) })}
                </span>
              )}
            </Field>
            <Field
              label={t("library.columns.energy")}
              edited={energyChanged || persistent.has("energy")}
            >
              <div
                role="radiogroup"
                aria-label={t("library.columns.energy")}
                className="flex gap-1"
              >
                {Array.from({ length: 10 }, (_, i) => i + 1).map((level) => (
                  <button
                    key={level}
                    type="button"
                    role="radio"
                    aria-checked={current.energy === level}
                    aria-label={t("energy.label", { level })}
                    onClick={() => update({ energy: level })}
                    className={`flex h-9 flex-1 flex-col items-center justify-between rounded-sm border bg-surface-2 pb-1 pt-1 font-mono text-[11px] ${current.energy === level ? "border-primary text-text" : "border-border text-text-2"}`}
                  >
                    {level}
                    <span
                      aria-hidden
                      className="h-1 w-4 rounded-pill"
                      style={{
                        backgroundColor:
                          current.energy != null && level <= current.energy
                            ? `var(--color-energy-${level})`
                            : "var(--color-surface-3)",
                      }}
                    />
                  </button>
                ))}
              </div>
            </Field>
            <Field
              label={t("tags.fieldNames.comment")}
              edited={current.meta.comment !== initial.meta.comment}
            >
              <textarea
                aria-label={t("tags.fieldNames.comment")}
                value={current.meta.comment}
                rows={3}
                maxLength={1000}
                onChange={(e) => setMeta("comment", e.target.value)}
                className="w-full rounded-sm border border-border bg-surface-3 px-2 py-1.5 text-control text-text outline-none focus:border-primary"
              />
            </Field>
            {metaChanged.length > 0 && (
              <p className="text-[12px] text-text-2">🛟 {t("info.fileNote")}</p>
            )}
          </div>
          <footer className="flex justify-end gap-2 border-t border-border px-5 py-3">
            <button
              type="button"
              onClick={onClose}
              className="h-8 rounded-sm px-3 text-control text-text-2 hover:text-text"
            >
              {t("edit.cancel")}
            </button>
            <button
              type="submit"
              disabled={!dirty || !bpmValid || !yearValid || saving}
              className="h-8 rounded-sm bg-primary px-4 font-semibold text-white hover:bg-primary-hover disabled:opacity-40"
            >
              {t("edit.save")}
            </button>
          </footer>
        </form>
      </aside>
    </>
  );
}
