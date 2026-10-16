// Detail waveform (DESIGN 2.7 and 6.5): stacked bands, energy curve, labelled section
// strip, numbered cue flags (draggable, snapped to the beat), playhead and bar ruler.
import { type PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { type BeatGrid, downbeatTimes, snapToBeat } from "../../lib/beats";
import { formatDuration } from "../../lib/format";
import type { Cue, EnergyPoint, SegmentInfo } from "../../lib/rpc.types";
import { sectionColor, sectionKinds } from "../../lib/sections";
import type { WaveformData } from "../../lib/waveform";
import { fitSectionLabel } from "./sectionLabel";
import { inkOf } from "../../lib/keyStyle";

const PLAYED_ALPHA = 0.45;

function cssColor(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#888";
}

function useWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

interface WaveformViewProps {
  waveform: WaveformData | undefined;
  duration: number;
  time: number;
  energy: EnergyPoint[];
  segments: SegmentInfo[];
  cues: Cue[];
  grid: BeatGrid | null;
  onSeek: (time: number) => void;
  /** Cue flags are draggable only when this is given (detail view). */
  onMoveCue?: (cue: Cue, position: number) => void;
  /** Clicking a flag (decks): the cue is not dragged then. */
  onCueClick?: (cue: Cue) => void;
  /** 120 px in the detail view, 96 px in the decks (DESIGN 5.9). */
  height?: number;
  /** Playhead colour token: primary, or the deck colour. */
  playhead?: string;
  /** Bar ruler under the waveform (detail view). */
  ruler?: boolean;
  /** Section names above the waveform; the coloured strip below always shows. */
  sectionLabels?: boolean;
  label?: string;
  /** Colour token that replaces the three bands (the deck's stem, DESIGN 6.9). */
  tint?: string | undefined;
  /** Shaded loop region (decks), in seconds. */
  loop?: { start: number; end: number } | null;
  /** Region the deck brings forward (DJ Mix: A's outro, B's intro); the rest dims. */
  focus?: { start: number; end: number } | null;
  /** Show only this stretch of the track (the grid editor's zoom), in seconds. */
  view?: { start: number; end: number } | null;
  /** Beat and downbeat lines (grid editor). */
  beatLines?: { beats: number[]; downbeats: number[] } | null;
  /** Tempo anchors of the grid editor: draggable diamonds, not snapped. */
  anchors?: { beat: number; time: number }[];
  selectedAnchor?: number | null;
  onMoveAnchor?: (beat: number, time: number) => void;
  onSelectAnchor?: (beat: number) => void;
  onDoubleClick?: (time: number) => void;
}

export function WaveformView({
  waveform,
  duration,
  time,
  energy,
  segments,
  cues,
  grid,
  onSeek,
  onMoveCue,
  onCueClick,
  height: HEIGHT = 120,
  playhead = "var(--color-primary)",
  ruler: showRuler = true,
  sectionLabels = true,
  label,
  tint,
  loop = null,
  focus = null,
  view = null,
  beatLines = null,
  anchors = [],
  selectedAnchor = null,
  onMoveAnchor,
  onSelectAnchor,
  onDoubleClick,
}: WaveformViewProps) {
  const { t } = useTranslation();
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const width = useWidth(box);
  const [drag, setDrag] = useState<{ slot: number; position: number } | null>(null);
  const [anchorDrag, setAnchorDrag] = useState<{ beat: number; time: number } | null>(null);
  const v0 = view ? view.start : 0;
  const span = view ? Math.max(1e-3, view.end - view.start) : duration;
  const x = (seconds: number) => (span > 0 ? ((seconds - v0) / span) * width : 0);
  const inView = (seconds: number) => !view || (seconds >= v0 && seconds <= v0 + span);
  const timeAt = (clientX: number, rect: DOMRect) =>
    Math.min(duration, Math.max(0, v0 + ((clientX - rect.left) / rect.width) * span));

  // Bars every 16 (1, 17, 33…) for the ruler.
  const ruler = useMemo(() => {
    if (!showRuler || !grid || duration <= 0) return [];
    const every = view ? 1 : 16;
    return downbeatTimes(grid, duration)
      .map((at, i) => ({ at, bar: i + 1 }))
      .filter(({ at, bar }) => (bar - 1) % every === 0 && (!view || (at >= v0 && at <= v0 + span)));
  }, [showRuler, grid, duration, view, v0, span]);

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
    const mid = HEIGHT / 2;

    if (waveform && waveform.points > 0) {
      const colors = (
        tint ? [tint, tint, tint] : ["--color-wave-low", "--color-wave-mid", "--color-wave-high"]
      ).map(cssColor);
      // One stem colour: the bands become shades of it.
      const shade = tint ? [0.45, 0.7, 1] : [1, 1, 1];
      const scale = [1, 0.8, 0.55]; // low at the back, high in front, like booth displays
      const playedX = x(time);
      const perSecond = duration > 0 ? waveform.points / duration : 0;
      const perPixel = (span * perSecond) / width;
      const offset = v0 * perSecond;
      for (let band = 0; band < Math.min(3, waveform.bands); band++) {
        ctx.fillStyle = colors[band] ?? "#888";
        for (let px = 0; px < width; px++) {
          const from = Math.floor(offset + px * perPixel);
          const to = Math.max(from + 1, Math.floor((px + 1) * perPixel));
          let peak = 0;
          for (let i = Math.max(0, from); i < to && i < waveform.points; i++) {
            peak = Math.max(peak, waveform.data[i * waveform.bands + band] ?? 0);
          }
          const h = (peak / 255) * mid * (scale[band] ?? 1);
          ctx.globalAlpha = (px < playedX ? PLAYED_ALPHA : 1) * (shade[band] ?? 1);
          ctx.fillRect(px, mid - h, 1, h * 2);
        }
      }
      ctx.globalAlpha = 1;
    }

    // Beat lines (grid editor): faint on beats, stronger on downbeats.
    if (beatLines) {
      const faint = cssColor("--color-text-3");
      const strong = cssColor("--color-text");
      const draw = (times: number[], color: string, alpha: number) => {
        ctx.fillStyle = color;
        ctx.globalAlpha = alpha;
        for (const t of times) {
          const px = x(t);
          if (px >= 0 && px <= width) ctx.fillRect(Math.round(px), 0, 1, HEIGHT);
        }
      };
      draw(beatLines.beats, faint, 0.45);
      draw(beatLines.downbeats, strong, 0.7);
      ctx.globalAlpha = 1;
    }

    // Energy curve: 1.5 px line with the energy scale as a vertical gradient, 8 % fill.
    if (energy.length > 0 && duration > 0) {
      const y = (level: number) => HEIGHT - 4 - ((level - 1) / 9) * (HEIGHT - 8);
      const gradient = ctx.createLinearGradient(0, HEIGHT, 0, 0);
      for (let i = 1; i <= 10; i++)
        gradient.addColorStop((i - 1) / 9, cssColor(`--color-energy-${i}`));
      ctx.beginPath();
      energy.forEach((p, i) => {
        const px = x((p.start + p.end) / 2);
        if (i === 0) ctx.moveTo(x(p.start), y(p.level));
        ctx.lineTo(px, y(p.level));
        if (i === energy.length - 1) ctx.lineTo(x(p.end), y(p.level));
      });
      ctx.strokeStyle = gradient;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.lineTo(x(energy[energy.length - 1]?.end ?? duration), HEIGHT);
      ctx.lineTo(x(energy[0]?.start ?? 0), HEIGHT);
      ctx.closePath();
      ctx.globalAlpha = 0.08;
      ctx.fillStyle = gradient;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }, [waveform, energy, width, duration, time, HEIGHT, tint, v0, span, beatLines]); // eslint-disable-line react-hooks/exhaustive-deps

  const seekFromPointer = (e: PointerEvent<HTMLDivElement>) => {
    onSeek(timeAt(e.clientX, e.currentTarget.getBoundingClientRect()));
  };

  const startDrag = (cue: Cue) => (e: PointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (!onMoveCue) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ slot: cue.slot, position: cue.positionSec });
  };
  const moveDrag = (e: PointerEvent<HTMLButtonElement>) => {
    if (!drag || !box.current) return;
    const raw = timeAt(e.clientX, box.current.getBoundingClientRect());
    setDrag({ ...drag, position: snapToBeat(grid, raw, duration) });
  };
  const endDrag = (cue: Cue) => () => {
    if (drag && onMoveCue && Math.abs(drag.position - cue.positionSec) > 1e-3)
      onMoveCue(cue, drag.position);
    setDrag(null);
  };

  // The second drop is "Drop 2", in the colour of its cue (DESIGN 2.5).
  const kinds = sectionKinds(segments.map((s) => s.label));

  return (
    <div className={`flex flex-col gap-1 select-none ${view ? "overflow-hidden" : ""}`}>
      {/* Section labels above the waveform. */}
      <div className={sectionLabels ? "relative h-4" : "hidden"} aria-hidden>
        {segments.map((s, i) => {
          const kind = kinds[i] ?? s.label;
          const name = fitSectionLabel(
            t(`sections.${kind}`),
            t(`sectionsShort.${kind}`),
            x(s.end) - x(s.start) - 6,
          );
          return (
            name && (
              <span
                key={s.start}
                className="absolute top-0 whitespace-nowrap text-label uppercase"
                style={{ left: x(s.start), color: inkOf(sectionColor(kind)) }}
              >
                {name}
              </span>
            )
          );
        })}
      </div>
      <div
        ref={box}
        role="slider"
        tabIndex={0}
        aria-label={label ?? t("detail.position")}
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(time)}
        aria-valuetext={formatDuration(time)}
        onPointerDown={seekFromPointer}
        onDoubleClick={
          onDoubleClick
            ? (e) => onDoubleClick(timeAt(e.clientX, e.currentTarget.getBoundingClientRect()))
            : undefined
        }
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") onSeek(Math.min(duration, time + 5));
          if (e.key === "ArrowLeft") onSeek(Math.max(0, time - 5));
        }}
        className={`relative cursor-pointer rounded-sm bg-surface-2 ${view ? "overflow-hidden" : ""}`}
        style={{ height: HEIGHT }}
      >
        <canvas ref={canvas} className="absolute inset-0 h-full w-full" />
        {focus && focus.end > focus.start && (
          <>
            <div
              aria-hidden
              className="pointer-events-none absolute inset-y-0 left-0 bg-bg/60"
              style={{ width: x(focus.start) }}
            />
            <div
              aria-hidden
              className="pointer-events-none absolute inset-y-0 right-0 bg-bg/60"
              style={{ left: x(focus.end) }}
            />
            <div
              aria-hidden
              data-testid="focus-region"
              className="pointer-events-none absolute top-0 h-0.5"
              style={{
                left: x(focus.start),
                width: Math.max(1, x(focus.end) - x(focus.start)),
                backgroundColor: playhead,
              }}
            />
          </>
        )}
        {loop && loop.end > loop.start && (
          <div
            aria-hidden
            data-testid="loop-region"
            className="pointer-events-none absolute inset-y-0 border-x"
            style={{
              left: x(loop.start),
              width: Math.max(4, x(loop.end) - x(loop.start)),
              borderColor: playhead,
              backgroundColor: `color-mix(in srgb, ${playhead} 24%, transparent)`,
            }}
          >
            {/* A solid bar along the bottom: the top belongs to the cue flags, which
                would otherwise hide a short loop on cue 1. */}
            <span
              className="absolute inset-x-0 bottom-0 h-1"
              style={{ backgroundColor: playhead }}
            />
          </div>
        )}
        {cues.map((cue) => {
          const at = drag?.slot === cue.slot ? drag.position : cue.positionSec;
          if (!inView(at)) return null;
          const color = cue.color ?? `var(--color-cue-${cue.slot + 1})`;
          return (
            <div key={cue.slot} className="absolute inset-y-0" style={{ left: x(at) }}>
              <div
                className="absolute inset-y-0 w-px opacity-80"
                style={{ backgroundColor: color }}
              />
              <button
                type="button"
                aria-label={t(onMoveCue ? "cues.flag" : "cues.flagStatic", {
                  n: cue.slot + 1,
                  time: formatDuration(at),
                })}
                onPointerDown={startDrag(cue)}
                onPointerMove={moveDrag}
                onPointerUp={endDrag(cue)}
                onClick={onCueClick ? () => onCueClick(cue) : undefined}
                className={`hit-target absolute -top-0.5 grid h-4 min-w-4 place-items-center ${onMoveCue ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"} rounded-r-[3px] px-1 font-mono text-[10px] font-semibold text-on-key`}
                style={{ backgroundColor: color }}
              >
                {cue.slot + 1}
              </button>
            </div>
          );
        })}
        {anchors.map((a) => {
          const at = anchorDrag?.beat === a.beat ? anchorDrag.time : a.time;
          if (!inView(at)) return null;
          const selected = selectedAnchor === a.beat;
          return (
            <div key={a.beat} className="absolute inset-y-0" style={{ left: x(at) }}>
              <div className="absolute inset-y-0 w-px bg-primary" />
              <button
                type="button"
                aria-label={t("grid.anchorFlag", { beat: a.beat, time: formatDuration(at) })}
                aria-pressed={selected}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  onSelectAnchor?.(a.beat);
                  if (!onMoveAnchor) return;
                  e.currentTarget.setPointerCapture(e.pointerId);
                  setAnchorDrag({ beat: a.beat, time: a.time });
                }}
                onPointerMove={(e) => {
                  if (anchorDrag?.beat !== a.beat || !box.current) return;
                  setAnchorDrag({
                    beat: a.beat,
                    time: timeAt(e.clientX, box.current.getBoundingClientRect()),
                  });
                }}
                onPointerUp={() => {
                  if (anchorDrag?.beat === a.beat && Math.abs(anchorDrag.time - a.time) > 1e-4)
                    onMoveAnchor?.(a.beat, anchorDrag.time);
                  setAnchorDrag(null);
                }}
                className={`hit-target absolute bottom-1 size-3 -translate-x-1/2 rotate-45 cursor-ew-resize rounded-[2px] border ${selected ? "border-text bg-primary" : "border-primary bg-surface-1"}`}
              />
            </div>
          );
        })}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 w-0.5"
          style={{ left: x(time), backgroundColor: playhead }}
        />
      </div>
      {/* Section strip: 4 px under the waveform in the section colour at 70 %. */}
      <div className="relative h-1" aria-hidden>
        {segments.map((s, i) => (
          <span
            key={s.start}
            className="absolute inset-y-0 opacity-70"
            style={{
              left: x(s.start),
              width: Math.max(0, x(s.end) - x(s.start) - 1),
              backgroundColor: sectionColor(kinds[i] ?? s.label),
            }}
          />
        ))}
      </div>
      {showRuler && (
        <div className="relative h-4 font-mono text-[11px] text-text-3" aria-hidden>
          {ruler.map(({ at, bar }) => (
            <span key={bar} className="absolute" style={{ left: x(at) }}>
              {bar}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
