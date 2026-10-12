// Brand geometry (DESIGN 1.1): the 12-segment ring and the sine wave, in a 100 × 100 box.

export const WAVE = "M6 50 C13 34 21 34 28 50 S43 66 50 50 S65 34 72 50 S87 66 94 50";

export function arcPath(index: number, r: number, gapDeg: number): string {
  const start = ((index * 30 - 90 + gapDeg / 2) * Math.PI) / 180;
  const end = (((index + 1) * 30 - 90 - gapDeg / 2) * Math.PI) / 180;
  const p = (a: number) =>
    `${(50 + r * Math.cos(a)).toFixed(2)} ${(50 + r * Math.sin(a)).toFixed(2)}`;
  return `M ${p(start)} A ${r} ${r} 0 0 1 ${p(end)}`;
}
