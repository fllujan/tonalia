// The "why" of an idea (SPEC 2.15): the engine sends codes, the UI writes them.
import type { TFunction } from "i18next";
import type { SuggestReason } from "../../lib/rpc.types";

const signed = (n: number, locale: string, digits = 0) =>
  `${n > 0 ? "+" : n < 0 ? "−" : "±"}${new Intl.NumberFormat(locale, {
    maximumFractionDigits: digits,
  }).format(Math.abs(n))}`;

export function reasonText(t: TFunction, reason: SuggestReason, locale: string): string {
  const value = reason.value ?? 0;
  switch (reason.kind) {
    case "key":
      return t(`pro.reasons.key.${reason.code}`);
    case "shift":
      return t("pro.reasons.shift", { value: signed(value, locale) });
    case "bpm":
      if (reason.code === "same" && Math.abs(value) < 0.05) return t("pro.reasons.bpm.equal");
      return t(`pro.reasons.bpm.${reason.code}`, { value: signed(value, locale, 1) });
    case "vocals":
      return t(`pro.reasons.vocals.${reason.code}`);
    case "energy":
      return t(`pro.reasons.energy.${reason.code}`, { value: signed(value, locale) });
    case "genre":
      return t(`pro.reasons.genre.${reason.code}`);
  }
}
