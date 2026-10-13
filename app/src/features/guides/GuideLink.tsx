// A small «?» next to the words Tonalia borrows from mixing ("Diagonal", "+2 energía",
// "Choque de tonalidad"): it opens the guide that explains them, so the DJ need not know
// where the Guides live.
import { CircleHelp } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useViewStore } from "../navigation/viewStore";
import type { Guide } from "./guides";

export function GuideLink({ guide }: { guide: Guide }) {
  const { t } = useTranslation();
  const label = t("guides.whatIs", { guide: t(`guides.articles.${guide}.title`) });
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => useViewStore.getState().openGuide(guide)}
      className="grid size-6 shrink-0 place-items-center rounded-sm text-text-3 transition-colors duration-hover hover:bg-surface-3 hover:text-text"
    >
      <CircleHelp aria-hidden size={14} strokeWidth={1.5} />
    </button>
  );
}
