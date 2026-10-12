// Colour contrast of the design tokens (SPEC 3: AA; DESIGN 7: "check the key chips in light
// mode"). jsdom cannot paint, so the ratios are computed from tokens.css itself, for the
// dark theme (:root) and the light one ([data-theme="light"]).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const css = readFileSync(resolve(__dirname, "tokens.css"), "utf8");

type Rgb = [number, number, number];

function block(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`no ${selector} block`);
  return css.slice(start, css.indexOf("\n}", start));
}

function vars(text: string): Map<string, string> {
  return new Map(
    [...text.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1] ?? "", (m[2] ?? "").trim()]),
  );
}

const DARK = vars(block(":root"));
const LIGHT = new Map([...DARK, ...vars(block(':root[data-theme="light"]'))]);

const hex = (value: string | undefined): Rgb => {
  const m = /^#([0-9a-f]{6})$/i.exec(value ?? "");
  if (!m) throw new Error(`not a hex colour: ${value}`);
  const n = parseInt(m[1] ?? "", 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};
const mix = (a: Rgb, b: Rgb, t: number): Rgb =>
  [0, 1, 2].map((i) => (a[i] ?? 0) * t + (b[i] ?? 0) * (1 - t)) as Rgb;
const luminance = ([r, g, b]: Rgb) => {
  const f = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a: Rgb, b: Rgb) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

const AA = 4.5;
const WHITE: Rgb = [1, 1, 1];
const THEMES = [
  ["dark", DARK],
  ["light", LIGHT],
] as const;
const SURFACES = ["bg", "surface-1", "surface-2"];

describe.each(THEMES)("%s theme contrast (WCAG AA)", (_, theme) => {
  const color = (name: string) => hex(theme.get(`color-${name}`));

  it.each(["text", "text-2", "text-3", "primary-ink"])("%s on every surface", (fg) => {
    for (const bg of [...SURFACES, "surface-3"])
      expect(ratio(color(fg), color(bg)), `${fg} on ${bg}`).toBeGreaterThanOrEqual(AA);
  });

  it.each(["success", "warning", "danger", "info", "accent"])("%s text on the surfaces", (fg) => {
    for (const bg of SURFACES)
      expect(ratio(color(fg), color(bg)), `${fg} on ${bg}`).toBeGreaterThanOrEqual(AA);
  });

  it("white text on the solid buttons", () => {
    for (const fill of ["primary", "primary-hover", "accent-fill", "danger-fill"])
      expect(ratio(WHITE, color(fill)), fill).toBeGreaterThanOrEqual(AA);
    for (const stop of (theme.get("gradient-aurora") ?? "").match(/#[0-9a-f]{6}/gi) ?? [])
      expect(ratio(WHITE, hex(stop)), `aurora ${stop}`).toBeGreaterThanOrEqual(AA);
  });

  it("the 24 key chips (text on its 20 % tint)", () => {
    const share = parseFloat(theme.get("key-text-mix") ?? "") / 100;
    const base = hex(theme.get("key-text-base"));
    for (const [name, value] of theme) {
      if (!/^color-key-\d+[ab]$/.test(name)) continue;
      const key = hex(value);
      for (const bg of [...SURFACES, "surface-3"]) {
        const chip = mix(key, color(bg), 0.2);
        expect(ratio(mix(key, base, share), chip), `${name} on ${bg}`).toBeGreaterThanOrEqual(AA);
      }
    }
  });
});

it("the light theme is the same with the system setting and the explicit choice", () => {
  const system = vars(block(':root:not([data-theme="dark"])'));
  const explicit = vars(block(':root[data-theme="light"]'));
  expect(Object.fromEntries(system)).toEqual(Object.fromEntries(explicit));
});
