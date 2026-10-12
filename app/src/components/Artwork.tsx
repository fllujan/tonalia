// Track artwork (DESIGN, Rueda armónica and Marca): the file's cover, or — when the file
// has none or it cannot load — a cover generated from the brand's geometry: a small
// harmonic wheel (outer ring major, inner ring minor) with the track's key lit, the sine
// wave across it, on a ground tinted with the key's colour. Without a key it stays neutral.
import { convertFileSrc } from "@tauri-apps/api/core";
import { useState } from "react";
import { keyColor } from "../lib/keyStyle";
import { type Key, wheelLetter, wheelNumber } from "../lib/keys";
import { arcPath, WAVE } from "./brand/geometry";

const SEGMENTS = Array.from({ length: 12 }, (_, i) => i);

export function Artwork({
  path,
  musicalKey,
  size,
  className = "",
  style,
  lazy = false,
}: {
  path: string | null | undefined;
  musicalKey: Key | null;
  /** Rendered size in px: below 40 px the wheel simplifies to one ring. */
  size: number;
  /** Size, radius and border classes; the cover fills the box. */
  className?: string;
  style?: React.CSSProperties;
  lazy?: boolean;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  if (path && failed !== path) {
    return (
      <img
        alt=""
        src={convertFileSrc(path)}
        loading={lazy ? "lazy" : undefined}
        onError={() => setFailed(path)}
        className={`shrink-0 bg-surface-3 object-cover ${className}`}
        style={style}
      />
    );
  }
  return <GeneratedCover musicalKey={musicalKey} size={size} className={className} style={style} />;
}

function GeneratedCover({
  musicalKey,
  size,
  className,
  style,
}: {
  musicalKey: Key | null;
  size: number;
  className: string;
  style: React.CSSProperties | undefined;
}) {
  const color = musicalKey ? keyColor(musicalKey) : "var(--color-text-3)";
  const ground = musicalKey
    ? `linear-gradient(145deg, color-mix(in srgb, ${color} 30%, var(--color-surface-3)), color-mix(in srgb, ${color} 8%, var(--color-surface-2)))`
    : "linear-gradient(145deg, var(--color-surface-3), var(--color-surface-2))";
  const simple = size < 40;
  const lit = musicalKey ? wheelNumber(musicalKey) - 1 : -1;
  const minor = musicalKey ? wheelLetter(musicalKey) === "A" : false;
  const rings = simple
    ? [{ r: 31, width: 12, isMinor: minor }]
    : [
        { r: 36, width: 8, isMinor: false },
        { r: 25, width: 8, isMinor: true },
      ];
  return (
    <span
      aria-hidden
      data-generated
      className={`block shrink-0 overflow-hidden ${className}`}
      style={{ ...style, background: ground }}
    >
      <svg viewBox="0 0 100 100" className="block size-full">
        {rings.map((ring) =>
          SEGMENTS.map((i) => {
            const on = i === lit && ring.isMinor === minor;
            return (
              <path
                key={`${ring.r}-${i}`}
                d={arcPath(i, ring.r, simple ? 4 : 3)}
                fill="none"
                stroke={color}
                strokeWidth={ring.width}
                opacity={on ? 1 : musicalKey ? 0.22 : 0.3}
                {...(on && musicalKey
                  ? { "data-lit": `${wheelNumber(musicalKey)}${wheelLetter(musicalKey)}` }
                  : {})}
              />
            );
          }),
        )}
        <path
          d={WAVE}
          fill="none"
          stroke="var(--color-text)"
          strokeOpacity={0.9}
          strokeWidth={simple ? 9 : 5}
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}
