// 0–5 star rating (DESIGN 6.11): five radios; clicking the current rating clears it.
import { Star } from "lucide-react";
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
  return (
    <div role="radiogroup" aria-label={t("favorites.rating")} className="flex items-center">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={t("favorites.stars", { count: n })}
          onClick={() => onChange(value === n ? 0 : n)}
          className="grid size-6 place-items-center rounded-sm text-text-3 hover:text-accent"
        >
          <Star
            aria-hidden
            size={size}
            strokeWidth={1.5}
            className={n <= value ? "fill-accent text-accent" : undefined}
          />
        </button>
      ))}
    </div>
  );
}
