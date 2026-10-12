// One deck of the Pro mode (DESIGN 6.9): artwork, title, key / BPM / energy, deck waveform
// with numbered cues and a preview player. Deck A is cyan, deck B coral; for B the key and
// tempo show the change the idea applies ("8A → 10A +2 st", "126.00 → 124.00").
import { convertFileSrc } from "@tauri-apps/api/core";
import { ArrowRight, Pause, Play } from "lucide-react";
import { type ReactNode, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { EnergyMeter } from "../../components/EnergyMeter";
import { KeyChip } from "../../components/KeyChip";
import { asBeatGrid } from "../../lib/beats";
import { fileStem, formatBpm, formatDuration } from "../../lib/format";
import { type Key, makeKey } from "../../lib/keys";
import type { Cue } from "../../lib/rpc.types";
import { useSettings } from "../settings/api";
import { useTrackDetail, useWaveform } from "../track-detail/api";
import { useCueLabel } from "../track-detail/cueLabel";
import { usePlayer } from "../track-detail/usePlayer";
import { WaveformView } from "../track-detail/WaveformView";

export type Side = "a" | "b";

const DECK_COLOR: Record<Side, string> = {
  a: "var(--color-deck-a)",
  b: "var(--color-deck-b)",
};

/** Change applied to deck B by the current idea. */
export interface DeckChange {
  shift: number;
  key: Key;
  /** BPM B plays at (A's tempo, at B's multiple). */
  bpm: number | null;
  /** 0.5, 1 or 2: the multiple of B's tempo compared with A. */
  factor: number;
}

function DataLabel({ children }: { children: ReactNode }) {
  return <span className="text-label uppercase text-text-3">{children}</span>;
}

export function Deck({
  side,
  trackId,
  header,
  change,
}: {
  side: Side;
  trackId: number;
  header?: ReactNode;
  change?: DeckChange | null;
}) {
  const { t } = useTranslation();
  const settings = useSettings();
  const labelOf = useCueLabel();
  const detail = useTrackDetail(trackId);
  const track = detail.data;
  const waveform = useWaveform(track?.waveformPath);
  const player = usePlayer(track?.path);
  const grid = useMemo(() => asBeatGrid(track?.beatGrid), [track?.beatGrid]);
  const cues = useMemo(
    () => [...(track?.cues ?? [])].sort((a, b) => a.slot - b.slot),
    [track?.cues],
  );
  const deckName = t(side === "a" ? "pro.deckA" : "pro.deckB");
  const color = DECK_COLOR[side];

  const jump = (cue: Cue) => {
    player.seek(cue.positionSec);
    player.play();
  };

  const key =
    track?.keyRoot != null && track.keyMode ? makeKey(track.keyRoot, track.keyMode) : null;
  const title = track ? (track.title ?? fileStem(track.path)) : "";
  const shift = change?.shift ?? 0;
  const tempoChanged =
    change?.bpm != null && track?.bpm != null && Math.abs(change.bpm - track.bpm) >= 0.005;

  return (
    <section
      aria-label={track ? `${deckName}: ${title}` : deckName}
      className="flex min-w-0 flex-col gap-3 rounded-md border border-border border-t-2 bg-surface-2 p-4"
      style={{ borderTopColor: color }}
    >
      <div className="flex min-h-11 items-center gap-3">
        <span className="text-label uppercase" style={{ color }}>
          {deckName}
        </span>
        <div className="flex min-w-0 flex-1 items-center justify-end gap-2">{header}</div>
      </div>

      {!track ? (
        <div className="flex h-[220px] items-center justify-center text-text-3" aria-busy>
          {detail.isError ? t("detail.loadFailed") : t("detail.loading")}
        </div>
      ) : (
        <>
          <div className="flex min-w-0 items-center gap-3">
            {track.artworkPath ? (
              <img
                alt=""
                src={convertFileSrc(track.artworkPath)}
                className="size-14 shrink-0 rounded-sm bg-surface-3 object-cover"
              />
            ) : (
              <div aria-hidden className="size-14 shrink-0 rounded-sm bg-surface-3" />
            )}
            <div className="flex min-w-0 flex-col">
              <h2 className="truncate text-section" title={title}>
                {title}
              </h2>
              <span className="truncate text-body text-text-2">
                {track.artist ?? t("library.unknownArtist")}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
            <div className="flex flex-col gap-1">
              <DataLabel>{t("library.columns.key")}</DataLabel>
              {key ? (
                <span className="flex items-center gap-1.5">
                  <KeyChip
                    musicalKey={key}
                    notation={settings.notation}
                    confidence={track.keyConfidence}
                  />
                  {change && shift !== 0 && (
                    <>
                      <ArrowRight aria-hidden size={12} strokeWidth={1.5} className="text-text-3" />
                      <KeyChip musicalKey={change.key} notation={settings.notation} />
                      <span className="font-mono text-[12px] text-text-2">
                        {t("pro.semitones", { value: shift > 0 ? `+${shift}` : `−${-shift}` })}
                      </span>
                    </>
                  )}
                </span>
              ) : (
                <span className="text-text-3">—</span>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <DataLabel>{t("library.columns.bpm")}</DataLabel>
              <span className="flex items-center gap-1.5 font-mono text-data tabular">
                {formatBpm(track.bpm, settings.bpmDecimals)}
                {tempoChanged && (
                  <>
                    <ArrowRight aria-hidden size={12} strokeWidth={1.5} className="text-text-3" />
                    <span aria-label={t("pro.playsAt")}>
                      {formatBpm(change?.bpm, settings.bpmDecimals)}
                    </span>
                  </>
                )}
                {change && change.factor !== 1 && (
                  <span className="rounded-pill bg-surface-3 px-1.5 text-[11px] text-text-2">
                    {change.factor === 0.5 ? "÷2" : "×2"}
                  </span>
                )}
              </span>
            </div>
            {track.energy != null && (
              <div className="flex flex-col gap-1">
                <DataLabel>{t("library.columns.energy")}</DataLabel>
                <EnergyMeter level={track.energy} />
              </div>
            )}
          </div>

          <WaveformView
            waveform={waveform.data}
            duration={track.duration ?? 0}
            time={player.time}
            energy={track.energyCurve ?? []}
            segments={track.segments ?? []}
            cues={track.cues ?? []}
            grid={grid}
            onSeek={player.seek}
            onCueClick={jump}
            height={96}
            playhead={color}
            ruler={false}
            label={t("pro.position", { deck: deckName })}
          />

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              aria-label={t(player.playing ? "pro.pause" : "pro.play", { deck: deckName })}
              onClick={player.toggle}
              className="grid size-8 shrink-0 place-items-center rounded-pill text-black"
              style={{ backgroundColor: color }}
            >
              {player.playing ? (
                <Pause size={14} strokeWidth={1.5} />
              ) : (
                <Play size={14} strokeWidth={1.5} />
              )}
            </button>
            <span className="w-[92px] font-mono text-[12px] tabular text-text-2">
              {formatDuration(player.time)} / {formatDuration(track.duration)}
            </span>
            <div role="group" aria-label={t("pro.cues", { deck: deckName })} className="flex gap-1">
              {Array.from({ length: 8 }, (_, slot) => {
                const cue = cues.find((c) => c.slot === slot);
                const cueColor = cue?.color ?? `var(--color-cue-${slot + 1})`;
                return (
                  <button
                    key={slot}
                    type="button"
                    disabled={!cue}
                    title={cue ? `${labelOf(cue)} · ${formatDuration(cue.positionSec)}` : undefined}
                    aria-label={
                      cue
                        ? t("cues.flag", { n: slot + 1, time: formatDuration(cue.positionSec) })
                        : t("pro.emptyCue", { n: slot + 1 })
                    }
                    onClick={() => cue && jump(cue)}
                    className="grid h-7 w-7 place-items-center rounded-sm border font-mono text-[11px] font-semibold disabled:opacity-30"
                    style={
                      cue
                        ? {
                            borderColor: cueColor,
                            backgroundColor: `color-mix(in srgb, ${cueColor} 22%, transparent)`,
                          }
                        : { borderColor: "var(--color-border)" }
                    }
                  >
                    {slot + 1}
                  </button>
                );
              })}
            </div>
            {player.error && (
              <span role="alert" className="text-[12px] text-warning">
                {t("detail.cannotPlay")}
              </span>
            )}
          </div>
        </>
      )}
    </section>
  );
}
