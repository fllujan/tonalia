// Tailwind theme mapped to the design tokens in src/styles/tokens.css (DESIGN.md).
// Components must use these names, never raw color values.
import type { Config } from "tailwindcss";

const v = (name: string) => `var(--color-${name})`;
const range = (prefix: string, n: number) =>
  Object.fromEntries(Array.from({ length: n }, (_, i) => [String(i + 1), v(`${prefix}-${i + 1}`)]));

const keyColors = Object.fromEntries(
  Array.from({ length: 12 }, (_, i) => i + 1).flatMap((n) => [
    [`${n}a`, v(`key-${n}a`)],
    [`${n}b`, v(`key-${n}b`)],
  ]),
);

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: v("bg"),
        "surface-1": v("surface-1"),
        "surface-2": v("surface-2"),
        "surface-3": v("surface-3"),
        border: v("border"),
        "border-strong": v("border-strong"),
        text: v("text"),
        "text-2": v("text-2"),
        "text-3": v("text-3"),
        primary: { DEFAULT: v("primary"), hover: v("primary-hover"), soft: v("primary-soft") },
        accent: v("accent"),
        success: v("success"),
        warning: v("warning"),
        danger: v("danger"),
        info: v("info"),
        deck: { a: v("deck-a"), b: v("deck-b") },
        key: keyColors,
        energy: range("energy", 10),
        cue: range("cue", 8),
        stem: {
          vocals: v("stem-vocals"),
          drums: v("stem-drums"),
          bass: v("stem-bass"),
          other: v("stem-other"),
          instrumental: v("stem-instrumental"),
        },
        wave: { low: v("wave-low"), mid: v("wave-mid"), high: v("wave-high") },
      },
      backgroundImage: { aurora: "var(--gradient-aurora)" },
      fontFamily: {
        display: "var(--font-display)",
        sans: "var(--font-sans)",
        mono: "var(--font-mono)",
      },
      fontSize: {
        display: ["32px", { lineHeight: "40px", fontWeight: "600" }],
        title: ["22px", { lineHeight: "28px", fontWeight: "600" }],
        section: ["15px", { lineHeight: "22px", fontWeight: "600" }],
        body: ["13px", { lineHeight: "20px" }],
        control: ["13px", { lineHeight: "18px" }],
        label: ["11px", { lineHeight: "16px", fontWeight: "600", letterSpacing: "0.04em" }],
        data: ["13px", { lineHeight: "18px", fontWeight: "500" }],
        "data-lg": ["28px", { lineHeight: "32px", fontWeight: "600" }],
      },
      borderRadius: {
        sm: "var(--radius-sm)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
        pill: "var(--radius-pill)",
      },
      boxShadow: { overlay: "var(--shadow-overlay)", card: "var(--shadow-card)" },
      transitionDuration: { hover: "var(--duration-hover)", panel: "var(--duration-panel)" },
      transitionTimingFunction: { out: "var(--ease-out)" },
    },
  },
} satisfies Config;
