import { useEffect, useState } from "react";
import type { Side } from "./Deck";
import { clockPosition, player, usePlaybackStore } from "./syncPlayer";

/** Playhead of a deck in its original track while it plays; null when it is silent. */
export function useDeckTime(side: Side): number | null {
  const clock = usePlaybackStore((s) => (s.status === "playing" ? s.clocks[side] : undefined));
  const [time, setTime] = useState<number | null>(null);
  useEffect(() => {
    if (!clock) return;
    let frame = 0;
    const tick = () => {
      setTime(clockPosition(clock, player.now()));
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [clock]);
  return clock ? time : null;
}
