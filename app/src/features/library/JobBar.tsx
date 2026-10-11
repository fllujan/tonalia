import { useTranslation } from "react-i18next";

/** Global progress bar for a background job (aurora gradient, DESIGN.md 5.15). */
export function JobBar({
  label,
  percent,
  onCancel,
}: {
  label: string;
  percent: number;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="flex h-10 shrink-0 items-center gap-3 border-b border-border px-5"
      role="status"
    >
      <span className="w-56 shrink-0 truncate text-control text-text-2">{label}</span>
      <div
        className="h-1.5 flex-1 overflow-hidden rounded-pill bg-surface-3"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percent)}
      >
        <div
          className="h-full rounded-pill bg-aurora transition-[width] duration-panel"
          style={{ width: `${percent}%` }}
        />
      </div>
      <button
        type="button"
        onClick={onCancel}
        className="h-7 rounded-sm px-2 text-control text-text-2 transition-colors duration-hover hover:bg-surface-3 hover:text-text"
      >
        {t("import.cancel")}
      </button>
    </div>
  );
}
