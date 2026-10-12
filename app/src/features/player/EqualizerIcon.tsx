/**
 * The "playing" mark of a table row (DESIGN 5.5): three violet bars that move while the
 * track plays and rest at different heights when it is paused (or with reduced motion).
 */
export function EqualizerIcon({ playing }: { playing: boolean }) {
  return (
    <span aria-hidden className="flex h-3 items-end gap-[2px]">
      {[0.55, 1, 0.75].map((rest, i) => (
        <span
          key={i}
          className={`h-full w-[3px] origin-bottom rounded-[1px] bg-primary-ink ${playing ? "motion-safe:animate-[eq_900ms_ease-in-out_infinite]" : ""}`}
          style={{ transform: `scaleY(${rest})`, animationDelay: `${i * -300}ms` }}
        />
      ))}
    </span>
  );
}
