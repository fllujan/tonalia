// Playback logic of the studio (SPEC 2.15): anchors, cue clicks, "Try mashup", "Try mix",
// the stem and loop of each deck, and the speculative pre-render of the next idea while
// the current one is heard. Plans read the decks store at call time, so a click that
// changes an anchor or a loop plays the new state at once.
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { asBeatGrid, snapToDownbeat } from "../../lib/beats";
import { request } from "../../lib/rpc";
import type { Cue, Suggestion, TrackDetail } from "../../lib/rpc.types";
import { stemsKeys, useTrackStems } from "../stems/api";
import { detailKey, useTrackDetail } from "../track-detail/api";
import type { DeckActions, DeckChange, Side } from "./Deck";
import { type DeckStem, type ProMode, useDecksStore } from "./decksStore";
import { renderPreview } from "./renderJobs";
import {
  barLoop,
  type DeckInfo,
  type DeckProcessing,
  defaultAnchor,
  type LoopLength,
  type LoopRegion,
  mashupPlan,
  type RenderSource,
  mixPlan,
  moveFreeEdge,
  phraseRange,
  soloPlan,
} from "./segments";
import { mixTimeline } from "./transition";
import { pointsPlan, useMixPoints } from "./mixPoints";
import { useSettings } from "../settings/api";
import { player, usePlaybackStore } from "./syncPlayer";

const PRERENDER_DELAY_MS = 1200;
/** A free loop starts as this many bars from the anchor. */
const FREE_LOOP_BARS = 4;

export function deckInfo(detail: TrackDetail | undefined): DeckInfo | null {
  if (!detail || detail.bpm == null || !detail.duration) return null;
  return {
    trackId: detail.id,
    bpm: detail.bpm,
    duration: detail.duration,
    grid: asBeatGrid(detail.beatGrid),
    segments: detail.segments ?? [],
    cues: detail.cues ?? [],
  };
}

const decks = () => useDecksStore.getState();

/** Where a deck plays from: its free loop, its anchor or its first downbeat. */
function anchorOf(side: Side, info: DeckInfo): number {
  const s = decks();
  if (s.loops[side] === "free" && s.freeLoops[side]) return s.freeLoops[side].start;
  return s.anchors[side] ?? defaultAnchor(info);
}

/** The loop a deck plays now, if any. */
export function loopOf(side: Side, info: DeckInfo): LoopRegion | undefined {
  const s = decks();
  const loop = s.loops[side];
  if (loop == null) return undefined;
  if (loop === "free") return s.freeLoops[side] ?? undefined;
  return barLoop(info, anchorOf(side, info), loop);
}

/** The stem asked for when it exists; the full track until the stems are separated. */
function sourceOf(stem: DeckStem, ready: boolean): RenderSource {
  return stem !== "mix" && ready ? stem : "mix";
}

export function useStudio(
  trackA: number,
  current: Suggestion | undefined,
  next: Suggestion | undefined,
  changeA: DeckChange | null,
  change: DeckChange | null,
) {
  const qc = useQueryClient();
  const mode = useDecksStore((s) => s.mode);
  const crossfadeBars = useDecksStore((s) => s.crossfadeBars);
  const mixPhrases = useDecksStore((s) => s.mixPhrases);
  const mixStyle = useSettings().mixPointStyle ?? "intro_outro";
  const loops = useDecksStore((s) => s.loops);
  const stems = useDecksStore((s) => s.stems);
  // Subscribed so the decks re-render when an anchor or a free loop moves (the plans read
  // the store at call time).
  useDecksStore((s) => s.anchors);
  useDecksStore((s) => s.freeLoops);
  const a = deckInfo(useTrackDetail(trackA).data);
  const bId = current?.track.id;
  const bDetail = useTrackDetail(bId ?? -1, current != null);
  const b = current ? deckInfo(bDetail.data) : null;
  const pointsQuery = useMixPoints(trackA, bId, crossfadeBars, mode === "mix");
  const points = pointsPlan(pointsQuery.data);
  const stemsReady: Record<Side, boolean> = {
    a: useTrackStems(trackA).data != null,
    b: useTrackStems(bId ?? -1, current != null).data != null,
  };

  const shiftA = changeA?.shift ?? 0;
  const shiftB = change?.shift ?? 0;
  const processing = (): Record<Side, DeckProcessing> => {
    const s = decks().stems;
    return {
      a: { semitones: shiftA, targetBpm: null, source: sourceOf(s.a, stemsReady.a) },
      b: {
        semitones: shiftB,
        targetBpm: change?.bpm ?? null,
        source: sourceOf(s.b, stemsReady.b),
      },
    };
  };

  const tryMashup = () => {
    if (!a || !b) return;
    const loopsNow: Partial<Record<Side, LoopRegion>> = {};
    const loopA = loopOf("a", a);
    const loopB = loopOf("b", b);
    if (loopA) loopsNow.a = loopA;
    if (loopB) loopsNow.b = loopB;
    void player.play(
      mashupPlan(a, b, { a: anchorOf("a", a), b: anchorOf("b", b) }, processing(), loopsNow),
    );
  };
  // Loops do not apply to the transition.
  const tryMix = () => {
    if (!a || !b) return;
    void player.play(mixPlan(a, b, crossfadeBars, processing(), points, mixPhrases));
  };
  const solo = (side: Side) => {
    const info = side === "a" ? a : b;
    if (!info) return;
    void player.play(
      soloPlan(side, info, anchorOf(side, info), processing()[side], loopOf(side, info)),
    );
  };
  /** Play again what is playing, with the new state of `side`. */
  const replay = (side: Side) => {
    const { status, kind } = usePlaybackStore.getState();
    if (status === "idle") return;
    if (kind === "mashup") tryMashup();
    else if (kind === side) solo(side);
    else if (kind === "mix") tryMix();
  };

  const actionsFor = (side: Side): DeckActions | undefined => {
    const info = side === "a" ? a : b;
    if (!info) return undefined;
    const loop = loops[side];
    return {
      anchor: anchorOf(side, info),
      loop: loopOf(side, info) ?? null,
      loopLength: loop,
      stem: stems[side],
      stemsReady: stemsReady[side],
      onAnchor: (time) => {
        const free = decks().freeLoops[side];
        if (loop === "free" && free) {
          const region = moveFreeEdge(info, free, time);
          decks().setFreeLoop(side, region);
          decks().setAnchor(side, region.start);
        } else decks().setAnchor(side, snapToDownbeat(info.grid, time, info.duration));
        replay(side);
      },
      onCue: (cue: Cue) => {
        const free = decks().freeLoops[side];
        // A free loop keeps its length and moves to the cue.
        if (loop === "free" && free)
          decks().setFreeLoop(side, {
            start: cue.positionSec,
            end: Math.min(info.duration, cue.positionSec + free.end - free.start),
          });
        decks().setAnchor(side, cue.positionSec);
        // A cue plays its segment synchronized with the other deck (alone without B).
        if (a && b) tryMashup();
        else solo(side);
      },
      onPlay: () => solo(side),
      onLoop: (length: LoopLength | null) => {
        const first =
          length === "free" ? barLoop(info, anchorOf(side, info), FREE_LOOP_BARS) : undefined;
        decks().setLoop(side, length, first);
        replay(side);
      },
      onStem: (stem: DeckStem) => {
        decks().setStem(side, stem);
        if (stem === "mix" || stemsReady[side]) replay(side);
      },
    };
  };

  // A new track for A, a new mode or a new key for A (new ideas): the playback stops.
  useEffect(() => () => player.stop(), [trackA, mode, shiftA]);

  // A new idea or key for B stops it too, but a mashup plays again as soon as the new B is
  // ready: a loop in A keeps going while the instrumentals in B change.
  const resume = useRef<{ trackA: number; mode: ProMode } | null>(null);
  useEffect(
    () => () => {
      const { status, kind } = usePlaybackStore.getState();
      resume.current = status !== "idle" && kind === "mashup" ? { trackA, mode } : null;
      player.stop();
    },
    [trackA, mode, bId, shiftB],
  );
  useEffect(() => {
    const pending = resume.current;
    if (!pending || !a || !b || b.trackId !== bId) return;
    resume.current = null;
    if (pending.trackA === trackA && pending.mode === mode) tryMashup();
    // `a`, `b` and `tryMashup` are rebuilt every render; these say when B is ready.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [b?.trackId, bId, shiftB, trackA, mode]);

  // Pre-render the next idea's segment so moving to it plays at once.
  const nextId = next?.track.id;
  const nextShift = next?.shiftB;
  const nextFactor = next?.bpmFactor;
  const stemB = stems.b;
  const loopB = loops.b;
  useEffect(() => {
    if (!a || nextId == null || nextShift == null || nextFactor == null) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void Promise.all([
        qc.fetchQuery({
          queryKey: detailKey(nextId),
          queryFn: () => request("library.get", { trackId: nextId }),
        }),
        stemB === "mix"
          ? null
          : qc.fetchQuery({
              queryKey: stemsKeys.track(nextId),
              queryFn: async () => (await request("stems.get", { trackId: nextId })).stems ?? null,
            }),
      ])
        .then(async ([detail, nextStems]) => {
          const info = deckInfo(detail);
          if (cancelled || !info) return;
          const proc = {
            a: { semitones: shiftA, targetBpm: null },
            b: {
              semitones: nextShift,
              targetBpm: a.bpm / nextFactor,
              source: sourceOf(stemB, nextStems != null),
            },
          };
          const anchor = defaultAnchor(info);
          const loop = typeof loopB === "number" ? { b: barLoop(info, anchor, loopB) } : undefined;
          const nextPoints =
            mode === "mix"
              ? await qc
                  .fetchQuery({
                    queryKey: ["mix.points", a.trackId, nextId, mixStyle, crossfadeBars],
                    queryFn: () =>
                      request("mix.points", {
                        trackA: a.trackId,
                        trackB: nextId,
                        style: mixStyle,
                        overlapBars: crossfadeBars,
                      }),
                    staleTime: 60_000,
                  })
                  .catch(() => undefined)
              : undefined;
          const plan =
            mode === "mix"
              ? mixPlan(a, info, crossfadeBars, proc, pointsPlan(nextPoints))
              : mashupPlan(a, info, { a: anchorOf("a", a), b: anchor }, proc, loop);
          const deckB = plan.decks.find((d) => d.side === "b");
          return deckB ? renderPreview(deckB.spec) : undefined;
        })
        .catch(() => undefined);
    }, PRERENDER_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // `a` is rebuilt every render; its track and tempo are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    a?.trackId,
    a?.bpm,
    shiftA,
    nextId,
    nextShift,
    nextFactor,
    mode,
    crossfadeBars,
    mixStyle,
    stemB,
    loopB,
    qc,
  ]);

  return {
    ready: a != null && b != null,
    /** DJ Mix: what "Try mix" will play, for the transition lane. */
    mix:
      mode === "mix" && a && b
        ? mixTimeline(mixPlan(a, b, crossfadeBars, processing(), points, mixPhrases), a, b)
        : null,
    /** DJ Mix: the engine's mix points for A → B (undefined while loading or without grid). */
    mixPoints: mode === "mix" ? pointsQuery.data : undefined,
    phrases: points && a ? phraseRange(a, points) : null,
    tryMashup,
    tryMix,
    actionsA: actionsFor("a"),
    actionsB: actionsFor("b"),
  };
}
