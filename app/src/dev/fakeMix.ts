// A fake of `mix.points` (SPEC 14.1) for the browser preview and the tests: the same idea
// as the engine (phrases of 8 bars, intro over outro, drop swap or cut) on the detail's
// segments, without its finer fit rules.
import type { MixPoints, MixPointsParams, TrackDetail } from "../lib/rpc.types";

const PHRASE = 8;

function sections(t: TrackDetail) {
  const bar = 240 / (t.bpm ?? 124);
  const first = (t.beatGrid?.first_downbeat as number | undefined) ?? 0;
  const at = (s: number) => Math.max(0, Math.round((s - first) / bar));
  const bars = Math.floor(((t.duration ?? 0) - first) / bar + 0.1);
  const segs = t.segments ?? [];
  const intro = segs[0]?.label === "intro" ? at(segs[0].end) : 0;
  const last = segs.at(-1);
  const outro = segs.length > 1 && last?.label === "outro" ? bars - at(last.start) : 0;
  const drop = at(segs.find((s) => s.label === "drop")?.start ?? first);
  return { bar, first, bars, intro, outro, drop };
}

export function fakeMixPoints(p: MixPointsParams, a: TrackDetail, b: TrackDetail): MixPoints {
  if (!a.beatGrid || !b.beatGrid || !a.bpm || !b.bpm)
    throw { code: -32602, message: "not analysed", data: { reason: "not_analysed" } };
  const style = p.style ?? "intro_outro";
  const want = p.overlapBars ?? 32;
  const sa = sections(a);
  const sb = sections(b);
  const longest = (limit: number) => [32, 16, 8].find((n) => n <= limit) ?? PHRASE;
  const switchBar = sa.outro >= PHRASE ? sa.bars - sa.outro : Math.max(0, sa.bars - want);
  const timeA = (bar: number) => sa.first + bar * sa.bar;
  const timeB = (bar: number) => sb.first + bar * sb.bar;
  if (style === "cut")
    return {
      style,
      aStart: timeA(switchBar),
      aEnd: timeA(switchBar),
      bStart: timeB(0),
      overlapBars: 0,
      overlapSeconds: 0,
      fit: sa.outro >= PHRASE ? 1 : 0.75,
      reasons: [{ code: "cut", bars: null, aBars: sa.outro || null, bBars: null }],
    };
  if (style === "drop_swap" && sb.drop >= PHRASE) {
    const length = longest(Math.min(want, sb.drop));
    return {
      style,
      aStart: timeA(switchBar - length),
      aEnd: timeA(switchBar),
      bStart: timeB(sb.drop - length),
      overlapBars: length,
      overlapSeconds: length * sa.bar,
      fit: 1,
      reasons: [{ code: "drop_swap", bars: length, aBars: null, bBars: null }],
    };
  }
  const length = longest(Math.min(want, sa.outro || want, sb.intro >= PHRASE ? sb.intro : 16));
  const reasons: MixPoints["reasons"] =
    sb.intro >= PHRASE && sb.intro < Math.min(want, sa.outro || want)
      ? [{ code: "short_intro", bars: length, aBars: null, bBars: null }]
      : [{ code: "outro_intro", bars: null, aBars: sa.outro, bBars: sb.intro }];
  return {
    style: "intro_outro",
    aStart: timeA(switchBar),
    aEnd: timeA(switchBar + length),
    bStart: timeB(0),
    overlapBars: length,
    overlapSeconds: length * sa.bar,
    fit: length === want ? 1 : 0.9,
    reasons,
  };
}
