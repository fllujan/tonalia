import { useTranslation } from "react-i18next";
import { displayKey, fromWheel, type Key, type Notation } from "../lib/keys";
import { keyColor } from "../lib/keyStyle";
import { KeyChip } from "./KeyChip";

const WHEEL = Array.from({ length: 12 }, (_, i) => i + 1);

/** 24 keys in harmonic-wheel order: minor (A) row above, major (B) below. */
export function KeyGrid({
  current,
  notation,
  onPick,
  columns = 12,
  selected,
}: {
  current: Key | null;
  notation: Notation;
  onPick: (key: Key) => void;
  /** 12 = one wheel row per mode; 6 for narrow panels (two rows per mode). */
  columns?: 6 | 12;
  /** Several selected keys (multi-select use); overrides `current` for highlighting. */
  selected?: readonly Key[];
}) {
  const { t } = useTranslation();
  return (
    <div
      className={`grid gap-1.5 ${columns === 6 ? "grid-cols-6" : "grid-cols-12"}`}
      role="group"
      aria-label={t("edit.keyTitle")}
    >
      {(["A", "B"] as const).flatMap((letter) =>
        WHEEL.map((n) => {
          const key = fromWheel(n, letter);
          const isSelected = selected
            ? selected.some((k) => k.root === key.root && k.mode === key.mode)
            : current?.root === key.root && current.mode === key.mode;
          return (
            <button
              key={`${n}${letter}`}
              type="button"
              aria-pressed={isSelected}
              data-autofocus={(!selected && isSelected) || undefined}
              aria-label={`${displayKey(key, notation)} (${t(`key.mode.${key.mode}`)})`}
              onClick={() => onPick(key)}
              style={isSelected ? { outlineColor: keyColor(key) } : undefined}
              className={`rounded-pill ${isSelected ? "outline outline-2 outline-offset-2" : ""}`}
            >
              <KeyChip musicalKey={key} notation={notation} />
            </button>
          );
        }),
      )}
    </div>
  );
}
