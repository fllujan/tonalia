// Playback logic of the studio (SPEC 2.15): anchors, cue clicks, "Try mashup", "Try mix"
// and the speculative pre-render of the next idea while the current one is heard.
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo } from "react";
import { asBeatGrid, snapToDownbeat } from "../../lib/beats";
import { request } from "../../lib/rpc";
import type { Cue, Suggestion, TrackDetail } from "../../lib/rpc.types";
import { detailKey, useTrackDetail } from "../track-detail/api";
import type { DeckActions, DeckChange, Side } from "./Deck";
import { useDecksStore } from "./decksStore";
import { renderPreview } from "./renderJobs";
import {
  type DeckInfo,
  type DeckProcessing,
  defaultAnchor,
  mashupPlan,
  mixPlan,
  soloPlan,
} from "./segments";
import { player, usePlaybackStore } from "./syncPlayer";

const PRERENDER_DELAY_MS = 1200;

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

const ORIGINAL: DeckProcessing = { semitones: 0, targetBpm: null };

function processingOf(change: DeckChange | null): DeckProcessing {
  return change ? { semitones: change.shift, targetBpm: change.bpm } : ORIGINAL;
}

export function useStudio(
  trackA: number,
  current: Suggestion | undefined,
  next: Suggestion | undefined,
  change: DeckChange | null,
) {
  const qc = useQueryClient();
  const mode = useDecksStore((s) => s.mode);
  const anchors = useDecksStore((s) => s.anchors);
  const crossfadeBars = useDecksStore((s) => s.crossfadeBars);
  const a = deckInfo(useTrackDetail(trackA).data);
  const bDetail = useTrackDetail(current?.track.id ?? -1, current != null);
  const b = current ? deckInfo(bDetail.data) : null;
  const bId = current?.track.id;

  const anchorOf = useCallback(
    (side: Side, info: DeckInfo, override?: number) =>
      override ?? anchors[side] ?? defaultAnchor(info),
    [anchors],
  );
  const processing = useMemo(() => ({ a: ORIGINAL, b: processingOf(change) }), [change]);

  const tryMashup = useCallback(
    (override?: Partial<Record<Side, number>>) => {
      if (!a || !b) return;
      void player.play(
        mashupPlan(
          a,
          b,
          { a: anchorOf("a", a, override?.a), b: anchorOf("b", b, override?.b) },
          processing,
        ),
      );
    },
    [a, b, anchorOf, processing],
  );
  const tryMix = useCallback(() => {
    if (!a || !b) return;
    void player.play(mixPlan(a, b, crossfadeBars, processing));
  }, [a, b, crossfadeBars, processing]);

  const solo = useCallback(
    (side: Side, at?: number) => {
      const info = side === "a" ? a : b;
      if (!info) return;
      void player.play(soloPlan(side, info, anchorOf(side, info, at), processing[side]));
    },
    [a, b, anchorOf, processing],
  );

  const actionsFor = (side: Side): DeckActions | undefined => {
    const info = side === "a" ? a : b;
    if (!info) return undefined;
    return {
      anchor: anchorOf(side, info),
      onAnchor: (time) => {
        const at = snapToDownbeat(info.grid, time, info.duration);
        useDecksStore.getState().setAnchor(side, at);
        const { status, kind } = usePlaybackStore.getState();
        if (status === "idle") return;
        if (kind === "mashup") tryMashup({ [side]: at });
        else if (kind === side) solo(side, at);
        else player.stop();
      },
      onCue: (cue: Cue) => {
        useDecksStore.getState().setAnchor(side, cue.positionSec);
        // A cue plays its segment synchronized with the other deck (alone without B).
        if (a && b) tryMashup({ [side]: cue.positionSec });
        else solo(side, cue.positionSec);
      },
      onPlay: () => solo(side),
    };
  };

  // A new track, idea or mode makes the current playback meaningless.
  useEffect(() => () => player.stop(), [trackA, bId, mode]);

  // Pre-render the next idea's segment so moving to it plays at once.
  const nextId = next?.track.id;
  const nextShift = next?.shiftB;
  const nextFactor = next?.bpmFactor;
  useEffect(() => {
    if (!a || nextId == null || nextShift == null || nextFactor == null) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void qc
        .fetchQuery({
          queryKey: detailKey(nextId),
          queryFn: () => request("library.get", { trackId: nextId }),
        })
        .then((detail) => {
          const info = deckInfo(detail);
          if (cancelled || !info) return;
          const proc = {
            a: ORIGINAL,
            b: { semitones: nextShift, targetBpm: a.bpm / nextFactor },
          };
          const plan =
            mode === "mix"
              ? mixPlan(a, info, crossfadeBars, proc)
              : mashupPlan(a, info, { a: anchorOf("a", a), b: defaultAnchor(info) }, proc);
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
  }, [a?.trackId, a?.bpm, nextId, nextShift, nextFactor, mode, crossfadeBars, qc]);

  return {
    ready: a != null && b != null,
    tryMashup: () => tryMashup(),
    tryMix,
    actionsA: actionsFor("a"),
    actionsB: actionsFor("b"),
  };
}
