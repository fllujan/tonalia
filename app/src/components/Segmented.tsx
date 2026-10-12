import { SegmentThumb } from "./SegmentThumb";
import type { ReactNode } from "react";

/** DESIGN 5.8 segmented selector (Mashup | DJ Mix, Keep | Up | Down…): a radio group. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  size = "md",
}: {
  value: T;
  options: readonly { value: T; label: ReactNode; title?: string }[];
  onChange: (value: T) => void;
  label: string;
  size?: "sm" | "md";
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="relative flex gap-0.5 rounded-[7px] border border-border bg-bg p-0.5"
    >
      <SegmentThumb />
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          title={o.title}
          onClick={() => value !== o.value && onChange(o.value)}
          className={`flex items-center gap-1.5 rounded-[5px] transition-colors duration-hover ${size === "sm" ? "h-[24px] px-2 text-[12px]" : "h-[28px] px-3 text-control font-medium"} ${value === o.value ? "bg-surface-3 text-text" : "text-text-3 hover:text-text"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
