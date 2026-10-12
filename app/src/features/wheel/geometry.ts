// Harmonic wheel geometry and navigation (DESIGN 5.11): two concentric rings of 12
// segments, outer = major (B), inner = minor (A), laid out like a clock (12 on top).
import {
  compatibility,
  fromWheel,
  type Key,
  type Relation,
  wheelLetter,
  wheelNumber,
} from "../../lib/keys";

export type Ring = "A" | "B";

export interface Point {
  x: number;
  y: number;
}

const TAU = Math.PI * 2;
const STEP = TAU / 12;

/** Angle (radians, clockwise from 12 o'clock) of the centre of wheel position `n`. */
export function segmentAngle(n: number): number {
  return (n % 12) * STEP;
}

export function polar(cx: number, cy: number, r: number, angle: number): Point {
  return { x: cx + r * Math.sin(angle), y: cy - r * Math.cos(angle) };
}

const f = (n: number) => Number(n.toFixed(3));

/** SVG path of an annular sector centred on wheel position `n`. */
export function segmentPath(c: number, inner: number, outer: number, n: number, gap = 0): string {
  const mid = segmentAngle(n);
  const half = STEP / 2;
  // Constant-width gaps: a fixed arc length off each side at both radii.
  const a0o = mid - half + gap / 2 / outer;
  const a1o = mid + half - gap / 2 / outer;
  const a0i = mid - half + gap / 2 / inner;
  const a1i = mid + half - gap / 2 / inner;
  const p1 = polar(c, c, outer, a0o);
  const p2 = polar(c, c, outer, a1o);
  const p3 = polar(c, c, inner, a1i);
  const p4 = polar(c, c, inner, a0i);
  return [
    `M${f(p1.x)} ${f(p1.y)}`,
    `A${outer} ${outer} 0 0 1 ${f(p2.x)} ${f(p2.y)}`,
    `L${f(p3.x)} ${f(p3.y)}`,
    `A${inner} ${inner} 0 0 0 ${f(p4.x)} ${f(p4.y)}`,
    "Z",
  ].join(" ");
}

/** All 24 keys, minor ring first, each in wheel order 1-12. */
export const WHEEL_KEYS: readonly Key[] = (["A", "B"] as const).flatMap((ring) =>
  Array.from({ length: 12 }, (_, i) => fromWheel(i + 1, ring)),
);

/** How `key` relates to `from` (SPEC 2.3), or null with no reference key. */
export function relationTo(from: Key | null, key: Key): Relation | null {
  return from ? compatibility(from, key).relation : null;
}

/** Keys compatible with `from` in the order of the SPEC 2.3 table (best first). */
export function compatibleKeys(from: Key): { key: Key; relation: Relation }[] {
  const order: Relation[] = [
    "same",
    "adjacent",
    "relative",
    "diagonal",
    "energy_boost",
    "semitone_up",
  ];
  return WHEEL_KEYS.map((key) => ({ key, relation: compatibility(from, key).relation }))
    .filter((c) => c.relation !== "none")
    .sort(
      (a, b) =>
        order.indexOf(a.relation) - order.indexOf(b.relation) ||
        wheelNumber(a.key) - wheelNumber(b.key),
    );
}

export type Move = "clockwise" | "counterclockwise" | "outer" | "inner";

/** Keyboard navigation: around the ring, or across to the other ring (same number). */
export function moveOnWheel(key: Key, move: Move): Key {
  const n = wheelNumber(key);
  const ring = wheelLetter(key);
  switch (move) {
    case "clockwise":
      return fromWheel((n % 12) + 1, ring);
    case "counterclockwise":
      return fromWheel(((n + 10) % 12) + 1, ring);
    case "outer":
      return fromWheel(n, "B");
    case "inner":
      return fromWheel(n, "A");
  }
}
