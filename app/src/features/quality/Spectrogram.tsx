// DESIGN 6.23 — quality spectrogram (SPEC 13.5): frequencies up the side, time across,
// loudness as a colour scale made of tokens (night → violet → coral → amber → ink), with
// the cut-off as a dashed line and a sentence that says what it means.
import { LoaderCircle } from "lucide-react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { errorMessage } from "../../lib/errors";
import type { SpectrogramResult } from "../../lib/rpc.types";
import { explain, useSpectrogram } from "./api";

/** The colour scale: token names and where they sit (0 = silence, 1 = loudest). */
const SCALE: [string, number][] = [
  ["--color-bg", 0],
  ["--color-primary", 0.4],
  ["--color-accent", 0.72],
  ["--color-warning", 0.9],
  ["--color-text", 1],
];
const MARKS_KHZ = [5, 10, 15, 20];

function rgb(color: string): [number, number, number] {
  const hex = color.trim().match(/^#([0-9a-f]{6})$/i);
  if (hex?.[1]) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const parts = color.match(/\d+(\.\d+)?/g)?.map(Number) ?? [0, 0, 0];
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

/** 256 colours along the token scale, read from the current theme. */
function palette(el: Element): Uint8ClampedArray {
  const style = getComputedStyle(el);
  const stops = SCALE.map(([name, at]) => [rgb(style.getPropertyValue(name)), at] as const);
  const out = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const v = i / 255;
    let k = 0;
    while (k < stops.length - 2 && v > (stops[k + 1]?.[1] ?? 1)) k++;
    const [a, at] = stops[k] as (typeof stops)[number];
    const [b, bt] = stops[k + 1] as (typeof stops)[number];
    const f = Math.min(1, Math.max(0, (v - at) / (bt - at || 1)));
    for (let c = 0; c < 3; c++) out[i * 3 + c] = (a[c] ?? 0) + ((b[c] ?? 0) - (a[c] ?? 0)) * f;
  }
  return out;
}

function Picture({ spec, height }: { spec: SpectrogramResult; height: number }) {
  const { t } = useTranslation();
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx || spec.columns === 0) return;
    const bytes = Uint8Array.from(atob(spec.data), (c) => c.charCodeAt(0));
    const colours = palette(el);
    el.width = spec.columns;
    el.height = spec.rows;
    const image = ctx.createImageData(spec.columns, spec.rows);
    for (let r = 0; r < spec.rows; r++) {
      const y = spec.rows - 1 - r; // row 0 = lowest frequencies, at the bottom
      for (let c = 0; c < spec.columns; c++) {
        const v = bytes[r * spec.columns + c] ?? 0;
        const o = (y * spec.columns + c) * 4;
        image.data[o] = colours[v * 3] ?? 0;
        image.data[o + 1] = colours[v * 3 + 1] ?? 0;
        image.data[o + 2] = colours[v * 3 + 2] ?? 0;
        image.data[o + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
  }, [spec]);
  const at = (hz: number) => `${100 - (hz / spec.maxHz) * 100}%`;
  const verdict = explain(spec, t, "en").verdict;
  return (
    <div className="flex gap-2">
      <div className="relative w-8 shrink-0 font-mono text-[10px] text-text-3" style={{ height }}>
        {MARKS_KHZ.filter((k) => k * 1000 < spec.maxHz).map((k) => (
          <span key={k} className="absolute right-0 -translate-y-1/2" style={{ top: at(k * 1000) }}>
            {k}k
          </span>
        ))}
      </div>
      <div
        className="relative min-w-0 flex-1 overflow-hidden rounded-sm border border-border"
        style={{ height }}
      >
        <canvas
          ref={canvas}
          role="img"
          aria-label={t("spectrogram.label")}
          className="block h-full w-full [image-rendering:pixelated]"
        />
        <div
          aria-hidden
          data-testid="cutoff-line"
          className={`absolute inset-x-0 border-t border-dashed ${verdict === "fake" ? "border-warning" : "border-text"}`}
          style={{ top: at(spec.cutoffHz) }}
        />
      </div>
    </div>
  );
}

export function SpectrogramView({ trackId, height = 128 }: { trackId: number; height?: number }) {
  const { t, i18n } = useTranslation();
  const query = useSpectrogram(trackId);
  if (query.isPending)
    return (
      <p className="flex items-center gap-2 text-[12px] text-text-3" style={{ minHeight: height }}>
        <LoaderCircle aria-hidden size={14} className="motion-safe:animate-spin" />
        {t("spectrogram.loading")}
      </p>
    );
  if (query.isError)
    return (
      <p role="alert" className="text-[12px] text-danger">
        {t("spectrogram.failed", { error: errorMessage(query.error) })}
      </p>
    );
  const spec = query.data;
  const { verdict, text } = explain(spec, t, i18n.language);
  return (
    <figure className="flex flex-col gap-2">
      <Picture spec={spec} height={height} />
      <figcaption
        className={`pl-10 text-[12px] ${verdict === "fake" ? "text-warning" : verdict === "suspect" ? "text-text" : "text-text-2"}`}
      >
        {text}
      </figcaption>
    </figure>
  );
}
