// Illustrations for the guides (DESIGN 6.14), drawn with the design tokens.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { fromWheel, type Key, type Notation } from "../../lib/keys";
import { HarmonicWheel } from "../wheel/HarmonicWheel";

function Figure({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <figure className="flex flex-col gap-3 rounded-md border border-border bg-surface-2 p-4">
      {children}
      <figcaption className="text-[12px] text-text-3">{label}</figcaption>
    </figure>
  );
}

/** The real wheel as a playground: picking a key only changes the example. */
export function WheelFigure({ notation }: { notation: Notation }) {
  const { t } = useTranslation();
  const [key, setKey] = useState<Key>(fromWheel(8, "A"));
  return (
    <Figure label={t("guides.figures.wheelTry")}>
      <HarmonicWheel current={key} notation={notation} onPick={setKey} size={280} legend />
    </Figure>
  );
}

const CURVES = [
  ["energyArc", [4, 5, 5, 6, 7, 8, 9, 8, 6, 5]],
  ["energyRise", [3, 4, 4, 5, 5, 6, 7, 7, 8, 9]],
  ["energyWaves", [5, 6, 7, 6, 7, 8, 7, 8, 9, 7]],
] as const;

/** Track-by-track energy of three set shapes, bars in the energy scale. */
export function EnergyFigure() {
  const { t } = useTranslation();
  return (
    <Figure label={t("guides.figures.energy")}>
      <div role="img" aria-label={t("guides.figures.energy")} className="grid gap-4 sm:grid-cols-3">
        {CURVES.map(([name, levels]) => (
          <div key={name} className="flex flex-col gap-2">
            <div aria-hidden className="flex h-20 items-end gap-1">
              {levels.map((level, i) => (
                <div key={i} className="flex flex-1 flex-col items-center gap-1">
                  <div
                    className="w-full rounded-t-[3px]"
                    style={{
                      height: `${level * 7}px`,
                      backgroundColor: `var(--color-energy-${level})`,
                    }}
                  />
                </div>
              ))}
            </div>
            <span className="text-[12px] text-text-2">{t(`guides.figures.${name}`)}</span>
          </div>
        ))}
      </div>
    </Figure>
  );
}

const BARS = 32;
const CELL = 18;
const GAP = 2;
// Figure text is 10.5 units: the figures draw at ~1.06×, so it lands at 11 px or more,
// the smallest size of the type scale (DESIGN).
const PHRASE_COLORS = ["cue-1", "cue-2", "cue-3", "cue-4"] as const;

/** 32 bars in four 8-bar phrases, with the 16 and 32-bar groupings and cue flags. */
export function PhraseFigure() {
  const { t } = useTranslation();
  const width = BARS * (CELL + GAP) - GAP;
  const x = (bar: number) => bar * (CELL + GAP);
  return (
    <Figure label={t("guides.figures.phrases")}>
      <svg
        role="img"
        aria-label={t("guides.figures.phrases")}
        viewBox={`0 -24 ${width} 128`}
        className="w-full max-w-[680px]"
      >
        {[0, 16].map((bar, i) => (
          <g key={bar}>
            <line
              x1={x(bar) + 1}
              x2={x(bar) + 1}
              y1={-20}
              y2={28}
              stroke={`var(--color-${PHRASE_COLORS[i * 2]})`}
              strokeWidth={2}
            />
            <rect
              x={x(bar) + 1}
              y={-23}
              width={16}
              height={13}
              rx={2}
              fill={`var(--color-${PHRASE_COLORS[i * 2]})`}
            />
            <text
              x={x(bar) + 9}
              y={-16.5}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={10.5}
              fill="var(--color-on-key)"
              className="font-mono font-semibold"
            >
              {i + 1}
            </text>
          </g>
        ))}
        {Array.from({ length: BARS }, (_, bar) => (
          <g key={bar}>
            <rect
              x={x(bar)}
              y={0}
              width={CELL}
              height={28}
              rx={3}
              fill={`var(--color-${PHRASE_COLORS[Math.floor(bar / 8)]})`}
              fillOpacity={bar % 8 === 0 ? 0.9 : 0.35}
            />
            {bar % 4 === 0 && (
              <text
                x={x(bar) + CELL / 2}
                y={40}
                textAnchor="middle"
                fontSize={10.5}
                fill="var(--color-text-3)"
                className="font-mono"
              >
                {bar + 1}
              </text>
            )}
          </g>
        ))}
        {[
          [0, 8, 52, "phrase8"],
          [8, 16, 52, "phrase8"],
          [16, 24, 52, "phrase8"],
          [24, 32, 52, "phrase8"],
          [0, 16, 74, "phrase16"],
          [16, 32, 74, "phrase16"],
          [0, 32, 96, "phrase32"],
        ].map(([from, to, y, label]) => {
          const x0 = x(from as number);
          const x1 = x(to as number) - GAP;
          const yy = y as number;
          return (
            <g key={`${from}-${to}`}>
              <path
                d={`M${x0} ${yy - 8} V${yy - 4} H${x1} V${yy - 8}`}
                fill="none"
                stroke="var(--color-border-strong)"
              />
              <text
                x={(x0 + x1) / 2}
                y={yy + 6}
                textAnchor="middle"
                fontSize={10.5}
                fill="var(--color-text-2)"
              >
                {t(`guides.figures.${label as string}`)}
              </text>
            </g>
          );
        })}
      </svg>
    </Figure>
  );
}

/** Vocals of track A entering on a phrase over the instrumental of track B. */
export function StemsFigure() {
  const { t } = useTranslation();
  const bars = 16;
  const w = 640;
  const step = w / bars;
  const lane = (y: number, color: string, from: number, seed: number) =>
    Array.from({ length: bars * 4 }, (_, i) => {
      const bar = i / 4;
      if (bar < from) return null;
      const h = 8 + ((Math.sin(i * 1.7 + seed) + 1) / 2) * 18;
      return (
        <rect
          key={i}
          x={i * (step / 4) + 1}
          y={y + (28 - h) / 2}
          width={step / 4 - 2}
          height={h}
          rx={1.5}
          fill={color}
        />
      );
    });
  return (
    <Figure label={t("guides.figures.stems")}>
      <svg
        role="img"
        aria-label={t("guides.figures.stems")}
        viewBox={`0 0 ${w} 96`}
        className="w-full max-w-[680px]"
      >
        {Array.from({ length: bars / 8 + 1 }, (_, i) => (
          <line
            key={i}
            x1={i * 8 * step}
            x2={i * 8 * step}
            y1={0}
            y2={96}
            stroke="var(--color-border-strong)"
            strokeDasharray="3 3"
          />
        ))}
        <text x={4} y={10} fontSize={10.5} fill="var(--color-text-2)">
          {t("guides.figures.vocalsA")}
        </text>
        {lane(14, "var(--color-stem-vocals)", 8, 0)}
        <text x={4} y={58} fontSize={10.5} fill="var(--color-text-2)">
          {t("guides.figures.instrumentalB")}
        </text>
        {lane(62, "var(--color-stem-instrumental)", 0, 2)}
      </svg>
    </Figure>
  );
}
