/** DESIGN 5.8 switch: a button with role="switch" (keyboard and screen-reader friendly). */
export function Switch({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <label className={`flex items-center justify-between gap-3 ${disabled ? "opacity-40" : ""}`}>
      <span className="text-body">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 shrink-0 rounded-pill transition-colors duration-hover ${checked ? "bg-primary" : "bg-surface-3"}`}
      >
        <span
          aria-hidden
          className={`absolute left-0 top-0.5 size-4 rounded-pill bg-white transition-transform duration-hover ${checked ? "translate-x-[18px]" : "translate-x-0.5"}`}
        />
      </button>
    </label>
  );
}
