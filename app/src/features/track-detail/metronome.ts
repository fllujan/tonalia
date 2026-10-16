// Metronome for the beatgrid editor (SPEC 12.4): a short click on every beat of the grid
// being edited, over the playing track, so a wrong grid is heard at once. Clicks are
// scheduled ahead on a Web Audio clock from the player's position; a seek or a new grid
// starts the schedule again. Downbeats click higher.
import { useEffect, useRef } from "react";
import type { BeatGrid } from "../../lib/beats";
import { beatTimes, downbeatTimes } from "../../lib/beats";
import { playbackTime } from "../player/playerStore";

const LOOKAHEAD = 0.12; // seconds of clicks scheduled ahead
const TICK_MS = 25;
const CLICK = 0.03;

let shared: AudioContext | null = null;

function context(): AudioContext {
  shared ??= new AudioContext();
  if (shared.state === "suspended") void shared.resume();
  return shared;
}

function click(ctx: AudioContext, at: number, accent: boolean): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = accent ? 1760 : 1175;
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(accent ? 0.35 : 0.22, at + 0.002);
  gain.gain.exponentialRampToValueAtTime(0.001, at + CLICK);
  osc.connect(gain).connect(ctx.destination);
  osc.start(at);
  osc.stop(at + CLICK + 0.01);
}

/** While `on` and `playing`, click on the beats of `grid`. */
export function useMetronome(
  on: boolean,
  playing: boolean,
  grid: BeatGrid | null,
  duration: number,
): void {
  const timer = useRef<number | null>(null);
  useEffect(() => {
    if (!on || !playing || !grid || duration <= 0 || typeof AudioContext === "undefined") return;
    const beats = beatTimes(grid, duration);
    const bars = new Set(downbeatTimes(grid, duration));
    const ctx = context();
    let next = 0; // index of the next beat to schedule
    let last = -1;
    const tick = () => {
      const now = playbackTime();
      // A seek (or the first tick): find the first beat ahead again.
      if (now < last - 0.05 || now > last + 0.5) {
        next = beats.findIndex((b) => b >= now);
        if (next < 0) next = beats.length;
      }
      last = now;
      while (next < beats.length && (beats[next] ?? 0) < now + LOOKAHEAD) {
        const beat = beats[next] ?? 0;
        if (beat >= now) click(ctx, ctx.currentTime + (beat - now), bars.has(beat));
        next++;
      }
    };
    tick();
    timer.current = window.setInterval(tick, TICK_MS);
    return () => {
      if (timer.current != null) window.clearInterval(timer.current);
    };
  }, [on, playing, grid, duration]);
}
