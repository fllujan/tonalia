// Mix points by phrases (SPEC 14.1): where A goes out and B comes in, from the engine, in
// the style chosen (a setting shared with the ideas and the set builder) and with the
// overlap asked for (16 or 32 bars). "Try mix" and the transition lane start from them.
import { useQuery } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import { request } from "../../lib/rpc";
import type { MixPointReason, MixPoints, MixPointsParams } from "../../lib/rpc.types";
import { useSettings } from "../settings/api";
import type { CrossfadeBars, MixPointsPlan } from "./segments";

export type MixPointStyle = NonNullable<MixPointsParams["style"]>;

export const MIX_STYLES: readonly MixPointStyle[] = ["intro_outro", "drop_swap", "cut"];

export function useMixPoints(
  trackA: number | null | undefined,
  trackB: number | null | undefined,
  overlapBars: CrossfadeBars,
  enabled: boolean,
) {
  const style = useSettings().mixPointStyle ?? "intro_outro";
  return useQuery({
    queryKey: ["mix.points", trackA, trackB, style, overlapBars],
    queryFn: () =>
      request("mix.points", { trackA: trackA ?? 0, trackB: trackB ?? 0, style, overlapBars }),
    enabled: enabled && trackA != null && trackB != null,
    // Without a beatgrid there are no points: "Try mix" falls back to outro and intro.
    retry: false,
    staleTime: 60_000,
  });
}

export function pointsPlan(points: MixPoints | undefined | null): MixPointsPlan | null {
  return points
    ? { aStart: points.aStart, bStart: points.bStart, overlapBars: points.overlapBars }
    : null;
}

export function mixReasonText(t: TFunction, reason: MixPointReason): string {
  return t(`pro.mixPoints.reasons.${reason.code}`, {
    bars: reason.bars ?? 0,
    a: reason.aBars ?? 0,
    b: reason.bBars ?? 0,
  });
}
