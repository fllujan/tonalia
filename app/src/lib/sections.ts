// Section and cue colours (DESIGN 2.5): one token per section type.

const SECTION_TOKEN: Record<string, number> = {
  intro: 1,
  build: 2,
  drop: 3,
  breakdown: 4,
  build2: 5,
  drop2: 6,
  verse: 7,
  chorus: 7,
  outro: 8,
};

export function sectionColor(label: string): string {
  return `var(--color-cue-${SECTION_TOKEN[label] ?? 7})`;
}

/** The eight cue colours offered when editing a cue. */
export const CUE_PALETTE = [
  "#4CC3FF",
  "#3DDC97",
  "#FF5F8A",
  "#FFB547",
  "#9D8CFF",
  "#FF7A3D",
  "#E0A4EE",
  "#8A879E",
];

/** Auto cue labels are section keys the UI translates; user labels are free text. */
export const AUTO_CUE_LABELS = new Set(Object.keys(SECTION_TOKEN));
