// Play a favorite from its card (DESIGN 6.11 "▶"): the mashup from its cues, or the mix
// from A's outro, with the key changes and stems it was saved with (the full track while
// a stem is not separated yet).
import type { QueryClient } from "@tanstack/react-query";
import { request } from "../../lib/rpc";
import type { Favorite } from "../../lib/rpc.types";
import { defaultAnchor, mashupPlan, mixPlan, type PlayPlan } from "../decks/segments";
import { player } from "../decks/syncPlayer";
import { deckInfo } from "../decks/useStudio";
import { stemsKeys } from "../stems/api";
import { detailKey } from "../track-detail/api";

async function stemsReady(qc: QueryClient, trackId: number, stem: string): Promise<boolean> {
  if (stem === "mix") return false;
  const stems = await qc.fetchQuery({
    queryKey: stemsKeys.track(trackId),
    queryFn: async () => (await request("stems.get", { trackId })).stems ?? null,
  });
  return stems != null;
}

export async function favoritePlan(f: Favorite, qc: QueryClient): Promise<PlayPlan> {
  const detail = (trackId: number) =>
    qc.fetchQuery({
      queryKey: detailKey(trackId),
      queryFn: () => request("library.get", { trackId }),
    });
  const stemA = f.stemA ?? "mix";
  const stemB = f.stemB ?? "mix";
  const [da, db, readyA, readyB] = await Promise.all([
    detail(f.trackA),
    detail(f.trackB),
    stemsReady(qc, f.trackA, stemA),
    stemsReady(qc, f.trackB, stemB),
  ]);
  const a = deckInfo(da);
  const b = deckInfo(db);
  if (!a || !b) throw new Error("not analysed");
  const processing = {
    a: { semitones: f.shiftA ?? 0, targetBpm: null, source: readyA ? stemA : "mix" },
    b: {
      semitones: f.shiftB ?? 0,
      targetBpm: a.bpm / (f.bpmFactor ?? 1),
      source: readyB ? stemB : "mix",
    },
  } as const;
  return f.mode === "mix"
    ? mixPlan(a, b, 16, processing)
    : mashupPlan(
        a,
        b,
        { a: f.cueA ?? defaultAnchor(a), b: f.cueB ?? defaultAnchor(b) },
        processing,
      );
}

export async function playFavorite(f: Favorite, qc: QueryClient): Promise<void> {
  await player.play(await favoritePlan(f, qc));
}
