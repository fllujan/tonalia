// Empty states (DESIGN 5.15 / 6.15): a simple line drawing of the harmonic wheel and a wave,
// a title, one sentence on what to do and, when it helps, the action that fixes it.
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/** Twelve arc segments and a sine wave, in thin lines of the current colour. */
export function WheelWave({ size = 96 }: { size?: number }) {
  const r = 40;
  const gap = 4; // degrees between segments
  const arcs = Array.from({ length: 12 }, (_, i) => {
    const a0 = ((i * 30 + gap / 2 - 90) * Math.PI) / 180;
    const a1 = (((i + 1) * 30 - gap / 2 - 90) * Math.PI) / 180;
    const p = (a: number) =>
      `${(50 + r * Math.cos(a)).toFixed(2)} ${(50 + r * Math.sin(a)).toFixed(2)}`;
    return `M ${p(a0)} A ${r} ${r} 0 0 1 ${p(a1)}`;
  });
  return (
    <svg
      aria-hidden
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
    >
      {arcs.map((d, i) => (
        <path key={i} d={d} strokeWidth={2} opacity={0.35 + (i % 3) * 0.15} />
      ))}
      <circle cx={50} cy={50} r={28} strokeWidth={1} opacity={0.25} />
      <path
        d="M 14 50 C 22 32, 30 32, 38 50 S 54 68, 62 50 S 78 32, 86 50"
        strokeWidth={2}
        className="text-primary-ink"
        stroke="currentColor"
      />
    </svg>
  );
}

export function EmptyState({
  title,
  text,
  icon: Icon,
  action,
  compact = false,
}: {
  title: string;
  text?: ReactNode;
  /** A small badge on the drawing that says which empty state this is. */
  icon?: LucideIcon;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div
      className={`flex flex-col items-center gap-2 px-6 text-center ${compact ? "py-10" : "py-16"}`}
    >
      <div className="relative mb-2 text-text-3">
        <WheelWave size={compact ? 72 : 96} />
        {Icon && (
          <span className="absolute -bottom-1 -right-1 grid size-8 place-items-center rounded-pill border border-border bg-surface-2 text-text-2">
            <Icon aria-hidden size={16} strokeWidth={1.5} />
          </span>
        )}
      </div>
      <h2 className="text-section text-text">{title}</h2>
      {text && <p className="max-w-md text-body text-text-2">{text}</p>}
      {action && <div className="mt-2 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}
