// Tonalia symbol: 12-segment harmonic ring in wheel colors with a sine wave across it.
const SEGMENTS = Array.from({ length: 12 }, (_, i) => i + 1);

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
      className={spinning ? "motion-safe:animate-[spin_40s_linear_infinite]" : undefined}
    >
      {SEGMENTS.map((n, i) => (
        <path
          key={n}
          d={arcPath(i, 40, simple ? 0 : 4)}
          fill="none"
          stroke={`var(--color-key-${n}b)`}
          strokeWidth={simple ? 14 : 10}
          strokeLinecap={simple ? "butt" : "round"}
        />
      ))}
      <path
        d="M 18 50 C 26 30, 34 30, 42 50 S 58 70, 66 50 S 78 34, 82 50"
        fill="none"
        stroke="var(--color-text)"
        strokeWidth={simple ? 8 : 5}
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2">
      <LogoMark size={size} />
      <span className="font-display text-section font-medium tracking-[-0.01em]">Tonalia</span>
    </span>
  );
}
