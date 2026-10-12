// Small piano-like synthesiser on the Web Audio API (SPEC 2.13 allows synthesis instead of
// samples): a few decaying partials per note, no audio files to ship or attribute. It uses
// its own AudioContext, so it plays over the track without touching its playback.

export interface Synth {
  /** Start a note now; the returned function releases it. */
  start: (midi: number) => () => void;
  /** Play a note `delay` seconds from now for `duration` seconds. */
  play: (midi: number, delay: number, duration: number) => void;
}

const PARTIALS = [
  { ratio: 1, gain: 1, type: "triangle" },
  { ratio: 2, gain: 0.35, type: "sine" },
  { ratio: 3, gain: 0.12, type: "sine" },
] as const;
const PEAK = 0.22;
const DECAY = 2.2; // seconds to fade while held
const RELEASE = 0.25;

const frequency = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

let shared: AudioContext | null = null;

function context(): AudioContext {
  shared ??= new AudioContext();
  if (shared.state === "suspended") void shared.resume();
  return shared;
}

function voice(ctx: AudioContext, midi: number, at: number): (when: number) => void {
  const out = ctx.createGain();
  out.gain.setValueAtTime(0, at);
  out.gain.linearRampToValueAtTime(PEAK, at + 0.005);
  out.gain.exponentialRampToValueAtTime(0.001, at + DECAY);
  out.connect(ctx.destination);
  const oscillators = PARTIALS.map((p) => {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = p.type;
    osc.frequency.value = frequency(midi) * p.ratio;
    g.gain.value = p.gain;
    osc.connect(g).connect(out);
    osc.start(at);
    osc.stop(at + DECAY + 0.05);
    return osc;
  });
  let released = false;
  return (when) => {
    if (released) return;
    released = true;
    const end = Math.max(when, at + 0.01);
    out.gain.cancelScheduledValues(end);
    out.gain.setTargetAtTime(0.0001, end, RELEASE / 4);
    for (const osc of oscillators) {
      try {
        osc.stop(end + RELEASE);
      } catch {
        // Already stopped by its natural decay.
      }
    }
  };
}

export const webAudioSynth: Synth = {
  start(midi) {
    const ctx = context();
    const release = voice(ctx, midi, ctx.currentTime);
    return () => release(ctx.currentTime);
  },
  play(midi, delay, duration) {
    const ctx = context();
    const at = ctx.currentTime + delay;
    voice(ctx, midi, at)(at + duration);
  },
};
