// DJ Mix energy direction (SPEC 2.15: keep, raise or lower): whether the ideas follow it.
import type { EnergyDirection, ProMode } from "./decksStore";

/** In DJ Mix, the energy direction no idea follows (null when one does or it cannot tell). */
export function directionUnmet(
  mode: ProMode,
  direction: EnergyDirection,
  energyA: number | null,
  items: readonly { track: { energy?: number | null } }[],
): EnergyDirection | null {
  if (mode !== "mix" || energyA == null) return null;
  const steps = items.flatMap((i) => (i.track.energy != null ? [i.track.energy - energyA] : []));
  if (!steps.length) return null;
  const follows = (step: number) =>
    direction === "up" ? step > 0 : direction === "down" ? step < 0 : step === 0;
  return steps.some(follows) ? null : direction;
}
