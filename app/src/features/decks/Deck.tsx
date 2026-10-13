// One deck of the Pro mode (DESIGN 6.9): artwork, title, key / BPM / energy, deck waveform
// with numbered cues, cue pads and volume. Playback goes through the synchronized player.
// Deck A is cyan, deck B coral. The key and tempo show the change applied to the deck
// ("8A → 10A +2 st", "126.00 → 124.00"): A's own key change; for B, the idea's plus the user's.
// Each deck picks its stem (Track | Vocals | Instrumental, the waveform takes the stem
// colour) and a loop of 1–32 bars or a free one, shaded on the waveform.
import { keyStates } from "../../components/KeyChip";
import { ShiftedKey } from "../../components/ShiftedKey";
import { ArrowRight, Layers, Loader2, Play, Square, Volume2 } from "lucide-react";
import { Artwork } from "../../components/Artwork";
import { type ReactNode, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { EnergyMeter } from "../../components/EnergyMeter";
import { Segmented } from "../../components/Segmented";
import { SemitoneStepper } from "../../components/SemitoneStepper";
import { asBeatGrid } from "../../lib/beats";
import { fileStem, formatBpm, formatDuration } from "../../lib/format";
import { type Key, makeKey } from "../../lib/keys";
import { SHORT_WINDOW, useMediaQuery } from "../../lib/useMediaQuery";
import type { Cue } from "../../lib/rpc.types";
import { useSettings } from "../settings/api";
import { cancelStemJob, requestSeparation, useStemsStatus } from "../stems/api";
import { useStemsStore } from "../stems/stemsStore";
import { useTrackDetail, useWaveform } from "../track-detail/api";
import { useCueLabel } from "../track-detail/cueLabel";
import { WaveformView } from "../track-detail/WaveformView";
import { DECK_STEMS, type DeckStem } from "./decksStore";
import { LOOP_BARS, type LoopLength, type LoopRegion } from "./segments";
import { player, usePlaybackStore } from "./syncPlayer";
import { useDeckTime } from "./useDeckTime";
import { inkOf } from "../../lib/keyStyle";

export type Side = "a" | "b";

const DECK_COLOR: Record<Side, string> = {
  a: "var(--color-deck-a)",
  b: "var(--color-deck-b)",
};

/** Playback controls the studio gives each deck. */
export interface DeckActions {
  /** Where the deck plays from (original seconds); shown as the playhead when silent. */
  anchor: number;
  /** Click on the waveform: move the anchor (snapped to the bar by the studio). */
  onAnchor: (time: number) => void;
  /** Click on a cue: play that segment synchronized with the other deck. */
  onCue: (cue: Cue) => void;
  /** Play this deck alone from its anchor. */
  onPlay: () => void;
  /** The loop playing now (shaded), and its setting. */
  loop: LoopRegion | null;
  loopLength: LoopLength | null;
  onLoop: (length: LoopLength | null) => void;
  /** Chosen stem, and whether the track's stems are separated. */
  stem: DeckStem;
  stemsReady: boolean;
  onStem: (stem: DeckStem) => void;
}

const STEM_TINT: Record<DeckStem, string | undefined> = {
  mix: undefined,
  vocals: "--color-stem-vocals",
  instrumental: "--color-stem-instrumental",
};

/** Separate the deck's stems, or follow the separation, while it plays the full track. */
function StemsMissing({ trackId }: { trackId: number }) {
  const { t } = useTranslation();
  const settings = useSettings();
  const status = useStemsStatus().data;
  const separation = useStemsStore((s) => s.separation);
  const mine = separation?.trackIds.includes(trackId) ? separation : null;
  const percent = Math.round(mine?.percent ?? 0);
  return (
    <div className="flex flex-wrap items-center gap-2 text-[12px] text-text-2">
      {mine ? (
        <>
          <span
            role="progressbar"
            aria-label={t("stems.separatingLabel")}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            className="size-4 shrink-0 rounded-full"
            style={{
              background: `conic-gradient(var(--color-primary) ${percent * 3.6}deg, var(--color-surface-3) 0deg)`,
            }}
          />
          <span>{t("pro.separating", { percent })}</span>
          <button
            type="button"
            onClick={() => void cancelStemJob(mine.jobId)}
            className="ml-1 text-text-3 underline hover:text-text"
          >
            {t("edit.cancel")}
          </button>
        </>
      ) : (
        <>
          <span>{t("pro.noStems")}</span>
          <button
            type="button"
            disabled={separation != null}
            title={separation != null ? t("pro.separateBusy") : undefined}
            onClick={() => requestSeparation([trackId], status, settings.stemModel)}
            className="flex h-7 items-center gap-1.5 rounded-sm border border-border bg-surface-3 px-2.5 text-text hover:border-border-strong disabled:opacity-40"
          >
            <Layers aria-hidden size={14} strokeWidth={1.5} />
            {t("stems.separate")}
          </button>
        </>
      )}
    </div>
  );
}

/** Semitone stepper of the deck (±6). */
export interface DeckPitch {
  value: number;
  min: number;
  max: number;
  /** Not at its resting point: 0 for A, the idea's shift for B. */
  resettable: boolean;
  onChange: (value: number) => void;
  onReset: () => void;
}

/** Change applied to the deck: A's key change; for B, the idea's plus the user's. */
export interface DeckChange {
  shift: number;
  key: Key;
  /** BPM B plays at (A's tempo, at B's multiple); null = its own. */
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
  pitch,
  actions,
  focus,
}: {
  side: Side;
  trackId: number;
  header?: ReactNode;
  change?: DeckChange | null;
  pitch?: DeckPitch;
  actions?: DeckActions;
  /** DJ Mix: the outro (A) or intro (B) the transition uses, brought forward. */
  focus?: { start: number; end: number } | null;
}) {
  const { t } = useTranslation();
  const short = useMediaQuery(SHORT_WINDOW);
  const settings = useSettings();
  const labelOf = useCueLabel();
  const detail = useTrackDetail(trackId);
  const track = detail.data;
  const waveform = useWaveform(track?.waveformPath);
  const live = useDeckTime(side);
  const time = live ?? actions?.anchor ?? 0;
  const playing = live != null;
  const loading = usePlaybackStore(
    (st) =>
      st.status === "loading" && (st.kind === side || st.kind === "mashup" || st.kind === "mix"),
  );
  const gain = usePlaybackStore((st) => st.gains[side]);
  const grid = useMemo(() => asBeatGrid(track?.beatGrid), [track?.beatGrid]);
  const cues = useMemo(
    () => [...(track?.cues ?? [])].sort((a, b) => a.slot - b.slot),
    [track?.cues],
  );
  const deckName = t(side === "a" ? "pro.deckA" : "pro.deckB");
  const color = DECK_COLOR[side];

  const jump = (cue: Cue) => actions?.onCue(cue);

  const key =
    track?.keyRoot != null && track.keyMode ? makeKey(track.keyRoot, track.keyMode) : null;
  const title = track ? (track.title ?? fileStem(track.path)) : "";
  const shift = change?.shift ?? 0;
  const tempoChanged =
    change?.bpm != null && track?.bpm != null && Math.abs(change.bpm - track.bpm) >= 0.005;

  return (
    <section
      aria-label={track ? `${deckName}: ${title}` : deckName}
      className="relative flex min-w-0 flex-col gap-3 rounded-md border border-border bg-surface-2 p-4 short:gap-2 short:p-3"
    >
      {/* The deck's colour as a lit strip along the top edge, inset so it clears the corners. */}
      <span
        aria-hidden
        className="absolute inset-x-4 top-[-1px] h-0.5 rounded-b-pill"
        style={{ backgroundColor: color }}
      />
      <div className="flex min-h-11 items-center gap-3">
        <span className="text-label uppercase" style={{ color: inkOf(color) }}>
          {deckName}
        </span>
        {track && (
          <label className="flex items-center gap-1.5 text-text-3">
            <Volume2 aria-hidden size={14} strokeWidth={1.5} />
            <input
              type="range"
              min={0}
              max={1.5}
              step={0.01}
              value={gain}
              onChange={(e) => player.setGain(side, Number(e.target.value))}
              aria-label={t("pro.volumeOf", { deck: deckName })}
              title={t("pro.volumeOf", { deck: deckName })}
              className="h-6 w-16"
              style={{ accentColor: color }}
            />
          </label>
        )}
        <div className="flex min-w-0 flex-1 items-center justify-end gap-2">{header}</div>
      </div>

      {!track ? (
        <div className="flex h-[220px] items-center justify-center text-text-3" aria-busy>
          {detail.isError ? t("detail.loadFailed") : t("detail.loading")}
        </div>
      ) : (
        <>
          <div className="flex min-w-0 items-center gap-3">
            <Artwork
              path={track.artworkPath}
              musicalKey={key}
              size={short ? 44 : 56}
              className="size-14 rounded-sm short:size-11"
            />
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
                <ShiftedKey
                  original={key}
                  shift={change ? shift : 0}
                  notation={settings.notation}
                  {...keyStates(track)}
                />
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
            {pitch && (
              <div className="ml-auto flex flex-col gap-1">
                <DataLabel>{t("pro.pitch")}</DataLabel>
                <SemitoneStepper
                  {...pitch}
                  label={t("pro.pitchOf", { deck: deckName })}
                  color={color}
                />
              </div>
            )}
          </div>

          {actions && (
            <div className="flex flex-wrap items-center gap-3">
              <Segmented
                size="sm"
                value={actions.stem}
                options={DECK_STEMS.map((v) => ({ value: v, label: t(`pro.stems.${v}`) }))}
                onChange={actions.onStem}
                label={t("pro.stemOf", { deck: deckName })}
              />
              <label className="flex items-center gap-2 text-[12px] text-text-3">
                {t("pro.loop")}
                <select
                  value={actions.loopLength ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    actions.onLoop(
                      v === "" ? null : v === "free" ? "free" : (Number(v) as LoopLength),
                    );
                  }}
                  aria-label={t("pro.loopOf", { deck: deckName })}
                  className="h-7 rounded-sm border border-border bg-surface-3 px-1.5 text-[12px] text-text"
                >
                  <option value="">{t("pro.loopOff")}</option>
                  {LOOP_BARS.map((n) => (
                    <option key={n} value={n}>
                      {t("pro.bars", { count: n })}
                    </option>
                  ))}
                  <option value="free">{t("pro.loopFree")}</option>
                </select>
              </label>
              {actions.loopLength === "free" && (
                <span className="text-[12px] text-text-3">{t("pro.loopFreeHint")}</span>
              )}
            </div>
          )}
          {/* Over the bottom right of the waveform (its top holds the cue flags), not in
              a row of its own: a row would make this deck taller than the other. */}
          <div className="relative">
            {actions && actions.stem !== "mix" && !actions.stemsReady && (
              <div className="absolute bottom-2 right-1 z-10 rounded-sm border border-border bg-surface-2/95 px-2 py-1 shadow-overlay">
                <StemsMissing trackId={trackId} />
              </div>
            )}

            <WaveformView
              waveform={waveform.data}
              duration={track.duration ?? 0}
              time={time}
              energy={track.energyCurve ?? []}
              segments={track.segments ?? []}
              cues={track.cues ?? []}
              grid={grid}
              onSeek={(at) => actions?.onAnchor(at)}
              onCueClick={jump}
              height={short ? 72 : 96}
              playhead={color}
              ruler={false}
              label={t("pro.position", { deck: deckName })}
              loop={actions?.loop ?? null}
              focus={focus ?? null}
              tint={actions?.stemsReady ? STEM_TINT[actions.stem] : undefined}
            />
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label={t(playing ? "pro.stop" : "pro.play", { deck: deckName })}
              disabled={!actions}
              onClick={() => (playing ? player.stop() : actions?.onPlay())}
              className="grid size-8 shrink-0 place-items-center rounded-pill text-on-key disabled:opacity-40"
              style={{ backgroundColor: color }}
            >
              {loading ? (
                <Loader2 aria-hidden size={14} strokeWidth={1.5} className="animate-spin" />
              ) : playing ? (
                <Square size={12} strokeWidth={1.5} fill="currentColor" />
              ) : (
                <Play size={14} strokeWidth={1.5} />
              )}
            </button>
            <span className="w-[92px] font-mono text-[12px] tabular text-text-2">
              {formatDuration(time)} / {formatDuration(track.duration)}
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
                        ? t("pro.cuePlay", { n: slot + 1, time: formatDuration(cue.positionSec) })
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
          </div>
        </>
      )}
    </section>
  );
}
