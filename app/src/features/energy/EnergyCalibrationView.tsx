// "Calibrar energía" (SPEC 12.2, DESIGN 7.3): a focus screen, one question at a time and
// fully usable from the keyboard. Each track plays 20 s from its drop and the DJ rates it
// 1–10 (keys 1–9, 0 = 10). The level Tonalia gives it is not shown, so it does not steer
// the answer. With enough ratings the model is fitted and the MAE before → after is shown
// before anything changes; the import tab reads levels already written in the tags.
import { ArrowLeft, Pause, Play, RotateCcw, SkipForward, Undo2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Artwork } from "../../components/Artwork";
import { EmptyState } from "../../components/EmptyState";
import { SegmentThumb } from "../../components/SegmentThumb";
import { errorMessage } from "../../lib/errors";
import { fileStem, formatCount, formatDuration } from "../../lib/format";
import { makeKey } from "../../lib/keys";
import type { EnergyQueueItem, EnergyStatus } from "../../lib/rpc.types";
import { useViewStore } from "../navigation/viewStore";
import { loadTrack, pause, togglePlayback, usePlayerStore } from "../player/playerStore";
import { useToastStore } from "../toast/toastStore";
import {
  energyKeys,
  ratingFromKey,
  useCalibrate,
  useEnergyStatus,
  useRate,
  useRatingQueue,
  useRevert,
} from "./api";
import { ImportPanel } from "./ImportPanel";
import { useQueryClient } from "@tanstack/react-query";

export const EXCERPT_SECONDS = 20;
const TABS = ["listen", "import"] as const;
type Tab = (typeof TABS)[number];

export function EnergyCalibrationView() {
  const { t } = useTranslation();
  const back = useViewStore((s) => s.closeDetail);
  const [tab, setTab] = useState<Tab>("listen");
  const status = useEnergyStatus().data;
  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label={t("energyCal.title")}>
      <header
        data-tauri-drag-region
        className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-5"
      >
        <button
          type="button"
          onClick={back}
          className="flex h-8 items-center gap-1.5 rounded-sm px-2 text-text-2 hover:bg-surface-2 hover:text-text"
        >
          <ArrowLeft size={16} strokeWidth={1.5} />
          {t("detail.back")}
        </button>
        <h1 className="font-display text-title">{t("energyCal.title")}</h1>
        <div
          role="tablist"
          aria-label={t("energyCal.title")}
          className="relative ml-4 flex gap-0.5 rounded-[7px] border border-border bg-bg p-0.5"
        >
          <SegmentThumb />
          {TABS.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={`h-[26px] rounded-[5px] px-3 text-control transition-colors duration-hover ${tab === id ? "bg-surface-3 text-text" : "text-text-3 hover:text-text"}`}
            >
              {t(`energyCal.tabs.${id}`)}
            </button>
          ))}
        </div>
        {status && (
          <span className="ml-auto text-control text-text-2">
            {t(status.model === "personal" ? "energyCal.modelPersonal" : "energyCal.modelDefault")}
          </span>
        )}
      </header>
      {status && <Progress status={status} />}
      <div
        role="tabpanel"
        aria-label={t(`energyCal.tabs.${tab}`)}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        <div className="mx-auto flex max-w-[720px] flex-col gap-6 px-6 py-8">
          {status && <CalibratePanel status={status} />}
          {tab === "listen" ? <RatePanel status={status} /> : <ImportPanel />}
        </div>
      </div>
    </section>
  );
}

/** "12 of 30 ratings" and a bar, until there are enough to calibrate. */
function Progress({ status }: { status: EnergyStatus }) {
  const { t, i18n } = useTranslation();
  const done = Math.min(status.usable, status.needed);
  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-border px-5 py-2.5">
      <span className="text-control text-text-2">
        {status.usable >= status.needed
          ? t("energyCal.enough", {
              count: status.usable,
              n: formatCount(status.usable, i18n.language),
            })
          : t("energyCal.progress", {
              count: status.needed,
              done: formatCount(status.usable, i18n.language),
              needed: formatCount(status.needed, i18n.language),
            })}
      </span>
      <div
        role="progressbar"
        aria-label={t("energyCal.progressLabel")}
        aria-valuemin={0}
        aria-valuemax={status.needed}
        aria-valuenow={done}
        className="h-1 w-40 overflow-hidden rounded-pill bg-surface-3"
      >
        <div
          className="h-full rounded-pill bg-primary"
          style={{ width: `${(100 * done) / status.needed}%` }}
        />
      </div>
      {status.needsReanalysis > 0 && (
        <span className="ml-auto text-[12px] text-text-3">
          {t("energyCal.needsReanalysis", {
            count: status.needsReanalysis,
            n: formatCount(status.needsReanalysis, i18n.language),
          })}
        </span>
      )}
    </div>
  );
}

function RatePanel({ status }: { status: EnergyStatus | undefined }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const queue = useRatingQueue();
  const rate = useRate();
  const push = useToastStore((s) => s.push);
  const [index, setIndex] = useState(0);
  const [history, setHistory] = useState<{ index: number; trackId: number }[]>([]);
  const items = queue.data?.items ?? [];
  const item = items[index];
  // Leaving the tab (or the screen) stops the excerpt.
  useEffect(() => () => pause(), []);

  const [refreshing, setRefreshing] = useState(false);

  /** The next track; after the last of the batch, a new batch once `saved` is stored. */
  const next = useCallback(
    (saved?: Promise<unknown>) => {
      if (index + 1 < items.length) {
        setIndex(index + 1);
        return;
      }
      // The batch is done: ask for more once the last rating is saved, so neither it nor
      // the first track (already rated) shows again while the new batch arrives.
      setRefreshing(true);
      void Promise.resolve(saved)
        .catch(() => undefined)
        .then(() => client.invalidateQueries({ queryKey: energyKeys.queue }))
        .finally(() => {
          setIndex(0);
          setHistory([]);
          setRefreshing(false);
        });
    },
    [client, index, items.length],
  );

  const give = useCallback(
    (rating: number) => {
      if (!item || refreshing) return;
      const saved = rate.mutateAsync({ trackId: item.track.id, rating }).catch((e: unknown) => {
        push({ tone: "danger", title: t("energyCal.rateFailed"), detail: errorMessage(e) });
      });
      setHistory((h) => [...h, { index, trackId: item.track.id }]);
      next(saved);
    },
    [index, item, next, push, rate, refreshing, t],
  );

  const undo = useCallback(() => {
    const last = history.at(-1);
    if (!last) return;
    rate.mutate({ trackId: last.trackId, rating: null });
    setHistory((h) => h.slice(0, -1));
    setIndex(last.index);
  }, [history, rate]);

  if (queue.isLoading || refreshing) return null;
  if (!item)
    return (
      <EmptyState
        title={t("energyCal.emptyTitle")}
        text={t(status?.needsReanalysis ? "energyCal.emptyReanalyse" : "energyCal.emptyText")}
      />
    );
  return (
    <RateCard
      key={item.track.id}
      item={item}
      position={index + 1}
      total={items.length}
      onRate={give}
      onSkip={() => next()}
      onUndo={history.length ? undo : null}
    />
  );
}

function RateCard({
  item,
  position,
  total,
  onRate,
  onSkip,
  onUndo,
}: {
  item: EnergyQueueItem;
  position: number;
  total: number;
  onRate: (rating: number) => void;
  onSkip: () => void;
  onUndo: (() => void) | null;
}) {
  const { t } = useTranslation();
  const { track, start } = item;
  const end = start + EXCERPT_SECONDS;
  const loaded = usePlayerStore((s) => s.track?.id === track.id);
  const playing = usePlayerStore((s) => s.playing && s.track?.id === track.id);
  const time = usePlayerStore((s) => (s.track?.id === track.id ? s.time : start));
  const [chosen, setChosen] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const musicalKey =
    track.keyRoot != null && track.keyMode ? makeKey(track.keyRoot, track.keyMode) : null;

  const replay = useCallback(() => loadTrack(track, { play: true, at: start }), [track, start]);
  // Each track starts playing as it appears, from its drop.
  useEffect(() => {
    replay();
    ref.current?.focus();
  }, [replay]);
  // The excerpt stops after 20 s.
  useEffect(() => {
    if (playing && time >= end) pause();
  }, [playing, time, end]);

  const choose = (rating: number) => {
    setChosen(rating);
    onRate(rating);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && onUndo) {
        e.preventDefault();
        onUndo();
      }
      return;
    }
    const rating = ratingFromKey(e.key);
    if (rating != null) {
      e.preventDefault();
      choose(rating);
    } else if (e.key === " ") {
      e.preventDefault();
      if (!loaded || time >= end) replay();
      else togglePlayback();
    } else if (e.key === "ArrowRight" || e.key.toLowerCase() === "s") {
      e.preventDefault();
      onSkip();
    } else if (e.key === "Backspace" && onUndo) {
      e.preventDefault();
      onUndo();
    } else if (e.key.toLowerCase() === "r") {
      e.preventDefault();
      replay();
    }
  };

  const elapsed = Math.min(EXCERPT_SECONDS, Math.max(0, time - start));
  return (
    <div
      ref={ref}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      aria-label={t("energyCal.question")}
      className="flex flex-col gap-6 rounded-md border border-border bg-surface-2 p-6 shadow-card outline-none"
    >
      <div className="flex items-center gap-4">
        <Artwork
          path={track.artworkPath}
          musicalKey={musicalKey}
          size={96}
          className="h-24 w-24 rounded-md"
        />
        <div className="min-w-0 flex-1">
          <p className="text-[12px] text-text-3">{t("energyCal.position", { position, total })}</p>
          <h2 className="truncate font-display text-title" title={track.title ?? undefined}>
            {track.title || fileStem(track.path)}
          </h2>
          <p className="truncate text-control text-text-2">
            {[track.artist, track.genre].filter(Boolean).join(" · ")}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => (!loaded || time >= end ? replay() : togglePlayback())}
          aria-label={t(playing ? "detail.pause" : "detail.play")}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-pill border border-border bg-surface-3 text-text hover:border-border-strong"
        >
          {playing ? <Pause size={16} strokeWidth={1.5} /> : <Play size={16} strokeWidth={1.5} />}
        </button>
        <div className="h-1 flex-1 overflow-hidden rounded-pill bg-surface-3" aria-hidden>
          <div
            className="h-full rounded-pill bg-primary"
            style={{ width: `${(100 * elapsed) / EXCERPT_SECONDS}%` }}
          />
        </div>
        <span className="font-mono text-data tabular text-text-2">
          {formatDuration(start + elapsed)}
        </span>
        <button
          type="button"
          onClick={replay}
          className="flex h-8 items-center gap-1.5 rounded-sm px-2 text-control text-text-2 hover:bg-surface-3 hover:text-text"
        >
          <RotateCcw size={14} strokeWidth={1.5} />
          {t("energyCal.replay")}
        </button>
      </div>

      <div className="flex flex-col gap-3">
        <h3 className="text-section">{t("energyCal.question")}</h3>
        <div role="radiogroup" aria-label={t("energyCal.question")} className="flex gap-1.5">
          {Array.from({ length: 10 }, (_, i) => i + 1).map((level) => (
            <button
              key={level}
              type="button"
              role="radio"
              aria-checked={chosen === level}
              aria-label={t("energy.label", { level })}
              aria-keyshortcuts={level === 10 ? "0" : String(level)}
              onClick={() => choose(level)}
              className={`group flex h-16 flex-1 flex-col items-center justify-end gap-2 rounded-sm border pb-2 font-mono text-data transition-colors duration-hover ${chosen === level ? "border-primary bg-primary-soft text-text" : "border-border bg-surface-3 text-text-2 hover:border-border-strong hover:text-text"}`}
            >
              <span
                aria-hidden
                className="w-2 rounded-[1px]"
                style={{
                  height: `${8 + level * 2}px`,
                  backgroundColor: `var(--color-energy-${level})`,
                }}
              />
              {level}
            </button>
          ))}
        </div>
        <p className="text-[12px] text-text-3">{t("energyCal.keys")}</p>
      </div>

      <div className="flex items-center gap-2 border-t border-border pt-4">
        <button
          type="button"
          onClick={onSkip}
          className="flex h-8 items-center gap-1.5 rounded-sm border border-border bg-surface-3 px-3 text-control hover:border-border-strong"
        >
          <SkipForward size={14} strokeWidth={1.5} />
          {t("energyCal.skip")}
        </button>
        {onUndo && (
          <button
            type="button"
            onClick={onUndo}
            className="flex h-8 items-center gap-1.5 rounded-sm px-2 text-control text-text-2 hover:bg-surface-3 hover:text-text"
          >
            <Undo2 size={14} strokeWidth={1.5} />
            {t("energyCal.undo")}
          </button>
        )}
        <span className="ml-auto text-[12px] text-text-3">{t("energyCal.pauseAnytime")}</span>
      </div>
    </div>
  );
}

/**
 * Once there are enough ratings: fit the model, show the MAE before → after, and apply
 * it only if the DJ says so. With the personal model active, the way back is here too.
 */
function CalibratePanel({ status }: { status: EnergyStatus }) {
  const { t, i18n } = useTranslation();
  const calibrate = useCalibrate();
  const revert = useRevert();
  const push = useToastStore((s) => s.push);
  const [proposal, setProposal] = useState<{
    before: number;
    after: number;
    tracks: number;
  } | null>(null);
  const mae = (v: number) =>
    new Intl.NumberFormat(i18n.language, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 2,
    }).format(v);
  const fail = (e: unknown) =>
    push({ tone: "danger", title: t("energyCal.calibrateFailed"), detail: errorMessage(e) });

  const personal = status.model === "personal" ? status.calibration : null;
  const ready = status.usable >= status.needed;
  if (!ready && !personal) return null;

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-surface-2 p-5 shadow-card">
      {personal && !proposal && (
        <div className="flex flex-wrap items-center gap-3">
          <p className="min-w-0 flex-1 text-control text-text-2">
            {t("energyCal.personalActive", {
              count: personal.tracks,
              before: mae(personal.maeBefore),
              after: mae(personal.maeAfter),
            })}
          </p>
          <button
            type="button"
            disabled={revert.isPending}
            onClick={() =>
              revert.mutate(undefined, {
                onSuccess: (r) =>
                  push({
                    tone: "success",
                    title: t("energyCal.reverted", {
                      count: r.updated,
                      n: formatCount(r.updated, i18n.language),
                    }),
                  }),
                onError: fail,
              })
            }
            className="h-8 rounded-sm border border-border bg-surface-3 px-3 text-control hover:border-border-strong disabled:opacity-40"
          >
            {t("energyCal.revert")}
          </button>
        </div>
      )}
      {ready && !proposal && (
        <div className="flex flex-wrap items-center gap-3">
          <p className="min-w-0 flex-1 text-control">
            {t(personal != null ? "energyCal.recalibrateHint" : "energyCal.calibrateHint", {
              count: status.usable,
              n: formatCount(status.usable, i18n.language),
            })}
          </p>
          <button
            type="button"
            disabled={calibrate.isPending}
            onClick={() =>
              calibrate.mutate(false, {
                onSuccess: (r) =>
                  setProposal({ before: r.maeBefore, after: r.maeAfter, tracks: r.tracks }),
                onError: fail,
              })
            }
            className="h-8 rounded-sm bg-primary px-4 text-control font-semibold text-white hover:bg-primary-hover disabled:opacity-40"
          >
            {t("energyCal.calibrate")}
          </button>
        </div>
      )}
      {proposal && (
        <div className="flex flex-col gap-3">
          <h2 className="text-section">{t("energyCal.resultTitle")}</h2>
          <p className="flex items-baseline gap-3">
            <span className="font-mono text-data-lg tabular text-text-3">
              {mae(proposal.before)}
            </span>
            <span aria-hidden className="text-text-3">
              →
            </span>
            <span className="font-mono text-data-lg tabular">{mae(proposal.after)}</span>
            <span className="text-control text-text-2">{t("energyCal.maeUnit")}</span>
          </p>
          <p className="text-[12px] text-text-3">
            {t("energyCal.resultExplain", {
              count: proposal.tracks,
              n: formatCount(proposal.tracks, i18n.language),
            })}
          </p>
          {proposal.after >= proposal.before && (
            <p className="text-control text-warning">{t("energyCal.noBetter")}</p>
          )}
          <div className="flex gap-2">
            {proposal.after < proposal.before && (
              <button
                type="button"
                disabled={calibrate.isPending}
                onClick={() =>
                  calibrate.mutate(true, {
                    onSuccess: (r) => {
                      setProposal(null);
                      push({
                        tone: "success",
                        title: t("energyCal.applied", {
                          count: r.updated,
                          n: formatCount(r.updated, i18n.language),
                        }),
                      });
                    },
                    onError: fail,
                  })
                }
                className="h-8 rounded-sm bg-primary px-4 text-control font-semibold text-white hover:bg-primary-hover disabled:opacity-40"
              >
                {t("energyCal.apply")}
              </button>
            )}
            <button
              type="button"
              onClick={() => setProposal(null)}
              className="h-8 rounded-sm border border-border bg-surface-3 px-3 text-control hover:border-border-strong"
            >
              {t("energyCal.discard")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
