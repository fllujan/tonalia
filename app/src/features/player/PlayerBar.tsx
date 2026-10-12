// Bottom player (DESIGN, Layout: 72 px): artwork · title · transport · mini waveform ·
// key · BPM · energy. It appears once a track is played from the table and stays while the
// DJ browses; it hides in Pro (the decks have their own transport; the track pauses) and in
// the detail view of the same track (which shows the full transport).
import { Pause, Play, SkipBack, SkipForward, X } from "lucide-react";
import { Artwork } from "../../components/Artwork";
import { trackKey } from "../../lib/keyStyle";
import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { EnergyMeter } from "../../components/EnergyMeter";
import { KeyChip } from "../../components/KeyChip";
import { asBeatGrid } from "../../lib/beats";
import { fileStem, formatBpm, formatDuration } from "../../lib/format";
import { ownsKey } from "../../lib/keyboard";
import { makeKey } from "../../lib/keys";
import { useViewStore } from "../navigation/viewStore";
import { useSettings } from "../settings/api";
import { useTrackDetail, useWaveform } from "../track-detail/api";
import { WaveformView } from "../track-detail/WaveformView";
import { cueStep } from "./cueStep";
import { closePlayer, loadTrack, pause, seek, togglePlayback, usePlayerStore } from "./playerStore";

const ICON_BUTTON =
  "grid size-8 shrink-0 place-items-center rounded-sm text-text-2 hover:bg-surface-2 hover:text-text";

export function PlayerBar() {
  const track = usePlayerStore((s) => s.track);
  const view = useViewStore((s) => s.view);
  const detailId = useViewStore((s) => s.trackId);
  const hidden = !track || view === "pro" || (view === "detail" && detailId === track.id);

  // Pro shows no library transport: a track left playing there could not be stopped.
  // It stays loaded, so the bar offers to carry on back in the library.
  useEffect(() => {
    if (view === "pro") pause();
  }, [view]);

  // Space plays/pauses the loaded track wherever no screen or control claims the key
  // (the table plays its focused row; the detail view and Pro have their own transport).
  useEffect(() => {
    if (!track || view === "detail" || view === "pro") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== " " || ownsKey(e)) return;
      e.preventDefault();
      togglePlayback();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [track, view]);

  return hidden ? null : <Bar trackId={track.id} />;
}

function Bar({ trackId }: { trackId: number }) {
  const { t } = useTranslation();
  const settings = useSettings();
  const track = usePlayerStore((s) => s.track);
  const playing = usePlayerStore((s) => s.playing);
  const time = usePlayerStore((s) => s.time);
  const error = usePlayerStore((s) => s.error);
  const openDetail = useViewStore((s) => s.openDetail);
  const detail = useTrackDetail(trackId).data;
  const waveform = useWaveform(detail?.waveformPath);
  const grid = useMemo(() => asBeatGrid(detail?.beatGrid), [detail?.beatGrid]);
  if (!track) return null;

  const title = track.title ?? fileStem(track.path);
  const artist = track.artist ?? t("library.unknownArtist");
  const duration = detail?.duration ?? track.duration ?? 0;
  const key =
    detail?.keyRoot != null && detail.keyMode != null
      ? makeKey(detail.keyRoot, detail.keyMode)
      : null;
  const cues = detail?.cues ?? [];
  const step = (direction: 1 | -1) => {
    const target = cueStep(cues, time, direction);
    if (target !== null) loadTrack(track, { play: true, at: target });
  };

  return (
    <section
      aria-label={t("player.label")}
      className="flex h-[72px] shrink-0 items-center gap-4 border-t border-border bg-surface-1 px-5 motion-safe:animate-[toast-in_220ms_var(--ease-out)]"
    >
      <button
        type="button"
        onClick={() => openDetail(trackId)}
        title={t("player.openDetail")}
        className="-ml-1 flex w-[200px] min-w-0 xl:w-[260px] shrink-0 items-center gap-3 rounded-sm p-1 text-left hover:bg-surface-2"
      >
        <Artwork
          path={track.artworkPath}
          musicalKey={detail ? trackKey(detail) : null}
          size={44}
          className="size-11 rounded-sm"
        />
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-medium">{title}</span>
          <span className="truncate text-[12px] text-text-2">{artist}</span>
        </span>
      </button>

      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          aria-label={t("detail.previousCue")}
          onClick={() => step(-1)}
          className={ICON_BUTTON}
        >
          <SkipBack size={16} strokeWidth={1.5} />
        </button>
        <button
          type="button"
          aria-label={playing ? t("detail.pause") : t("detail.play")}
          onClick={() => togglePlayback()}
          className="grid size-9 shrink-0 place-items-center rounded-pill bg-primary text-white hover:bg-primary-hover"
        >
          {playing ? <Pause size={16} strokeWidth={1.5} /> : <Play size={16} strokeWidth={1.5} />}
        </button>
        <button
          type="button"
          aria-label={t("detail.nextCue")}
          disabled={cueStep(cues, time, 1) === null}
          onClick={() => step(1)}
          className={`${ICON_BUTTON} disabled:opacity-40 disabled:hover:bg-transparent`}
        >
          <SkipForward size={16} strokeWidth={1.5} />
        </button>
      </div>

      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span className="shrink-0 font-mono text-[12px] text-text-2">{formatDuration(time)}</span>
        <div className="min-w-0 flex-1">
          {error ? (
            <p role="alert" className="text-[12px] text-warning">
              {t("detail.cannotPlay")}
            </p>
          ) : (
            <WaveformView
              waveform={waveform.data}
              duration={duration}
              time={time}
              energy={[]}
              segments={detail?.segments ?? []}
              cues={cues}
              grid={grid}
              onSeek={(at) => seek(at)}
              onCueClick={(cue) => loadTrack(track, { play: true, at: cue.positionSec })}
              height={40}
              ruler={false}
              sectionLabels={false}
              label={t("detail.position")}
            />
          )}
        </div>
        <span className="shrink-0 font-mono text-[12px] text-text-3">
          {formatDuration(duration)}
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        {key && (
          <KeyChip
            musicalKey={key}
            notation={settings.notation}
            confidence={detail?.keyConfidence ?? null}
          />
        )}
        {detail?.bpm != null && (
          <span className="font-mono font-medium">
            {formatBpm(detail.bpm, settings.bpmDecimals)}
          </span>
        )}
        {detail?.energy != null && <EnergyMeter level={detail.energy} />}
      </div>

      <button
        type="button"
        aria-label={t("player.close")}
        onClick={closePlayer}
        className={`${ICON_BUTTON} -mr-1 text-text-3`}
      >
        <X size={16} strokeWidth={1.5} />
      </button>
    </section>
  );
}
