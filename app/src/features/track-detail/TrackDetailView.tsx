// Track detail (DESIGN 6.5): header with the big musical data, detail waveform with
// energy curve, sections and cues, player with cue jumps, cue pads, the harmonic wheel
// (click a key = library filtered to its compatibles), the verification piano and
// quality chips.
import { Artwork } from "../../components/Artwork";
import { trackKey } from "../../lib/keyStyle";
import {
  ArrowLeft,
  Check,
  Disc3,
  Gauge,
  Pause,
  Pencil,
  Play,
  RotateCcw,
  SkipBack,
  SkipForward,
  TriangleAlert,
} from "lucide-react";
import { useViewStore } from "../navigation/viewStore";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { EnergyMeter } from "../../components/EnergyMeter";
import { KeyChip, keyStates } from "../../components/KeyChip";
import { asBeatGrid, snapToBeat } from "../../lib/beats";
import { fileStem, formatBpm, formatDuration } from "../../lib/format";
import { displayKey, makeKey } from "../../lib/keys";
import type { Cue, TrackDetail } from "../../lib/rpc.types";
import { useLibraryStore } from "../library/store";
import { reanalyze } from "../library/api";
import { describeFailure, errorMessage } from "../../lib/errors";
import { useToastStore } from "../toast/toastStore";
import { useSettings } from "../settings/api";
import { Piano } from "../piano/Piano";
import { StemsPanel } from "../stems/StemsUi";
import { HarmonicWheel } from "../wheel/HarmonicWheel";
import { useCueMutations, useTrackDetail, useWaveform } from "./api";
import { CuePads } from "./CuePads";
import { usePlayer } from "./usePlayer";
import { cueStep } from "../player/cueStep";
import { WaveformView } from "./WaveformView";
import { ownsKey } from "../../lib/keyboard";

function BigData({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-[120px] flex-col gap-1.5">
      <span className="text-label uppercase text-text-3">{label}</span>
      {children}
    </div>
  );
}

function QualityChips({ track }: { track: TrackDetail }) {
  const { t, i18n } = useTranslation();
  const flags = new Set(track.qualityFlags ?? []);
  const num = (n: number, digits = 1) =>
    new Intl.NumberFormat(i18n.language, {
      maximumFractionDigits: digits,
      minimumFractionDigits: digits,
    }).format(n);
  const chips: { ok: boolean; text: string }[] = [];
  if (track.bitrate)
    chips.push({
      ok: !flags.has("low_bitrate"),
      text: t("quality.chips.bitrate", { kbps: track.bitrate }),
    });
  if (track.loudnessLufs != null)
    chips.push({
      ok: !flags.has("quiet"),
      text: t("quality.chips.lufs", { value: num(track.loudnessLufs) }),
    });
  if (track.clippingRatio != null) {
    chips.push(
      flags.has("clipping")
        ? {
            ok: false,
            text: t("quality.chips.clipping", { value: num(track.clippingRatio * 100, 2) }),
          }
        : { ok: true, text: t("quality.chips.noClipping") },
    );
  }
  if (flags.has("fake_hq") && track.cutoffHz)
    chips.push({
      ok: false,
      text: t("quality.chips.cutoff", { value: num(track.cutoffHz / 1000) }),
    });
  if (flags.has("silence_start"))
    chips.push({
      ok: false,
      text: t("quality.chips.silenceStart", { value: num(track.silenceStart ?? 0) }),
    });
  if (flags.has("silence_end"))
    chips.push({
      ok: false,
      text: t("quality.chips.silenceEnd", { value: num(track.silenceEnd ?? 0) }),
    });
  if (!chips.length) return null;
  return (
    <section aria-label={t("quality.title")} className="flex flex-wrap items-center gap-2">
      <h2 className="mr-1 text-section">{t("quality.title")}</h2>
      {chips.map(({ ok, text }) => (
        <span
          key={text}
          className={`inline-flex h-6 items-center gap-1 rounded-pill border px-2.5 text-[12px] ${ok ? "border-border bg-surface-2 text-text-2" : "border-warning/60 bg-warning/15 text-text"}`}
        >
          {text}
          {ok ? (
            <Check
              aria-label={t("quality.ok")}
              size={12}
              strokeWidth={2}
              className="text-success"
            />
          ) : (
            <Gauge
              aria-label={t("quality.warning")}
              size={12}
              strokeWidth={2}
              className="text-warning"
            />
          )}
        </span>
      ))}
    </section>
  );
}

export function TrackDetailView({ trackId, onBack }: { trackId: number; onBack: () => void }) {
  const { t, i18n } = useTranslation();
  const settings = useSettings();
  const detail = useTrackDetail(trackId);
  const track = detail.data;
  const waveform = useWaveform(track?.waveformPath);
  const player = usePlayer(track);
  const mutations = useCueMutations(trackId);
  const grid = useMemo(() => asBeatGrid(track?.beatGrid), [track?.beatGrid]);
  const duration = track?.duration ?? 0;
  const cues = useMemo(
    () => [...(track?.cues ?? [])].sort((a, b) => a.positionSec - b.positionSec),
    [track?.cues],
  );
  const snap = useCallback((time: number) => snapToBeat(grid, time, duration), [grid, duration]);

  // Once the big header scrolls away (wheel, piano, stems), the top bar keeps the title,
  // key, BPM and transport in view.
  const scroller = useRef<HTMLDivElement>(null);
  const hero = useRef<HTMLDivElement>(null);
  const [heroHidden, setHeroHidden] = useState(false);
  const loaded = track != null;
  useEffect(() => {
    const target = hero.current;
    if (!loaded || !target || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => setHeroHidden(entry ? !entry.isIntersecting : false),
      { root: scroller.current, threshold: 0 },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [loaded]);

  const jump = useCallback(
    (cue: Cue) => {
      player.play(cue.positionSec);
    },
    [player],
  );
  const neighbourCue = (direction: 1 | -1) => {
    const target = cueStep(cues, player.time, direction);
    if (target !== null) player.play(target);
  };

  // Shortcuts (SPEC 2.14): space = play/pause, 1-8 = jump to cue, Escape = back.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // A panel, menu or dialog on top closes first.
        if (
          e.defaultPrevented ||
          document.querySelector("[role=dialog]") ||
          useViewStore.getState().infoTrackId != null
        )
          return;
        e.preventDefault();
        onBack();
        return;
      }
      if (ownsKey(e)) return;
      if (e.key === " ") {
        e.preventDefault();
        player.toggle();
      } else if (/^[1-8]$/.test(e.key)) {
        const cue = track?.cues?.find((c) => c.slot === Number(e.key) - 1);
        if (cue) {
          e.preventDefault();
          jump(cue);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [player, jump, track?.cues, onBack]);

  if (!track) {
    return (
      <section className="flex flex-1 items-center justify-center text-text-3" aria-busy>
        {detail.isError ? t("detail.loadFailed") : t("detail.loading")}
      </section>
    );
  }

  const title = track.title ?? fileStem(track.path);
  const key = track.keyRoot != null && track.keyMode ? makeKey(track.keyRoot, track.keyMode) : null;
  const edited = new Set(track.editedFields ?? []);
  const meta = [track.album, track.year, track.label].filter(Boolean).join(" · ");
  const percent = (n: number) =>
    new Intl.NumberFormat(i18n.language, { style: "percent" }).format(n);

  const stemsAndQuality = (
    <>
      <StemsPanel
        trackId={trackId}
        duration={track.duration ?? null}
        vocalPresence={track.vocalPresence ?? null}
        vocalSource={track.vocalSource ?? null}
      />
      <QualityChips track={track} />
    </>
  );
  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label={title}>
      <header
        data-tauri-drag-region
        className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-5"
      >
        <button
          type="button"
          onClick={onBack}
          className="flex h-8 items-center gap-1.5 rounded-sm px-2 text-text-2 hover:bg-surface-2 hover:text-text"
        >
          <ArrowLeft size={16} strokeWidth={1.5} />
          {t("detail.back")}
        </button>
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {heroHidden && (
            <div className="flex min-w-0 items-center gap-3 motion-safe:animate-[fade-in_150ms_var(--ease-out)]">
              <button
                type="button"
                aria-label={player.playing ? t("detail.pause") : t("detail.play")}
                onClick={player.toggle}
                className="grid size-7 shrink-0 place-items-center rounded-pill bg-primary text-white hover:bg-primary-hover"
              >
                {player.playing ? (
                  <Pause size={14} strokeWidth={1.5} />
                ) : (
                  <Play size={14} strokeWidth={1.5} />
                )}
              </button>
              <span className="truncate font-semibold" title={title}>
                {title}
              </span>
              {key && (
                <KeyChip musicalKey={key} notation={settings.notation} {...keyStates(track)} />
              )}
              {track.bpm != null && (
                <span className="shrink-0 font-mono text-data tabular text-text-2">
                  {formatBpm(track.bpm, settings.bpmDecimals)}
                </span>
              )}
              <span className="shrink-0 font-mono text-[12px] tabular text-text-3">
                {formatDuration(player.time)}
              </span>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => useViewStore.getState().openInfo(trackId)}
          className="flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-sm border border-border bg-surface-3 px-3 text-text hover:border-border-strong"
        >
          <Pencil size={14} strokeWidth={1.5} />
          {t("info.open")}
        </button>
        {track.keyRoot != null && track.bpm != null && (
          <button
            type="button"
            onClick={() => useViewStore.getState().openPro(trackId)}
            className="flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-sm bg-accent-fill px-3 font-semibold text-white hover:opacity-90"
          >
            <Disc3 size={14} strokeWidth={1.5} />
            {t("pro.open")}
          </button>
        )}
      </header>
      <div ref={scroller} className="min-h-0 flex-1 overflow-auto px-6 py-5">
        <div className="flex flex-col gap-6">
          {track.status === "error" && <AnalysisFailed track={track} />}
          <div ref={hero} className="flex flex-wrap items-start gap-6">
            <Artwork
              path={track.artworkPath}
              musicalKey={trackKey(track)}
              size={120}
              className="size-[120px] rounded-md"
            />
            <div className="flex min-w-0 flex-1 flex-col gap-1 pt-2">
              <h1 className="truncate font-display text-title" title={title}>
                {title}
              </h1>
              <div className="truncate text-section font-normal text-text-2">
                {track.artist ?? t("library.unknownArtist")}
              </div>
              {meta && <div className="truncate text-body text-text-3">{meta}</div>}
            </div>
            <div className="flex flex-wrap gap-8 pt-2">
              <BigData label={t("library.columns.key")}>
                {key ? (
                  <>
                    <span className="origin-left scale-125">
                      <KeyChip
                        musicalKey={key}
                        notation={settings.notation}
                        confidence={track.keyConfidence}
                        edited={edited.has("key")}
                      />
                    </span>
                    {track.keyConfidence != null && (
                      <span className="text-[12px] text-text-2">
                        {t("detail.confidence", { value: percent(track.keyConfidence) })}
                      </span>
                    )}
                    {track.keyAlternatives && track.keyAlternatives.length > 0 && (
                      <span className="text-[12px] text-text-3">
                        {t("detail.alternatives", {
                          keys: track.keyAlternatives
                            .map((k) => displayKey(makeKey(k.root, k.mode), settings.notation))
                            .join(", "),
                        })}
                      </span>
                    )}
                    {track.keySecondary && (
                      <span className="text-[12px] text-text-2">
                        {t("detail.keyChange", {
                          key: displayKey(
                            makeKey(track.keySecondary.root, track.keySecondary.mode),
                            settings.notation,
                          ),
                          time: formatDuration(track.keySecondaryStart ?? 0),
                        })}
                      </span>
                    )}
                  </>
                ) : (
                  <span className="text-text-3">—</span>
                )}
              </BigData>
              <BigData label={t("library.columns.bpm")}>
                <span className="font-mono text-data-lg tabular">
                  {track.bpm == null ? "—" : formatBpm(track.bpm, settings.bpmDecimals)}
                </span>
                {grid?.kind === "variable" && (
                  <span className="text-[12px] text-text-3">{t("detail.variableTempo")}</span>
                )}
              </BigData>
              <BigData label={t("library.columns.energy")}>
                {track.energy == null ? (
                  <span className="text-text-3">—</span>
                ) : (
                  <EnergyMeter level={track.energy} size="large" />
                )}
              </BigData>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <WaveformView
              waveform={waveform.data}
              duration={duration}
              time={player.time}
              energy={track.energyCurve ?? []}
              segments={track.segments ?? []}
              cues={track.cues ?? []}
              grid={grid}
              onSeek={player.seek}
              onMoveCue={(cue, position) =>
                mutations.set.mutate({
                  slot: cue.slot,
                  positionSec: position,
                  label: cue.label ?? null,
                  color: cue.color ?? null,
                })
              }
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label={t("detail.previousCue")}
                onClick={() => neighbourCue(-1)}
                className="grid size-8 place-items-center rounded-sm text-text-2 hover:bg-surface-2 hover:text-text"
              >
                <SkipBack size={16} strokeWidth={1.5} />
              </button>
              <button
                type="button"
                aria-label={player.playing ? t("detail.pause") : t("detail.play")}
                onClick={player.toggle}
                className="grid size-9 place-items-center rounded-pill bg-primary text-white hover:bg-primary-hover"
              >
                {player.playing ? (
                  <Pause size={16} strokeWidth={1.5} />
                ) : (
                  <Play size={16} strokeWidth={1.5} />
                )}
              </button>
              <button
                type="button"
                aria-label={t("detail.nextCue")}
                onClick={() => neighbourCue(1)}
                className="grid size-8 place-items-center rounded-sm text-text-2 hover:bg-surface-2 hover:text-text"
              >
                <SkipForward size={16} strokeWidth={1.5} />
              </button>
              <span className="font-mono text-data tabular text-text-2">
                {formatDuration(player.time)} / {formatDuration(duration)}
              </span>
              {player.error && (
                <span role="alert" className="text-[12px] text-warning">
                  {t("detail.cannotPlay")}
                </span>
              )}
            </div>
          </div>

          <CuePads
            cues={track.cues ?? []}
            time={player.time}
            snap={snap}
            onJump={jump}
            onSet={(slot, position, label, color) =>
              mutations.set.mutate({ slot, positionSec: position, label, color })
            }
            onDelete={(cue) => mutations.remove.mutate(cue)}
            onReset={() => mutations.reset.mutate()}
          />
          {key && (
            <section aria-labelledby="detail-wheel" className="flex flex-wrap gap-x-12 gap-y-6">
              <div className="flex flex-col gap-2">
                <h2 id="detail-wheel" className="text-section">
                  {t("wheel.title")}
                </h2>
                <p className="max-w-[320px] text-[12px] text-text-3">{t("wheel.hint")}</p>
                <HarmonicWheel
                  current={key}
                  notation={settings.notation}
                  legend
                  onPick={(picked) => {
                    useLibraryStore.getState().setFilter({
                      keys: [{ root: picked.root, mode: picked.mode }],
                      compatible: true,
                    });
                    useViewStore.getState().show("library");
                  }}
                />
              </div>
              {/* min-w-0 + basis: the piano's long hint wraps instead of pushing the
                  piano under the wheel at the narrowest window. */}
              <div className="flex min-w-[420px] flex-1 basis-[420px] flex-col gap-2">
                <h2 className="text-section">{t("piano.title")}</h2>
                <Piano
                  musicalKey={key}
                  notation={settings.notation}
                  withTrack={{
                    checked: player.playing,
                    onChange: (on) => (on ? player.play() : player.pause()),
                  }}
                />
                {/* Under the piano, beside the taller wheel, rather than below both:
                    the column would otherwise end in an empty block. */}
                <div className="mt-6 flex flex-col gap-6">{stemsAndQuality}</div>
              </div>
            </section>
          )}
          {!key && stemsAndQuality}
        </div>
      </div>
    </section>
  );
}

/** The analysis of this track failed: why, and a way to try again (SPEC 3). */
function AnalysisFailed({ track }: { track: TrackDetail }) {
  const { id: trackId, error } = track;
  const { t } = useTranslation();
  return (
    <div
      role="alert"
      className="flex items-center gap-3 rounded-md border border-danger/40 bg-surface-1 px-4 py-3"
    >
      <TriangleAlert aria-hidden size={18} strokeWidth={1.5} className="shrink-0 text-danger" />
      <div className="min-w-0 flex-1">
        <div className="font-medium">{t("analysis.trackFailed")}</div>
        {error && <div className="text-control text-text-2">{describeFailure(track)}</div>}
      </div>
      <button
        type="button"
        onClick={() =>
          void reanalyze([trackId]).catch((err: unknown) =>
            useToastStore.getState().push({
              title: t("analysis.failed", { error: errorMessage(err) }),
              tone: "danger",
            }),
          )
        }
        className="flex h-8 shrink-0 items-center gap-1.5 rounded-sm border border-border bg-surface-3 px-3 text-text hover:border-border-strong"
      >
        <RotateCcw aria-hidden size={14} strokeWidth={1.5} />
        {t("analysis.retry")}
      </button>
    </div>
  );
}
