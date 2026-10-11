import { useTranslation } from "react-i18next";

/** DESIGN 2.4: ten bars from cold to hot; lit bars take their level colour. */
export function EnergyMeter({
  level,
  size = "table",
}: {
  level: number;
  size?: "table" | "large";
}) {
  const { t } = useTranslation();
  const bar = size === "large" ? "h-6 w-1.5" : "h-3 w-[3px]";
  return (
    <span
      className="inline-flex items-center gap-1.5"
      role="img"
      aria-label={t("energy.label", { level })}
    >
      <span aria-hidden className={`flex items-end ${size === "large" ? "gap-1" : "gap-0.5"}`}>
        {Array.from({ length: 10 }, (_, i) => (
          <span
            key={i}
            className={`${bar} rounded-[1px]`}
            style={{
              backgroundColor:
                i < level ? `var(--color-energy-${i + 1})` : "var(--color-surface-3)",
            }}
          />
        ))}
      </span>
      <span className={`font-mono tabular ${size === "large" ? "text-data-lg" : "text-data"}`}>
        {level}
      </span>
    </span>
  );
}
