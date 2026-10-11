// Tonalia symbol: 12-segment harmonic ring in wheel colors with a sine wave across it.
// When `spinning`, only the ring turns (slowly); the wave stays still.
const SEGMENTS = Array.from({ length: 12 }, (_, i) => i + 1);

const WAVE = "M6 50 C13 34 21 34 28 50 S43 66 50 50 S65 34 72 50 S87 66 94 50";

function arcPath(index: number, r: number, gapDeg: number): string {
  const start = ((index * 30 - 90 + gapDeg / 2) * Math.PI) / 180;
  const end = (((index + 1) * 30 - 90 - gapDeg / 2) * Math.PI) / 180;
  const p = (a: number) =>
    `${(50 + r * Math.cos(a)).toFixed(2)} ${(50 + r * Math.sin(a)).toFixed(2)}`;
  return `M ${p(start)} A ${r} ${r} 0 0 1 ${p(end)}`;
}

export function LogoMark({ size = 40, spinning = false }: { size?: number; spinning?: boolean }) {
  const simple = size <= 20;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role="img"
      aria-label="Tonalia"
      className="block shrink-0 overflow-visible"
    >
      <g
        className={spinning ? "motion-safe:animate-[spin_40s_linear_infinite]" : undefined}
        style={{ transformBox: "view-box", transformOrigin: "50px 50px" }}
      >
        {SEGMENTS.map((n, i) => (
          <path
            key={n}
            d={arcPath(i, 40, simple ? 0 : 4)}
            fill="none"
            stroke={`var(--color-key-${n}b)`}
            strokeWidth={simple ? 14 : size >= 80 ? 9 : 11}
            strokeLinecap={simple ? "butt" : "round"}
          />
        ))}
      </g>
      <path
        d={WAVE}
        fill="none"
        stroke="var(--color-text)"
        strokeWidth={simple ? 8 : size >= 80 ? 5 : 8}
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Logo({ size = 26 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <LogoMark size={size} />
      <span className="font-display text-[19px] font-medium tracking-[-0.01em]">Tonalia</span>
    </span>
  );
}
