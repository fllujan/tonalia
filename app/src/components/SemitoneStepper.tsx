// Semitone stepper (DESIGN 5.8): "− +2 +". The value doubles as a reset button when it is
// not at its resting point. Arrow keys inside the group step too.
import { Minus, Plus } from "lucide-react";
import type { KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { formatSemitones } from "../lib/format";

export function SemitoneStepper({
  value,
  min,
  max,
  onChange,
  label,
  resettable,
  onReset,
  color,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  label: string;
  /** The value is not the resting one (0, or the idea's shift for deck B). */
  resettable: boolean;
  onReset: () => void;
  color?: string;
}) {
  const { t } = useTranslation();
  const step = (delta: number) => {
    const next = Math.max(min, Math.min(max, value + delta));
    if (next !== value) onChange(next);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "ArrowUp" || e.key === "ArrowRight") step(1);
    else if (e.key === "ArrowDown" || e.key === "ArrowLeft") step(-1);
    else return;
    e.preventDefault();
  };
  const button =
    "grid size-7 place-items-center rounded-sm border border-border bg-surface-3 text-text-2 hover:text-text disabled:opacity-40";
  return (
    <div role="group" aria-label={label} onKeyDown={onKeyDown} className="flex items-center gap-1">
      <button
        type="button"
        aria-label={t("pro.pitchDown")}
        disabled={value <= min}
        onClick={() => step(-1)}
        className={button}
      >
        <Minus aria-hidden size={14} strokeWidth={1.5} />
      </button>
      {resettable ? (
        <button
          type="button"
          aria-label={t("pro.pitchReset", { value: formatSemitones(value) })}
          title={t("pro.pitchReset", { value: formatSemitones(value) })}
          onClick={onReset}
          className="h-7 min-w-9 rounded-sm px-1 text-center font-mono text-data tabular hover:bg-surface-3"
          style={color ? { color } : undefined}
        >
          {formatSemitones(value)}
        </button>
      ) : (
        <output className="min-w-9 text-center font-mono text-data tabular" aria-live="polite">
          {formatSemitones(value)}
        </output>
      )}
      <button
        type="button"
        aria-label={t("pro.pitchUp")}
        disabled={value >= max}
        onClick={() => step(1)}
        className={button}
      >
        <Plus aria-hidden size={14} strokeWidth={1.5} />
      </button>
    </div>
  );
}
