// A key with its pitch shift (DESIGN 5.2, "Desplazado"): "8A → 10A +2 st", the same on
// the decks, in the ideas list and in favourites. Without a shift it is the plain chip.
import { ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatSemitones } from "../lib/format";
import { type Key, type Notation, shift as shiftKey } from "../lib/keys";
import { KeyChip } from "./KeyChip";

export function ShiftedKey({
  original,
  shift,
  notation,
  confidence,
  edited = false,
}: {
  original: Key;
  shift: number;
  notation: Notation;
  /** Of the original key (low confidence adds its warning). */
  confidence?: number | null;
  /** The original key was set by hand (pencil). */
  edited?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <span className="flex shrink-0 items-center gap-1">
      <KeyChip
        musicalKey={original}
        notation={notation}
        confidence={confidence ?? null}
        edited={edited}
      />
      {shift !== 0 && (
        <>
          <ArrowRight
            aria-label={t("tags.becomes")}
            size={12}
            strokeWidth={1.5}
            className="shrink-0 text-text-3"
          />
          <KeyChip musicalKey={shiftKey(original, shift)} notation={notation} />
          <span className="whitespace-nowrap font-mono text-[11px] text-text-2">
            {t("pro.semitones", { value: formatSemitones(shift) })}
          </span>
        </>
      )}
    </span>
  );
}
