// "Render set…" (SPEC 14.2, DESIGN 6.26): the options, a preview of each transition, then
// one continuous file with its track list. Only gain: no compressor or limiter.
import { useQuery } from "@tanstack/react-query";
import { save } from "@tauri-apps/plugin-dialog";
import { Loader2, Play, Square } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "../../components/Modal";
import { Segmented } from "../../components/Segmented";
import { Switch } from "../../components/Switch";
import { errorMessage } from "../../lib/errors";
import { formatDuration } from "../../lib/format";
import { revealFile } from "../../lib/reveal";
import { request } from "../../lib/rpc";
import type { RenderSetParams } from "../../lib/rpc.types";
import { MIX_STYLES, type MixPointStyle } from "../decks/mixPoints";
import { useSettings, useUpdateSettings } from "../settings/api";
import { useToastStore } from "../toast/toastStore";
import { type RenderTarget, startRender, stopPreview, useRenderSet } from "./store";

type Format = NonNullable<RenderSetParams["format"]>;
type Tempo = NonNullable<RenderSetParams["tempo"]>;
type Overlap = NonNullable<RenderSetParams["overlapBars"]>;

interface Options {
  format: Format;
  tempo: Tempo;
  fixedBpm: number | null;
  applyShifts: boolean;
  bassSwap: boolean;
  overlapBars: Overlap;
  normalize: boolean;
  targetLufs: number;
  chapters: boolean;
}

const OPTIONS_KEY = "tonalia.renderSet.options";
const DEFAULTS: Options = {
  format: "wav",
  tempo: "native",
  fixedBpm: null,
  applyShifts: true,
  bassSwap: false,
  overlapBars: 32,
  normalize: true,
  targetLufs: -14,
  chapters: false,
};
// Bricks that fit DESIGN's density: compact labels on the left, controls on the right.
const ROW = "flex items-center justify-between gap-4";
const LABEL = "text-body text-text";
const BUTTON =
  "inline-flex h-8 items-center gap-1.5 rounded-sm border border-border bg-surface-3 px-3 text-control text-text hover:border-border-strong disabled:opacity-40";

function loadOptions(): Options {
  try {
    const stored = JSON.parse(localStorage.getItem(OPTIONS_KEY) ?? "{}") as Partial<Options>;
    return { ...DEFAULTS, ...stored, fixedBpm: null };
  } catch {
    return DEFAULTS;
  }
}

function saveOptions(options: Options) {
  try {
    localStorage.setItem(OPTIONS_KEY, JSON.stringify(options));
  } catch {
    // Not remembered; the render still uses them.
  }
}

function params(target: RenderTarget, o: Options, style: MixPointStyle): RenderSetParams {
  return {
    ...(target.playlistId != null ? { playlistId: target.playlistId } : {}),
    items: target.items ?? [],
    format: o.format,
    tempo: o.tempo,
    fixedBpm: o.tempo === "fixed" ? (o.fixedBpm ?? target.firstBpm ?? null) : null,
    applyShifts: o.applyShifts,
    bassSwap: o.bassSwap,
    overlapBars: o.overlapBars,
    style,
    normalize: o.normalize,
    targetLufs: o.targetLufs,
    chapters: o.chapters && o.format !== "wav",
  };
}

function Dialog({ target }: { target: RenderTarget }) {
  const { t, i18n } = useTranslation();
  const close = useRenderSet((s) => s.close);
  const running = useRenderSet((s) => s.running);
  const outcome = useRenderSet((s) => s.outcome);
  const playing = useRenderSet((s) => s.playing);
  const previewError = useRenderSet((s) => s.previewError);
  const style = useSettings().mixPointStyle ?? "intro_outro";
  const updateSettings = useUpdateSettings((error) => t("settings.saveFailed", { error }));
  const formats = useQuery({
    queryKey: ["render.setFormats"],
    queryFn: () => request("render.setFormats"),
    staleTime: Infinity,
  }).data?.formats ?? ["wav", "flac"];
  const [options, setOptionsState] = useState<Options>(loadOptions);
  const setOptions = (patch: Partial<Options>) =>
    setOptionsState((o) => {
      const next = { ...o, ...patch };
      saveOptions(next);
      return next;
    });
  const format: Format = formats.includes(options.format) ? options.format : "wav";
  const o = { ...options, format };
  const rendering = running != null && running.preview == null;
  const busy = running != null;
  const hasShifts = (target.items ?? []).some((i) => i.shift !== 0);
  const number = (n: number, digits = 1) =>
    new Intl.NumberFormat(i18n.language, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    })
      .format(n)
      .replace("-", "−");
  const fail = (err: unknown) =>
    useToastStore
      .getState()
      .push({ title: t("renderSet.failed", { error: errorMessage(err) }), tone: "danger" });

  const render = async () => {
    const ext = format;
    const path = await save({
      defaultPath: `${target.name}.${ext}`,
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
      title: t("renderSet.saveTitle"),
    });
    if (typeof path !== "string") return;
    await startRender({ ...params(target, o, style), path }, null).catch(fail);
  };
  const preview = (index: number) => {
    if (playing === index) return stopPreview();
    void startRender({ ...params(target, o, style), previewTransition: index }, index).catch(fail);
  };
  const cancel = () => {
    if (running) void request("job.cancel", { jobId: running.jobId }).catch(() => undefined);
  };

  const done = outcome?.status === "done" ? outcome.result : null;
  return (
    <Modal label={t("renderSet.title")} onClose={close} width={600}>
      <div className="flex max-h-[80vh] flex-col">
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-5">
          <div>
            <h2 className="font-display text-title">{t("renderSet.title")}</h2>
            <p className="text-text-2">
              {t("renderSet.intro", { count: target.titles.length, name: target.name })}
            </p>
          </div>

          <fieldset disabled={rendering} className="flex flex-col gap-3">
            <div className={ROW}>
              <span className={LABEL}>{t("renderSet.tempo")}</span>
              <div className="flex items-center gap-2">
                <Segmented<Tempo>
                  size="sm"
                  label={t("renderSet.tempo")}
                  value={o.tempo}
                  onChange={(tempo) => setOptions({ tempo })}
                  options={[
                    { value: "native", label: t("renderSet.tempoNative") },
                    { value: "fixed", label: t("renderSet.tempoFixed") },
                  ]}
                />
                {o.tempo === "fixed" && (
                  <input
                    type="number"
                    min={60}
                    max={200}
                    step={0.01}
                    aria-label={t("renderSet.fixedBpm")}
                    value={o.fixedBpm ?? target.firstBpm ?? 124}
                    onChange={(e) => setOptions({ fixedBpm: Number(e.target.value) || null })}
                    className="h-7 w-20 rounded-sm border border-border bg-surface-3 px-2 font-mono text-text focus:border-primary"
                  />
                )}
              </div>
            </div>
            <p className="-mt-2 text-[12px] text-text-3">
              {t(o.tempo === "native" ? "renderSet.tempoNativeHint" : "renderSet.tempoFixedHint")}
            </p>
            <div className={ROW}>
              <span className={LABEL}>{t("pro.mixPoints.style")}</span>
              <Segmented<MixPointStyle>
                size="sm"
                label={t("pro.mixPoints.style")}
                value={style}
                onChange={(mixPointStyle) => updateSettings.mutate({ mixPointStyle })}
                options={MIX_STYLES.map((value) => ({
                  value,
                  label: t(`pro.mixPoints.styles.${value}`),
                  title: t(`pro.mixPoints.styleHints.${value}`),
                }))}
              />
            </div>
            <div className={ROW}>
              <span className={LABEL}>{t("renderSet.overlap")}</span>
              <Segmented<string>
                size="sm"
                disabled={style === "cut"}
                label={t("renderSet.overlap")}
                value={String(o.overlapBars)}
                onChange={(v) => setOptions({ overlapBars: Number(v) as Overlap })}
                options={[8, 16, 32].map((bars) => ({
                  value: String(bars),
                  label: t("pro.bars", { count: bars }),
                }))}
              />
            </div>
            {hasShifts && (
              <Switch
                checked={o.applyShifts}
                onChange={(applyShifts) => setOptions({ applyShifts })}
                label={t("renderSet.applyShifts")}
              />
            )}
            <Switch
              checked={o.bassSwap}
              onChange={(bassSwap) => setOptions({ bassSwap })}
              label={t("renderSet.bassSwap")}
            />
            <Switch
              checked={o.normalize}
              onChange={(normalize) => setOptions({ normalize })}
              label={t("renderSet.normalize")}
            />
            <div className={ROW}>
              <span className={LABEL}>{t("renderSet.target")}</span>
              <label className="flex items-center gap-2 text-[12px] text-text-2">
                <input
                  type="number"
                  min={-30}
                  max={-6}
                  step={0.5}
                  aria-label={t("renderSet.target")}
                  value={o.targetLufs}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v))
                      setOptions({ targetLufs: Math.min(-6, Math.max(-30, v)) });
                  }}
                  className="h-7 w-16 rounded-sm border border-border bg-surface-3 px-2 font-mono text-text focus:border-primary"
                />
                LUFS
              </label>
            </div>
            <p className="-mt-2 text-[12px] text-text-3">{t("renderSet.targetHint")}</p>
            <div className={ROW}>
              <span className={LABEL}>{t("renderSet.format")}</span>
              <Segmented<Format>
                size="sm"
                label={t("renderSet.format")}
                value={format}
                onChange={(f) => setOptions({ format: f })}
                options={formats.map((f) => ({
                  value: f,
                  label: t(`renderSet.formats.${f}`),
                }))}
              />
            </div>
            <Switch
              checked={o.chapters && format !== "wav"}
              disabled={format === "wav"}
              onChange={(chapters) => setOptions({ chapters })}
              label={t("renderSet.chapters")}
            />
          </fieldset>

          {target.titles.length > 1 && (
            <section aria-label={t("renderSet.transitions")} className="flex flex-col gap-1">
              <h3 className="text-label uppercase text-text-3">{t("renderSet.transitions")}</h3>
              <ul className="flex flex-col divide-y divide-border rounded-md border border-border bg-surface-2">
                {target.titles.slice(0, -1).map((title, i) => {
                  const loading = running?.preview === i;
                  return (
                    <li key={i} className="flex h-9 items-center gap-2 px-3">
                      <button
                        type="button"
                        disabled={rendering || (busy && !loading)}
                        onClick={() => preview(i)}
                        aria-label={t(
                          playing === i ? "renderSet.stopPreview" : "renderSet.preview",
                          {
                            n: i + 1,
                          },
                        )}
                        className="grid size-6 shrink-0 place-items-center rounded-sm text-text-2 hover:text-text disabled:opacity-40"
                      >
                        {loading ? (
                          <Loader2 aria-hidden size={14} className="animate-spin" />
                        ) : playing === i ? (
                          <Square aria-hidden size={12} fill="currentColor" />
                        ) : (
                          <Play aria-hidden size={14} />
                        )}
                      </button>
                      <span className="font-mono text-[12px] text-text-3">{i + 1}</span>
                      <span className="min-w-0 truncate text-control text-text-2">
                        {title} → {target.titles[i + 1]}
                      </span>
                    </li>
                  );
                })}
              </ul>
              {previewError && (
                <p role="alert" className="text-[12px] text-warning">
                  {t("renderSet.previewFailed", { error: previewError })}
                </p>
              )}
            </section>
          )}
        </div>
        {/* Always in view: what the render is doing, its outcome and the buttons. */}
        <div className="flex flex-col gap-3 border-t border-border px-5 py-4">
          {rendering && (
            <div role="status" className="flex flex-col gap-2">
              <div className="flex items-center justify-between text-control text-text-2">
                <span>
                  {running.total
                    ? t("renderSet.progress", { done: running.done, total: running.total })
                    : t("renderSet.preparing")}
                </span>
                <span className="font-mono text-[12px]">{Math.round(running.percent)} %</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-pill bg-surface-3">
                <div
                  className="h-full bg-aurora transition-[width] duration-panel"
                  style={{ width: `${running.percent}%` }}
                />
              </div>
            </div>
          )}

          {done && (
            <div className="flex flex-col gap-2 rounded-md bg-surface-1 p-3" role="status">
              <p className="font-semibold text-text">{t("renderSet.done")}</p>
              <p className="text-control text-text-2">
                {t("renderSet.summary", {
                  count: done.tracks.length,
                  duration: formatDuration(done.duration),
                  lufs: number(done.loudnessLufs),
                  peak: number(done.truePeakDb),
                })}
              </p>
              {done.lowered > 0 && (
                <p className="text-[12px] text-text-3">
                  {t("renderSet.lowered", { count: done.lowered })}
                </p>
              )}
              <p className="truncate font-mono text-[12px] text-text-3" title={done.path}>
                {done.path}
              </p>
              <button
                type="button"
                className={`${BUTTON} self-start`}
                onClick={() => void revealFile(done.path).catch(fail)}
              >
                {t("renderSet.reveal")}
              </button>
            </div>
          )}
          {outcome?.status === "failed" && (
            <p role="alert" className="text-control text-warning">
              {t("renderSet.failed", { error: outcome.error })}
            </p>
          )}
          {outcome?.status === "cancelled" && (
            <p className="text-control text-text-3">{t("renderSet.cancelled")}</p>
          )}

          <div className="flex justify-end gap-2">
            {rendering ? (
              <button type="button" onClick={cancel} className={BUTTON}>
                {t("renderSet.cancel")}
              </button>
            ) : (
              <button type="button" onClick={close} className={BUTTON}>
                {t(done ? "renderSet.close" : "edit.cancel")}
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => void render().catch(fail)}
              className="h-8 rounded-sm bg-primary px-3 font-semibold text-white hover:bg-primary-hover disabled:opacity-40"
            >
              {t("renderSet.render")}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

export function RenderSetDialog() {
  const target = useRenderSet((s) => s.target);
  return target ? <Dialog target={target} /> : null;
}
