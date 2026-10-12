// Energy curve editor (DESIGN 6.12): a 1–10 chart over the energy colour scale with
// draggable points and the templates. Moving, adding (double click on the chart) or
// removing (double click on a point, or Delete) a point turns the curve into a drawn one.
// Each point is a slider: ↑/↓ change its energy, ←/→ move it along the set.
import { type KeyboardEvent, type PointerEvent, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Segmented } from "../../components/Segmented";
import type { CurvePoint } from "../../lib/rpc.types";
import { type CurvePreset, useBuilderStore } from "./builderStore";
import { addPoint, movePoint, pointsOf, removePoint } from "./curve";

const W = 320;
const H = 180;
const PAD = { left: 24, right: 10, top: 10, bottom: 18 };
const innerW = W - PAD.left - PAD.right;
const innerH = H - PAD.top - PAD.bottom;
const sx = (x: number) => PAD.left + x * innerW;
const sy = (e: number) => PAD.top + (1 - (e - 1) / 9) * innerH;

const PRESETS = ["warmup_peak_cooldown", "flat", "ascending"] as const;

export function CurveEditor() {
  const { t, i18n } = useTranslation();
  const preset = useBuilderStore((s) => s.preset);
  const stored = useBuilderStore((s) => s.points);
  const setPoints = useBuilderStore((s) => s.setPoints);
  const setPreset = useBuilderStore((s) => s.setPreset);
  const points = [...pointsOf(preset, stored)].sort((a, b) => a.x - b.x);
  const svg = useRef<SVGSVGElement>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const pct = new Intl.NumberFormat(i18n.language, { style: "percent", maximumFractionDigits: 0 });
  const num = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 });

  const toCurve = (e: { clientX: number; clientY: number }) => {
    const rect = svg.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return null;
    const x = ((e.clientX - rect.left) / rect.width) * W;
    const y = ((e.clientY - rect.top) / rect.height) * H;
    return { x: (x - PAD.left) / innerW, energy: 1 + (1 - (y - PAD.top) / innerH) * 9 };
  };
  const update = (next: CurvePoint[]) => setPoints(next);

  const onKey = (i: number) => (e: KeyboardEvent) => {
    const p = points[i];
    if (!p) return;
    const moves: Record<string, [number, number]> = {
      ArrowUp: [0, 0.5],
      ArrowDown: [0, -0.5],
      ArrowRight: [0.05, 0],
      ArrowLeft: [-0.05, 0],
    };
    if (e.key === "Delete" || e.key === "Backspace") update(removePoint(points, i));
    else if (moves[e.key]) {
      const [dx, de] = moves[e.key] as [number, number];
      update(movePoint(points, i, p.x + dx, p.energy + de));
    } else return;
    e.preventDefault();
  };
  const onDown = (i: number) => (e: PointerEvent<SVGGElement>) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDragging(i);
  };
  const onMove = (i: number) => (e: PointerEvent<SVGGElement>) => {
    if (dragging !== i) return;
    const at = toCurve(e);
    if (at) update(movePoint(points, i, at.x, at.energy));
  };

  return (
    <div className="flex flex-col gap-2">
      <Segmented
        size="sm"
        value={preset}
        options={PRESETS.map((v) => ({
          value: v as CurvePreset,
          label: t(`builder.presets.${v}`),
        }))}
        onChange={(v) => v !== "custom" && setPreset(v)}
        label={t("builder.template")}
      />
      <svg
        ref={svg}
        role="group"
        aria-label={t("builder.curve")}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full touch-none select-none rounded-sm border border-border bg-surface-2"
        onDoubleClick={(e) => {
          if ((e.target as Element).tagName === "circle") return;
          const at = toCurve(e);
          if (at && at.x > 0 && at.x < 1) update(addPoint(points, at.x, at.energy));
        }}
      >
        {/* The energy scale as ten steps behind the curve (DESIGN 2.4): each level's band,
            split from the next by a 1 px gap so they read as steps, not a gradient. The
            wash stays light (ten hues at a quarter turned muddy over the night surface; at a
            tenth they vanished) and the full colour lives in a 4 px key along the left edge. */}
        {Array.from({ length: 10 }, (_, i) => {
          const top = Math.max(PAD.top, sy(i + 1.5)) + (i < 9 ? 0.5 : 0);
          const bottom = Math.min(PAD.top + innerH, sy(i + 0.5)) - (i > 0 ? 0.5 : 0);
          const fill = `var(--color-energy-${i + 1})`;
          return (
            <g key={i} data-energy-band={i + 1}>
              <rect
                x={PAD.left}
                y={top}
                width={innerW}
                height={bottom - top}
                fill={fill}
                opacity={0.16}
              />
              <rect x={PAD.left} y={top} width={4} height={bottom - top} fill={fill} />
            </g>
          );
        })}
        {/* The bands are the grid: only the level numbers on the left. */}
        {[2, 4, 6, 8, 10].map((e) => (
          <g key={e}>
            <text
              x={PAD.left - 6}
              y={sy(e) + 3}
              textAnchor="end"
              className="fill-text-3 font-mono text-[9px]"
            >
              {e}
            </text>
          </g>
        ))}
        <polyline
          points={points.map((p) => `${sx(p.x)},${sy(p.energy)}`).join(" ")}
          fill="none"
          stroke="var(--color-primary)"
          strokeWidth={2}
        />
        {points.map((p, i) => (
          // A 24 px invisible disc takes the pointer; the 12 px point is only drawn.
          <g
            key={`${i}-${points.length}`}
            role="slider"
            tabIndex={0}
            aria-label={t("builder.point", { n: i + 1 })}
            aria-valuemin={1}
            aria-valuemax={10}
            aria-valuenow={p.energy}
            aria-valuetext={t("builder.pointValue", {
              energy: num.format(p.energy),
              at: pct.format(p.x),
            })}
            className="group cursor-grab outline-none active:cursor-grabbing"
            onPointerDown={onDown(i)}
            onPointerMove={onMove(i)}
            onPointerUp={() => setDragging(null)}
            onKeyDown={onKey(i)}
            onDoubleClick={() => update(removePoint(points, i))}
          >
            <circle cx={sx(p.x)} cy={sy(p.energy)} r={12} fill="transparent" />
            <circle
              cx={sx(p.x)}
              cy={sy(p.energy)}
              r={dragging === i ? 7 : 6}
              fill="var(--color-surface-1)"
              stroke="var(--color-primary)"
              strokeWidth={2}
              className="pointer-events-none group-focus-visible:stroke-[3]"
            />
          </g>
        ))}
      </svg>
      <p className="text-[12px] text-text-3">
        {preset === "flat" ? t("builder.flatHint") : t("builder.curveHint")}
      </p>
    </div>
  );
}
