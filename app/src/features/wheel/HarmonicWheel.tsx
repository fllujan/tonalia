// Harmonic wheel (DESIGN 5.11): outer ring = major keys (B), inner ring = minor (A), in
// their wheel colours. The current key is full with a halo, its compatibles at 70 % with
// the relation (the weak moves at 50 %), the rest at 25 %; an untouched filter wheel
// rests at 55 % so it does not shout over the popover. Every segment is a button with the key written on it,
// so nothing depends on colour alone; arrows move a roving focus, Enter/Space pick.
import { type CSSProperties, type KeyboardEvent, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { KeyChip } from "../../components/KeyChip";
import {
  formatKey,
  fromWheel,
  type Key,
  keysEqual,
  type Notation,
  type Relation,
  wheelLetter,
  wheelNumber,
} from "../../lib/keys";
import { keyColor } from "../../lib/keyStyle";
import {
  compatibleKeys,
  type Move,
  moveOnWheel,
  polar,
  relationTo,
  segmentAngle,
  segmentPath,
  WHEEL_KEYS,
} from "./geometry";

const VIEW = 280;
const C = VIEW / 2;
const RINGS = {
  B: { inner: 98, outer: 138, font: 13 },
  A: { inner: 56, outer: 96, font: 12 },
} as const;
const GAP = 2;

type State = "current" | "compatible" | "dimmed" | "selected" | "idle";

const OPACITY: Record<State, number> = {
  current: 1,
  selected: 1,
  compatible: 0.7,
  idle: 0.55,
  dimmed: 0.25,
};

/** Weak moves (score ≤ 0.6) sit lower than ±1 and relative, so a bright hue such as
 * 3A or 9B never outshines the current key. */
const WEAK: ReadonlySet<string> = new Set(["diagonal", "energy_boost", "semitone_up"]);
const WEAK_OPACITY = 0.5;

const ARROWS: Record<string, Move> = {
  ArrowRight: "clockwise",
  ArrowLeft: "counterclockwise",
  ArrowUp: "outer",
  ArrowDown: "inner",
};

const id = (key: Key) => `${wheelNumber(key)}${wheelLetter(key)}`;

export function HarmonicWheel({
  current,
  selected,
  notation,
  onPick,
  size = VIEW,
  legend = false,
  highlightCompatibles = false,
  label,
}: {
  /** Reference key: highlighted with its compatibles (track detail, decks). */
  current: Key | null;
  /** Several selected keys (filters); turns the segments into toggle buttons. */
  selected?: readonly Key[];
  notation: Notation;
  onPick: (key: Key) => void;
  /** Rendered width in px (the drawing scales): 280 in the detail, 120 mini. */
  size?: number;
  /** List the compatible keys with their relation under the wheel. */
  legend?: boolean;
  /** With `selected`: also light up the keys compatible with any selected one. */
  highlightCompatibles?: boolean;
  label?: string;
}) {
  const { t } = useTranslation();
  const refs = useRef(new Map<string, SVGGElement>());
  const [moved, setMoved] = useState<Key | null>(null);
  const tabbable = moved ?? current ?? selected?.[0] ?? fromWheel(8, "A");
  const showLabels = size >= 160;

  const stateOf = (key: Key, relation: Relation | null): State => {
    if (selected) {
      if (selected.some((s) => keysEqual(s, key))) return "selected";
      if (highlightCompatibles && selected.some((s) => relationTo(s, key) !== "none"))
        return "compatible";
      return selected.length ? "dimmed" : "idle";
    }
    if (!current) return "idle";
    if (keysEqual(current, key)) return "current";
    return relation && relation !== "none" ? "compatible" : "dimmed";
  };

  const focusKey = (key: Key) => {
    setMoved(key);
    refs.current.get(id(key))?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<SVGGElement>, key: Key) => {
    const move = ARROWS[e.key];
    if (move) {
      e.preventDefault();
      focusKey(moveOnWheel(key, move));
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      focusKey(fromWheel(e.key === "Home" ? 1 : 12, wheelLetter(key)));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setMoved(key);
      onPick(key);
    }
  };

  const relationText = (relation: Relation) => t(`wheel.relations.${relation}`);

  return (
    <div className="flex flex-col items-center gap-3">
      <svg
        role="group"
        aria-label={label ?? t("wheel.title")}
        viewBox={`0 0 ${VIEW} ${VIEW}`}
        width={size}
        height={size}
        className="shrink-0 select-none overflow-visible"
      >
        {WHEEL_KEYS.map((key) => {
          const ring = RINGS[wheelLetter(key)];
          const n = wheelNumber(key);
          const relation = relationTo(current, key);
          const state = stateOf(key, relation);
          const text = formatKey(key, notation);
          const name = `${text} (${t(`key.mode.${key.mode}`)})`;
          const related = !selected && relation && relation !== "none";
          const weak = state === "compatible" && !!relation && WEAK.has(relation);
          const opacity = weak ? WEAK_OPACITY : OPACITY[state];
          const strong = opacity >= 0.7;
          const at = polar(C, C, (ring.inner + ring.outer) / 2, segmentAngle(n));
          const d = segmentPath(C, ring.inner, ring.outer, n, GAP);
          const color = keyColor(key);
          return (
            <g
              key={id(key)}
              ref={(el) => {
                if (el) refs.current.set(id(key), el);
                else refs.current.delete(id(key));
              }}
              role="button"
              tabIndex={keysEqual(key, tabbable) ? 0 : -1}
              aria-label={related ? `${name} · ${relationText(relation)}` : name}
              aria-pressed={selected ? state === "selected" : undefined}
              aria-current={state === "current" ? "true" : undefined}
              data-state={state}
              onClick={() => {
                setMoved(key);
                onPick(key);
              }}
              onKeyDown={(e) => onKeyDown(e, key)}
              className="group cursor-pointer outline-none"
              style={{ "--seg": color } as CSSProperties}
            >
              <path
                d={d}
                fill="var(--seg)"
                fillOpacity={opacity}
                className="transition-[fill-opacity] duration-hover group-hover:[fill-opacity:1]"
                style={
                  state === "current"
                    ? {
                        filter: "drop-shadow(0 0 8px var(--seg))",
                        stroke: "var(--color-on-key)",
                        strokeWidth: 1.5,
                      }
                    : state === "selected"
                      ? { stroke: "var(--color-text)", strokeWidth: 2 }
                      : undefined
                }
              />
              <path
                d={d}
                fill="none"
                stroke="var(--color-primary)"
                strokeWidth={2.5}
                className="opacity-0 group-focus-visible:opacity-100"
              />
              {showLabels && (
                <text
                  x={at.x}
                  y={at.y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={ring.font}
                  className="pointer-events-none font-mono font-semibold"
                  fill={
                    strong
                      ? "var(--color-on-key)"
                      : opacity >= WEAK_OPACITY
                        ? "var(--color-text)"
                        : "var(--color-text-2)"
                  }
                >
                  {text}
                </text>
              )}
              <title>{related ? `${name} · ${relationText(relation)}` : name}</title>
            </g>
          );
        })}
        {current && showLabels && (
          <g aria-hidden className="pointer-events-none">
            <text
              x={C}
              y={C - 6}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={22}
              className="font-mono font-semibold"
              fill={keyColor(current)}
            >
              {formatKey(current, notation)}
            </text>
            <text
              x={C}
              y={C + 16}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={11}
              fill="var(--color-text-3)"
            >
              {t(`key.mode.${current.mode}`)}
            </text>
          </g>
        )}
      </svg>
      {legend && current && (
        <ul
          aria-label={t("wheel.compatibleKeys")}
          className="grid w-full max-w-[320px] grid-cols-2 gap-x-4 gap-y-1.5"
        >
          {compatibleKeys(current).map(({ key, relation }) => (
            <li key={id(key)} className="flex min-w-0 items-center gap-2 text-[12px] text-text-2">
              <KeyChip musicalKey={key} notation={notation} />
              <span>{relationText(relation)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
