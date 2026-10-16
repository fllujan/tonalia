// "Revisar cues" (SPEC 12.5, DESIGN 6.18): a focus screen, one cue at a time and fully
// usable from the keyboard. Each automatic cue plays for 8 bars and the DJ answers
// "Correct / Misplaced / One is missing here" with a key; a misplaced cue can be put right
// on the spot. The answers make the accuracy report (no titles or paths).
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Check,
  Crosshair,
  MapPinPlus,
  Pause,
  Play,
  RotateCcw,
  SkipForward,
  Undo2,
  X,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Artwork } from "../../components/Artwork";
import { EmptyState } from "../../components/EmptyState";
import { asBeatGrid, snapToDownbeat } from "../../lib/beats";
import { errorMessage } from "../../lib/errors";
import { fileStem, formatCount, formatDuration } from "../../lib/format";
import { trackKey } from "../../lib/keyStyle";
import { MOD } from "../../lib/keyboard";
import { request } from "../../lib/rpc";
import type { Cue, CueReviewItem, CueReviewReport } from "../../lib/rpc.types";
import { libraryKeys } from "../library/api";
import { useViewStore } from "../navigation/viewStore";
import { loadTrack, pause, seek, togglePlayback, usePlayerStore } from "../player/playerStore";
import { useToastStore } from "../toast/toastStore";
import { detailKey, useTrackDetail, useWaveform } from "../track-detail/api";
import { useCueLabel } from "../track-detail/cueLabel";
import { WaveformView } from "../track-detail/WaveformView";
import { cueReviewKeys, LISTEN_BARS, useReviewQueue, useReviewReport, useVerdicts } from "./api";

interface Step {
  track: number; // index in the batch
  cue: number; // index in the track's cues
  reviewId: number | null; // the verdict given there (null: skipped)
}

export function CueReviewView() {
  const { t, i18n } = useTranslation();
  const trackIds = useViewStore((s) => s.reviewTrackIds);
  const close = useViewStore((s) => s.closeCueReview);
  const report = useReviewReport().data;
  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label={t("cueReview.title")}>
      <header
        data-tauri-drag-region
        className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-5"
      >
        <button
          type="button"
          onClick={close}
          className="flex h-8 items-center gap-1.5 rounded-sm px-2 text-text-2 hover:bg-surface-2 hover:text-text"
        >
          <ArrowLeft size={16} strokeWidth={1.5} />
          {t("detail.back")}
        </button>
        <h1 className="font-display text-title">{t("cueReview.title")}</h1>
        {report && report.accuracy != null && (
          <span className="ml-auto text-control text-text-2">
            {t("cueReview.summary", {
              count: report.reviewedCues,
              n: formatCount(report.reviewedCues, i18n.language),
              percent: new Intl.NumberFormat(i18n.language, { style: "percent" }).format(
                report.accuracy,
              ),
            })}
          </span>
        )}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-[880px] flex-col gap-6 px-6 py-8">
          <Review trackIds={trackIds} onClose={close} />
          {report && report.reviewedCues > 0 && <ReportPanel report={report} />}
        </div>
      </div>
    </section>
  );
}

function Review({ trackIds, onClose }: { trackIds: number[] | null; onClose: () => void }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const queue = useReviewQueue(trackIds);
  const verdicts = useVerdicts();
  const push = useToastStore((s) => s.push);
  const [pos, setPos] = useState({ track: 0, cue: 0 });
  const [history, setHistory] = useState<Step[]>([]);
  const [correcting, setCorrecting] = useState(false);
  const items = useMemo(() => queue.data?.items ?? [], [queue.data]);
  const item = items[pos.track];
  // Leaving the screen stops the excerpt.
  useEffect(() => () => pause(), []);

  const advance = useCallback(() => {
    setCorrecting(false);
    setPos((p) => {
      const cues = items[p.track]?.cues.length ?? 0;
      if (p.cue + 1 < cues) return { track: p.track, cue: p.cue + 1 };
      return { track: p.track + 1, cue: 0 };
    });
  }, [items]);

  const give = useCallback(
    (verdict: "ok" | "wrong") => {
      const cue = item?.cues[pos.cue];
      if (!item || !cue) return;
      const step = { ...pos };
      verdicts.set.mutate(
        { trackId: item.track.id, slot: cue.slot, verdict },
        {
          onSuccess: (r) => setHistory((h) => [...h, { ...step, reviewId: r.reviewId }]),
          onError: (e) =>
            push({ tone: "danger", title: t("cueReview.failed"), detail: errorMessage(e) }),
        },
      );
      if (verdict === "wrong") setCorrecting(true);
      else advance();
    },
    [advance, item, pos, push, t, verdicts.set],
  );

  const markMissing = useCallback(
    (at: number) => {
      if (!item) return;
      // A cue within a bar already marks that change: nothing is missing there.
      const bar = item.barSeconds || 2;
      if (item.cues.some((c) => Math.abs(c.positionSec - at) < bar - 1e-3)) {
        push({ tone: "neutral", title: t("cueReview.missingHasCue") });
        return;
      }
      verdicts.set.mutate(
        { trackId: item.track.id, verdict: "missing", positionSec: at },
        {
          onSuccess: (r) => {
            setHistory((h) => [...h, { ...pos, reviewId: r.reviewId }]);
            push({
              tone: "neutral",
              title: t("cueReview.missingMarked", { time: formatDuration(at) }),
            });
          },
          onError: (e) =>
            push({ tone: "danger", title: t("cueReview.failed"), detail: errorMessage(e) }),
        },
      );
    },
    [item, pos, push, t, verdicts.set],
  );

  const undo = useCallback(() => {
    const last = history.at(-1);
    if (!last) return;
    if (last.reviewId != null) verdicts.remove.mutate(last.reviewId);
    setHistory((h) => h.slice(0, -1));
    setCorrecting(false);
    setPos({ track: last.track, cue: last.cue });
  }, [history, verdicts.remove]);

  const skip = useCallback(() => {
    setHistory((h) => [...h, { ...pos, reviewId: null }]);
    advance();
  }, [advance, pos]);

  if (queue.isLoading) return null;
  if (!item) {
    const reviewedSome = history.some((s) => s.reviewId != null);
    return (
      <EmptyState
        title={t(reviewedSome ? "cueReview.doneTitle" : "cueReview.emptyTitle")}
        text={t(reviewedSome ? "cueReview.doneText" : "cueReview.emptyText")}
        action={
          trackIds == null && reviewedSome ? (
            <button
              type="button"
              onClick={() => {
                setPos({ track: 0, cue: 0 });
                setHistory([]);
                void client.invalidateQueries({ queryKey: cueReviewKeys.queue(null) });
              }}
              className="h-8 rounded-sm bg-primary px-3 font-semibold text-white hover:bg-primary-hover"
            >
              {t("cueReview.more")}
            </button>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="h-8 rounded-sm border border-border bg-surface-3 px-3 hover:border-border-strong"
            >
              {t("detail.back")}
            </button>
          )
        }
      />
    );
  }
  return (
    <ReviewCard
      key={`${item.track.id}-${pos.cue}`}
      item={item}
      cueIndex={pos.cue}
      trackNumber={pos.track + 1}
      tracks={items.length}
      correcting={correcting}
      onVerdict={give}
      onMissing={markMissing}
      onSkip={skip}
      onNext={advance}
      onUndo={history.length ? undo : null}
      onMoved={() => {
        void client.invalidateQueries({ queryKey: detailKey(item.track.id) });
        void client.invalidateQueries({ queryKey: libraryKeys.all });
      }}
    />
  );
}

function ReviewCard({
  item,
  cueIndex,
  trackNumber,
  tracks,
  correcting,
  onVerdict,
  onMissing,
  onSkip,
  onNext,
  onUndo,
  onMoved,
}: {
  item: CueReviewItem;
  cueIndex: number;
  trackNumber: number;
  tracks: number;
  correcting: boolean;
  onVerdict: (verdict: "ok" | "wrong") => void;
  onMissing: (at: number) => void;
  onSkip: () => void;
  onNext: () => void;
  onUndo: (() => void) | null;
  onMoved: () => void;
}) {
  const { t } = useTranslation();
  const cueLabel = useCueLabel();
  const push = useToastStore((s) => s.push);
  const { track } = item;
  const detail = useTrackDetail(track.id).data;
  const waveform = useWaveform(detail?.waveformPath);
  const grid = useMemo(() => asBeatGrid(detail?.beatGrid), [detail?.beatGrid]);
  const duration = track.duration ?? 0;
  // A cue moved while correcting is drawn where it was put.
  const [moved, setMoved] = useState<number | null>(null);
  const base = item.cues[cueIndex] as Cue;
  const cue: Cue = moved == null ? base : { ...base, positionSec: moved, source: "user" };
  const start = base.positionSec;
  const end = Math.min(duration || Infinity, start + LISTEN_BARS * (item.barSeconds || 2));

  const loaded = usePlayerStore((s) => s.track?.id === track.id);
  const playing = usePlayerStore((s) => s.playing && s.track?.id === track.id);
  const time = usePlayerStore((s) => (s.track?.id === track.id ? s.time : start));
  const replay = useCallback(
    () => loadTrack(track, { play: true, at: cue.positionSec }),
    [track, cue.positionSec],
  );
  // Each cue starts playing as it appears.
  useEffect(() => {
    loadTrack(track, { play: true, at: start });
  }, [track, start]);
  // …and stops after 8 bars (unless the DJ is placing a cue).
  useEffect(() => {
    if (playing && !correcting && time >= end) pause();
  }, [playing, correcting, time, end]);

  const place = useCallback(
    (at: number) => {
      const position = snapToDownbeat(grid, at, duration);
      setMoved(position);
      void request("cues.set", {
        trackId: track.id,
        slot: base.slot,
        positionSec: position,
        label: base.label ?? null,
        color: base.color ?? null,
      }).then(onMoved, (e: unknown) =>
        push({ tone: "danger", title: t("cues.failed", { error: errorMessage(e) }) }),
      );
    },
    [base, duration, grid, onMoved, push, t, track.id],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest("input, textarea, select, [role=dialog]")) return;
      // On the waveform, the arrows move the playhead.
      if (e.key.startsWith("Arrow") && target?.closest("[role=slider]")) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        onUndo?.();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      let handled = true;
      if (e.key === " ") {
        if (!loaded || (!playing && time >= end)) replay();
        else togglePlayback();
      } else if (correcting && (e.key === "Enter" || e.key === "ArrowRight")) onNext();
      else if (correcting && e.key.toLowerCase() === "f") place(time);
      else if (!correcting && (e.key === "1" || e.key === "Enter")) onVerdict("ok");
      else if (!correcting && e.key === "2") onVerdict("wrong");
      else if (e.key === "3") onMissing(snapToDownbeat(grid, time, duration));
      else if (!correcting && e.key === "ArrowRight") onSkip();
      else if (e.key === "Backspace") onUndo?.();
      else handled = false;
      if (handled) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    correcting,
    duration,
    end,
    grid,
    loaded,
    onMissing,
    onNext,
    onSkip,
    onUndo,
    onVerdict,
    place,
    playing,
    replay,
    time,
  ]);

  const title = track.title ?? fileStem(track.path);
  const elapsed = Math.max(0, Math.min(end - start, time - start));
  const verdict = item.verdicts[String(base.slot)];
  return (
    <article
      aria-label={t("cueReview.cueOf", { n: cueIndex + 1, total: item.cues.length })}
      className="flex flex-col gap-5 rounded-md border border-border bg-surface-2 p-6 shadow-card"
    >
      <div className="flex items-center gap-4">
        <Artwork
          path={track.artworkPath}
          musicalKey={trackKey(track)}
          size={64}
          className="size-16 rounded-md"
        />
        <div className="min-w-0 flex-1">
          <div className="text-[12px] text-text-3">
            {t("cueReview.position", {
              track: trackNumber,
              tracks,
              cue: cueIndex + 1,
              cues: item.cues.length,
            })}
          </div>
          <h2 className="truncate font-display text-title" title={title}>
            {title}
          </h2>
          <div className="truncate text-control text-text-2">
            {track.artist ?? t("library.unknownArtist")}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className="flex items-center gap-2">
            <span
              className="grid h-5 min-w-5 place-items-center rounded-r-[3px] px-1 font-mono text-[11px] font-semibold text-on-key"
              style={{ backgroundColor: base.color ?? `var(--color-cue-${base.slot + 1})` }}
            >
              {base.slot + 1}
            </span>
            <span className="font-semibold">{cueLabel(base)}</span>
            <span className="font-mono text-data tabular text-text-2">
              {formatDuration(base.positionSec)}
            </span>
          </span>
          {verdict && (
            <span className="text-[12px] text-text-3">
              {t("cueReview.already", { verdict: t(`cueReview.verdicts.${verdict}`) })}
            </span>
          )}
        </div>
      </div>

      <WaveformView
        waveform={waveform.data}
        duration={duration}
        time={time}
        energy={[]}
        segments={item.segments}
        cues={item.cues.map((c) => (c.slot === cue.slot ? cue : c))}
        grid={grid}
        focus={{ start, end }}
        onSeek={(at) => (loaded ? seek(at) : loadTrack(track, { play: false, at }))}
        {...(correcting ? { onMoveCue: (_: Cue, at: number) => place(at) } : {})}
        height={96}
        label={t("cueReview.waveform")}
      />

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => (!loaded || (!playing && time >= end) ? replay() : togglePlayback())}
          aria-label={t(playing ? "detail.pause" : "detail.play")}
          className="grid size-9 place-items-center rounded-pill bg-primary text-white hover:bg-primary-hover"
        >
          {playing ? <Pause size={16} strokeWidth={1.5} /> : <Play size={16} strokeWidth={1.5} />}
        </button>
        <span className="font-mono text-data tabular text-text-2">
          {t("cueReview.bars", {
            bar: Math.min(LISTEN_BARS, Math.floor(elapsed / (item.barSeconds || 2)) + 1),
            total: LISTEN_BARS,
          })}
        </span>
        <button
          type="button"
          onClick={replay}
          className="flex h-8 items-center gap-1.5 rounded-sm px-2 text-text-2 hover:bg-surface-3 hover:text-text"
        >
          <RotateCcw size={14} strokeWidth={1.5} aria-hidden />
          {t("cueReview.replay")}
        </button>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={onUndo ?? undefined}
            disabled={!onUndo}
            aria-label={t("cueReview.undo")}
            title={`${t("cueReview.undo")} (${MOD}Z)`}
            className="grid size-8 place-items-center rounded-sm text-text-2 hover:bg-surface-3 hover:text-text disabled:opacity-40"
          >
            <Undo2 size={16} strokeWidth={1.5} />
          </button>
        </div>
      </div>

      {correcting ? (
        <div className="flex flex-col gap-3 rounded-md border border-warning/50 bg-warning/10 p-4">
          <p className="text-body">{t("cueReview.correctHint")}</p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => place(time)}
              className="flex h-8 items-center gap-1.5 rounded-sm border border-border bg-surface-3 px-3 hover:border-border-strong"
            >
              <Crosshair size={14} strokeWidth={1.5} aria-hidden />
              {t("cueReview.placeHere")}
              <kbd className="font-mono text-[11px] text-text-3">F</kbd>
            </button>
            {moved != null && (
              <span className="text-[12px] text-text-2">
                {t("cueReview.movedTo", { time: formatDuration(moved) })}
              </span>
            )}
            <button
              type="button"
              onClick={onNext}
              className="ml-auto flex h-8 items-center gap-1.5 rounded-sm bg-primary px-3 font-semibold text-white hover:bg-primary-hover"
            >
              {t("cueReview.next")}
              <kbd className="font-mono text-[11px] text-white/70">↵</kbd>
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <h3 className="text-section">{t("cueReview.question")}</h3>
          <div className="grid grid-cols-3 gap-3">
            <Answer
              keyLabel="1"
              icon={<Check size={18} strokeWidth={1.75} className="text-success" />}
              label={t("cueReview.verdicts.ok")}
              hint={t("cueReview.okHint")}
              onClick={() => onVerdict("ok")}
            />
            <Answer
              keyLabel="2"
              icon={<X size={18} strokeWidth={1.75} className="text-danger" />}
              label={t("cueReview.verdicts.wrong")}
              hint={t("cueReview.wrongHint")}
              onClick={() => onVerdict("wrong")}
            />
            <Answer
              keyLabel="3"
              icon={<MapPinPlus size={18} strokeWidth={1.75} className="text-info" />}
              label={t("cueReview.verdicts.missing")}
              hint={t("cueReview.missingHint")}
              onClick={() => onMissing(snapToDownbeat(grid, time, duration))}
            />
          </div>
          <div className="flex items-center justify-between text-[12px] text-text-3">
            <span>{t("cueReview.keys", { mod: MOD })}</span>
            <button
              type="button"
              onClick={onSkip}
              className="flex h-7 items-center gap-1 rounded-sm px-2 text-text-2 hover:bg-surface-3 hover:text-text"
            >
              <SkipForward size={14} strokeWidth={1.5} aria-hidden />
              {t("cueReview.skip")}
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

function Answer({
  keyLabel,
  icon,
  label,
  hint,
  onClick,
}: {
  keyLabel: string;
  icon: ReactNode;
  label: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[72px] flex-col items-start gap-1 rounded-md border border-border bg-surface-3 px-4 py-3 text-left hover:border-border-strong"
    >
      <span className="flex w-full items-center gap-2 font-semibold">
        {icon}
        {label}
        <kbd className="ml-auto font-mono text-[11px] text-text-3">{keyLabel}</kbd>
      </span>
      <span className="text-[12px] text-text-2">{hint}</span>
    </button>
  );
}

/** What the answers say so far: share of correct cues and failures by section. */
function ReportPanel({ report }: { report: CueReviewReport }) {
  const { t, i18n } = useTranslation();
  const percent = (v: number) =>
    new Intl.NumberFormat(i18n.language, { style: "percent" }).format(v);
  return (
    <section
      aria-labelledby="cue-report"
      className="flex flex-col gap-3 rounded-md border border-border bg-surface-1 p-5"
    >
      <div className="flex items-baseline gap-3">
        <h2 id="cue-report" className="text-section">
          {t("cueReview.report.title")}
        </h2>
        {report.accuracy != null && (
          <span
            className={`font-mono text-data-lg tabular ${report.accuracy >= 0.8 ? "text-success" : "text-warning"}`}
          >
            {percent(report.accuracy)}
          </span>
        )}
        <span className="text-[12px] text-text-3">
          {t("cueReview.report.line", {
            cues: formatCount(report.reviewedCues, i18n.language),
            tracks: formatCount(report.tracks, i18n.language),
            missing: formatCount(report.missing, i18n.language),
          })}
        </span>
      </div>
      <p className="text-[12px] text-text-2">{t("cueReview.report.goal")}</p>
      <table className="w-full text-control">
        <thead className="text-left text-label uppercase text-text-3">
          <tr>
            <th className="py-1 font-semibold">{t("cueReview.report.section")}</th>
            <th className="py-1 text-right font-semibold">{t("cueReview.report.reviewed")}</th>
            <th className="py-1 text-right font-semibold">{t("cueReview.report.wrong")}</th>
            <th className="py-1 text-right font-semibold">{t("cueReview.report.missing")}</th>
          </tr>
        </thead>
        <tbody>
          {report.bySection.map((row) => (
            <tr key={row.label} className="border-t border-border">
              <td className="py-1.5">{t(`sections.${row.label}`, { defaultValue: row.label })}</td>
              <td className="py-1.5 text-right font-mono tabular">{row.reviewed}</td>
              <td className="py-1.5 text-right font-mono tabular">{row.wrong}</td>
              <td className="py-1.5 text-right font-mono tabular">{row.missing}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
