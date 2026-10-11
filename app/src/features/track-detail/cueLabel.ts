import { useTranslation } from "react-i18next";
import type { Cue } from "../../lib/rpc.types";
import { AUTO_CUE_LABELS } from "../../lib/sections";

/** Display name of a cue: auto labels are section keys to translate, user labels are text. */
export function useCueLabel() {
  const { t } = useTranslation();
  return (cue: Cue) =>
    cue.label && cue.source === "auto" && AUTO_CUE_LABELS.has(cue.label)
      ? t(`sections.${cue.label}`)
      : (cue.label ?? "");
}
