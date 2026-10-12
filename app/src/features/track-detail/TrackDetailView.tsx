// Track detail (DESIGN 6.5): header with the big musical data, detail waveform with
// energy curve, sections and cues, player with cue jumps, cue pads, the harmonic wheel
// (click a key = library filtered to its compatibles), the verification piano and
// quality chips.
import { convertFileSrc } from "@tauri-apps/api/core";
import {
  ArrowLeft,
  Check,
  Pause,
  Pencil,
  Play,
  SkipBack,
  SkipForward,
  TriangleAlert,
} from "lucide-react";
import { useViewStore } from "../navigation/viewStore";
import { type ReactNode, useCallback, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { EnergyMeter } from "../../components/EnergyMeter";
import { KeyChip } from "../../components/KeyChip";
import { asBeatGrid, snapToBeat } from "../../lib/beats";
import { fileStem, formatBpm, formatDuration } from "../../lib/format";
import { formatKey, makeKey } from "../../lib/keys";
import type { Cue, TrackDetail } from "../../lib/rpc.types";
import { useLibraryStore } from "../library/store";
import { useSettings } from "../settings/api";
import { Piano } from "../piano/Piano";
import { StemsPanel } from "../stems/StemsUi";
import { HarmonicWheel } from "../wheel/HarmonicWheel";
import { useCueMutations, useTrackDetail, useWaveform } from "./api";
import { CuePads } from "./CuePads";
import { usePlayer } from "./usePlayer";
import { WaveformView } from "./WaveformView";

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
            <TriangleAlert
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
  const player = usePlayer(track?.path);
  const mutations = useCueMutations(trackId);
  const grid = useMemo(() => asBeatGrid(track?.beatGrid), [track?.beatGrid]);
  const duration = track?.duration ?? 0;
  const cues = useMemo(
    () => [...(track?.cues ?? [])].sort((a, b) => a.positionSec - b.positionSec),
    [track?.cues],
  );
  const snap = useCallback((time: number) => snapToBeat(grid, time, duration), [grid, duration]);

  const jump = useCallback(
    (cue: Cue) => {
      player.seek(cue.positionSec);
      player.play();
    },
    [player],
  );
  const neighbourCue = (direction: 1 | -1) => {
    const now = player.time + (direction === 1 ? 0.05 : -0.5);
    const list = direction === 1 ? cues : [...cues].reverse();
    const next = list.find((c) => (direction === 1 ? c.positionSec > now : c.positionSec < now));
    if (next) jump(next);
    else if (direction === -1) player.seek(0);
  };

  // Shortcuts (SPEC 2.14): space = play/pause, 1-8 = jump to cue.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        e.defaultPrevented ||
        target?.closest("input, textarea, select, [role=dialog]") ||
        e.metaKey ||
        e.ctrlKey ||
        e.altKey
      )
        return;
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
  }, [player, jump, track?.cues]);

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
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => useViewStore.getState().openInfo(trackId)}
          className="flex h-8 items-center gap-1.5 rounded-sm border border-border bg-surface-3 px-3 text-text hover:border-border-strong"
        >
          <Pencil size={14} strokeWidth={1.5} />
          {t("info.open")}
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-auto px-6 py-5">
        <div className="flex flex-col gap-6">
          <div className="flex flex-wrap items-start gap-6">
            {track.artworkPath ? (
              <img
                alt=""
                src={convertFileSrc(track.artworkPath)}
                className="size-[120px] rounded-md bg-surface-3 object-cover"
              />
            ) : (
              <div aria-hidden className="size-[120px] rounded-md bg-surface-3" />
            )}
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
                            .map((k) => formatKey(makeKey(k.root, k.mode), settings.notation))
                            .join(", "),
                        })}
                      </span>
                    )}
                    {track.keySecondary && (
                      <span className="text-[12px] text-text-2">
                        {t("detail.keyChange", {
                          key: formatKey(
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
            onDelete={(slot) => mutations.remove.mutate(slot)}
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
              <div className="flex flex-col gap-2">
                <h2 className="text-section">{t("piano.title")}</h2>
                <Piano
                  musicalKey={key}
                  notation={settings.notation}
                  withTrack={{
                    checked: player.playing,
                    onChange: (on) => (on ? player.play() : player.pause()),
                  }}
                />
              </div>
            </section>
          )}
          <StemsPanel
            trackId={trackId}
            vocalPresence={track.vocalPresence ?? null}
            vocalSource={track.vocalSource ?? null}
          />
          <QualityChips track={track} />
        </div>
      </div>
    </section>
  );
}
