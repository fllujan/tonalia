// 0–5 star rating (DESIGN 6.11): five radios; clicking the current rating clears it.
import { Star } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

export function Stars({
  value,
  onChange,
  size = 16,
}: {
  value: number;
  onChange: (value: number) => void;
  size?: number;
}) {
  const { t } = useTranslation();
  // The rating the user just chose: its stars light up one after another. A rating that
  // arrives from the database renders still.
  const [chosen, setChosen] = useState<number | null>(null);
  return (
    <div role="radiogroup" aria-label={t("favorites.rating")} className="flex items-center">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={t("favorites.stars", { count: n })}
          onClick={() => {
            const next = value === n ? 0 : n;
            setChosen(next);
            onChange(next);
          }}
          className="grid size-6 place-items-center rounded-sm text-text-3 transition-colors duration-hover hover:text-accent"
        >
          <Star
            key={n <= value && chosen === value ? `pop-${value}` : "still"}
            aria-hidden
            size={size}
            strokeWidth={1.5}
            style={{ animationDelay: `${(n - 1) * 30}ms` }}
            className={
              n <= value
                ? `fill-accent text-accent ${chosen === value ? "motion-safe:animate-[star-pop_220ms_var(--ease-out)_both]" : ""}`
                : undefined
            }
          />
        </button>
      ))}
    </div>
  );
}
