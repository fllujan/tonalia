// DESIGN 5.13: the idea's score (0-100) in a progress ring; the number is always shown.
import { scoreTone } from "./score";

const SIZE = 44;
const STROKE = 4;

export function ScoreRing({ score, label }: { score: number; label: string }) {
  const r = (SIZE - STROKE) / 2;
  const length = 2 * Math.PI * r;
  return (
    <div role="img" aria-label={label} className="relative grid shrink-0 place-items-center">
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
    </div>
  );
}
