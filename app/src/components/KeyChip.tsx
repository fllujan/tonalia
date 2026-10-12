import { Pencil, TriangleAlert } from "lucide-react";
import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { formatKey, type Key, type Notation } from "../lib/keys";
import { keyColor, LOW_CONFIDENCE } from "../lib/keyStyle";

interface KeyChipProps {
  musicalKey: Key;
  notation: Notation;
  confidence?: number | null;
  edited?: boolean;
}

/**
 * Key pill (DESIGN 2.3): the key's wheel colour at 20 % as background and 60 % as border,
 * text in the full colour (darkened in light mode). The key is always written out, so it
 * never relies on colour alone; low confidence adds a dashed border and a warning icon.
 */
export function KeyChip({ musicalKey, notation, confidence, edited = false }: KeyChipProps) {
  const { t } = useTranslation();
  const color = keyColor(musicalKey);
  const label = formatKey(musicalKey, notation);
  const low = !edited && confidence != null && confidence < LOW_CONFIDENCE;
  const style = {
    "--chip": color,
    backgroundColor: "color-mix(in srgb, var(--chip) 20%, transparent)",
    borderColor: "color-mix(in srgb, var(--chip) 60%, transparent)",
    color: "color-mix(in srgb, var(--chip) var(--key-text-mix), var(--key-text-base))",
  } as CSSProperties;
  const details = [
    edited ? t("key.edited") : null,
    low ? t("key.lowConfidence", { percent: Math.round((confidence ?? 0) * 100) }) : null,
  ].filter(Boolean);
  return (
    <span
      style={style}
      title={details.length ? `${label} · ${details.join(" · ")}` : label}
      className={`inline-flex h-[22px] items-center gap-1 rounded-pill border px-2 font-mono text-data font-semibold ${low ? "border-dashed" : ""}`}
    >
      {label}
      {low && <TriangleAlert aria-label={t("key.lowConfidenceShort")} size={11} strokeWidth={2} />}
      {edited && <Pencil aria-label={t("key.edited")} size={10} strokeWidth={2} />}
    </span>
  );
}
