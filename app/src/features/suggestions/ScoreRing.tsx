// DESIGN 5.13: the idea's score (0-100) in a progress ring; the number is always shown.
// After a manual key change of B, the idea's own score stays in view, struck through:
// "100 → 62" (`from`).
import { scoreTone } from "./score";

const SIZE = 44;
const STROKE = 4;

export function ScoreRing({ score, from, label }: { score: number; from?: number; label: string }) {
  const r = (SIZE - STROKE) / 2;
  const length = 2 * Math.PI * r;
  const changed = from != null && from !== score;
  return (
    <div role="img" aria-label={label} className="flex shrink-0 items-center gap-1.5">
      {changed && (
        <span
          aria-hidden
          className="flex items-center gap-1 font-mono text-[12px] text-text-3 tabular"
        >
          <s>{from}</s>
          <span>→</span>
        </span>
      )}
      <span className="relative grid place-items-center">
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden>
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={r}
            fill="none"
            stroke="var(--color-surface-3)"
            strokeWidth={STROKE}
          />
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={r}
            fill="none"
            stroke={scoreTone(score)}
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={length}
            strokeDashoffset={length * (1 - Math.max(0, Math.min(100, score)) / 100)}
            transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
          />
        </svg>
        <span className="absolute font-mono text-[15px] font-semibold tabular">{score}</span>
      </span>
    </div>
  );
}
