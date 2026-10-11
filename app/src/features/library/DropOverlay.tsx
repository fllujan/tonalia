import { FolderDown } from "lucide-react";
import { useTranslation } from "react-i18next";

// DESIGN.md 6.15 — files dragged over the window.
export function DropOverlay() {
  const { t } = useTranslation();
  return (
    <div
      role="presentation"
      className="pointer-events-none fixed inset-3 z-40 grid place-items-center rounded-lg bg-bg/80 p-[2px] backdrop-blur-sm"
    >
      <div className="absolute inset-0 rounded-lg bg-aurora opacity-80" aria-hidden />
      <div className="relative grid size-full place-items-center rounded-[12px] bg-bg/90">
        <div className="flex flex-col items-center gap-3 text-section">
          <FolderDown size={32} strokeWidth={1.5} className="text-primary" />
          {t("import.dropOverlay")}
        </div>
      </div>
    </div>
  );
}
