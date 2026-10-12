// DJ Mix transition lane (DESIGN 6.10): A's outro over B's intro on one clock, the
// crossfade zone shaded from deck A's cyan to deck B's coral, each deck's waveform
// shrinking or growing with its equal-power gain, the playhead while the mix plays, and
// the energy step of the transition ("E7 → E8 ↑") above it.
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { SHORT_WINDOW, useMediaQuery } from "../../lib/useMediaQuery";
import type { WaveformData } from "../../lib/waveform";
import { useTrackDetail, useWaveform } from "../track-detail/api";
import { type LaneDeck, type MixTimeline, laneTime } from "./transition";
import { useDeckTime } from "./useDeckTime";

// Each deck's row: tall enough to read the waveform's shape, a bit shorter in a short
// window where the decks need the room.
const ROW_TALL = 30;
const ROW_SHORT = 22;
const GAP = 6;

function cssColor(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#888";
}

/** Loudest band of the waveform between two original times (0–1). */
function peak(waveform: WaveformData, from: number, to: number): number {
  const first = Math.max(0, Math.floor(from * waveform.pointsPerSecond));
  const last = Math.min(waveform.points, Math.ceil(to * waveform.pointsPerSecond));
  let max = 0;
  for (let i = first; i < Math.max(first + 1, last) && i < waveform.points; i++) {
    for (let band = 0; band < Math.min(3, waveform.bands); band++) {
      max = Math.max(max, waveform.data[i * waveform.bands + band] ?? 0);
    }
  }
  return max / 255;
}

export interface EnergyStep {
  from: number;
  to: number;
}

export function TransitionLane({
  line,
  trackA,
  trackB,
  energyStep,
}: {
  line: MixTimeline;
  trackA: number;
  trackB: number;
  energyStep: EnergyStep | null;
}) {
  const { t } = useTranslation();
  const box = useRef<HTMLDivElement>(null);
  const ROW = useMediaQuery(SHORT_WINDOW) ? ROW_SHORT : ROW_TALL;
  const HEIGHT = ROW * 2 + GAP;
  const canvas = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const waveA = useWaveform(useTrackDetail(trackA).data?.waveformPath).data;
  const waveB = useWaveform(useTrackDetail(trackB).data?.waveformPath).data;
  const now = laneTime(line, { a: useDeckTime("a"), b: useDeckTime("b") });

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const x = (seconds: number) => (line.total > 0 ? (seconds / line.total) * width : 0);

  useEffect(() => {
    const el = canvas.current;
    if (!el || width === 0) return;
    const dpr = window.devicePixelRatio || 1;
    el.width = Math.round(width * dpr);
    el.height = Math.round(HEIGHT * dpr);
    const ctx = el.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, HEIGHT);
    const cyan = cssColor("--color-deck-a");
    const coral = cssColor("--color-deck-b");

    // The crossfade zone, behind both decks.
    const zoneStart = x(line.fade.start);
    const zoneEnd = x(line.fade.end);
    if (zoneEnd > zoneStart) {
      const zone = ctx.createLinearGradient(zoneStart, 0, zoneEnd, 0);
      zone.addColorStop(0, cyan);
      zone.addColorStop(1, coral);
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = zone;
      ctx.fillRect(zoneStart, 0, zoneEnd - zoneStart, HEIGHT);
      ctx.globalAlpha = 0.8;
      ctx.fillStyle = cyan;
      ctx.fillRect(zoneStart, 0, 1, HEIGHT);
      ctx.fillStyle = coral;
      ctx.fillRect(zoneEnd - 1, 0, 1, HEIGHT);
      ctx.globalAlpha = 1;
    }

    const fadeLength = line.fade.end - line.fade.start;
    // Equal-power gain of a deck at lane second `s` (what the player applies).
    const gain = (side: "a" | "b", s: number) => {
      if (fadeLength <= 0) return 1;
      const p = Math.min(1, Math.max(0, (s - line.fade.start) / fadeLength));
      return side === "a" ? Math.cos((p * Math.PI) / 2) : Math.sin((p * Math.PI) / 2);
    };
    const draw = (side: "a" | "b", deck: LaneDeck, wave: WaveformData | undefined, top: number) => {
      const mid = top + ROW / 2;
      ctx.fillStyle = side === "a" ? cyan : coral;
      const from = Math.max(0, Math.floor(x(deck.start)));
      const to = Math.min(width, Math.ceil(x(deck.end)));
      const span = deck.end - deck.start || 1;
      const perSecond = (deck.to - deck.from) / span;
      for (let px = from; px < to; px++) {
        const s0 = (px / width) * line.total;
        const s1 = ((px + 1) / width) * line.total;
        const level = wave
          ? peak(
              wave,
              deck.from + (s0 - deck.start) * perSecond,
              deck.from + (s1 - deck.start) * perSecond,
            )
          : 0.5;
        const h = Math.max(0.5, level * (ROW / 2) * Math.max(0.12, gain(side, s0)));
        ctx.globalAlpha = now != null && s0 < now ? 0.45 : 0.9;
        ctx.fillRect(px, mid - h, 1, h * 2);
      }
      ctx.globalAlpha = 1;
    };
    draw("a", line.a, waveA, 0);
    draw("b", line.b, waveB, ROW + GAP);

    if (now != null) {
      ctx.fillStyle = cssColor("--color-text");
      ctx.fillRect(Math.round(x(now)), 0, 1, HEIGHT);
    }
    // `x` depends on width and line, both listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, line, waveA, waveB, now, ROW]);

  const pct = (s: number) => `${(line.total > 0 ? (s / line.total) * 100 : 0).toFixed(3)}%`;
  const arrow = energyStep
    ? energyStep.to > energyStep.from
      ? "↑"
      : energyStep.to < energyStep.from
        ? "↓"
        : "="
    : "";

  return (
    <figure
      className="flex min-w-0 flex-1 flex-col gap-1"
      aria-label={t("pro.transitionLane", { bars: line.fade.bars })}
    >
      <figcaption className="relative ml-4 flex h-4 items-center text-label uppercase text-text-3">
        <span
          className="absolute truncate text-center"
          style={{ left: pct(line.fade.start), width: pct(line.fade.end - line.fade.start) }}
        >
          {t("pro.bars", { count: line.fade.bars })}
        </span>
        {energyStep && (
          <span
            className="ml-auto font-mono text-[12px] normal-case tracking-normal text-text"
            aria-label={t("pro.energyStep", { ...energyStep })}
          >
            E{energyStep.from} → E{energyStep.to} {arrow}
          </span>
        )}
      </figcaption>
      <div ref={box} className="relative ml-4" style={{ height: HEIGHT }}>
        <canvas ref={canvas} aria-hidden className="absolute inset-0 size-full" />
        <span
          aria-hidden
          className="absolute -left-4 top-0 font-mono text-[10px] font-semibold text-deck-a"
          style={{ lineHeight: `${ROW}px` }}
        >
          A
        </span>
        <span
          aria-hidden
          className="absolute -left-4 font-mono text-[10px] font-semibold text-deck-b"
          style={{ top: ROW + GAP, lineHeight: `${ROW}px` }}
        >
          B
        </span>
      </div>
    </figure>
  );
}
