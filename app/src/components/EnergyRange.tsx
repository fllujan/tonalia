// Energy range slider (DESIGN 5.8 and 6.3): two handles over the 1–10 energy scale, the
// levels inside the range lit in their colour and the rest at 25 %. 1 and 10 mean "no
// bound", so the filter keeps null there. Two native range inputs, so each handle is a
// real slider for the keyboard and assistive technology.
import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";

const LEVELS = Array.from({ length: 10 }, (_, i) => i + 1);

export interface EnergyRangeValue {
  energyMin?: number | null;
  energyMax?: number | null;
}

export function EnergyRange({
  value,
  onChange,
  className = "w-[260px]",
}: {
  value: EnergyRangeValue;
  /** Only the bound that moved: `{ energyMin }` or `{ energyMax }`. */
  onChange: (patch: { energyMin?: number | null; energyMax?: number | null }) => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const lo = value.energyMin ?? 1;
  const hi = value.energyMax ?? 10;
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <div className="range-dual relative h-6 min-w-0 flex-1">
        {/* Each level's band is centred on its stop (the thumb is 12 px wide). */}
        <div
          aria-hidden
          className="pointer-events-none absolute top-1/2 grid h-2 -translate-y-1/2 grid-cols-10 gap-0.5"
          style={{
            left: "calc(6px - (100% - 12px) / 18)",
            right: "calc(6px - (100% - 12px) / 18)",
          }}
        >
          {LEVELS.map((level) => (
            <span
              key={level}
              className="rounded-[2px] transition-opacity duration-hover"
              style={
                {
                  backgroundColor: `var(--color-energy-${level})`,
                  opacity: level >= lo && level <= hi ? 1 : 0.25,
                } as CSSProperties
              }
            />
          ))}
        </div>
        <input
          type="range"
          min={1}
          max={10}
          step={1}
          value={lo}
          aria-label={t("filters.energyMin")}
          onChange={(e) => {
            const min = Math.min(Number(e.target.value), hi);
            onChange({ energyMin: min > 1 ? min : null });
          }}
          // When both handles meet at the top, the low one must stay grabbable.
          style={{ zIndex: lo > 5 ? 2 : 1 }}
        />
        <input
          type="range"
          min={1}
          max={10}
          step={1}
          value={hi}
          aria-label={t("filters.energyMax")}
          onChange={(e) => {
            const max = Math.max(Number(e.target.value), lo);
            onChange({ energyMax: max < 10 ? max : null });
          }}
        />
      </div>
      <span className="w-10 shrink-0 font-mono text-data text-text-2" aria-hidden>
        {lo === hi ? lo : `${lo}–${hi}`}
      </span>
    </div>
  );
}
