// Web Audio player of the Pro decks (SPEC 2.15). Every deck goes through
//   source → fade (automatic crossfade of "Try mix") → deck gain → crossfader → output
// and all sources are started on the same AudioContext clock (`alignStarts`) so the
// downbeats of A and B coincide to the sample.
import { convertFileSrc } from "@tauri-apps/api/core";
import { create } from "zustand";
import { allowPlayback } from "../track-detail/api";
import type { Side } from "./Deck";
import { renderPreview } from "./renderJobs";
import type { PlayKind, PlayPlan } from "./segments";
import { alignStarts, crossfadeGains, fadeCurve } from "./sync";
import { errorMessage } from "../../lib/errors";

/** Where a deck is in its original track while it plays. */
export interface DeckClock {
  /** Original seconds where the render starts. */
  segStart: number;
  /** Rendered / original duration. */
  ratio: number;
  /** AudioContext time at which the render starts. */
  startAt: number;
  /** Output seconds of the render. */
  length: number;
  /** Output seconds repeated from the start of the render (a looped deck). */
  loop?: number;
}

interface PlaybackState {
  status: "idle" | "loading" | "playing";
  kind: PlayKind | null;
  clocks: Partial<Record<Side, DeckClock>>;
  gains: Record<Side, number>;
  /** 0 = only A, 1 = only B (equal power). */
  crossfader: number;
  error: string | null;
}

export const usePlaybackStore = create<PlaybackState>(() => ({
  status: "idle",
  kind: null,
  clocks: {},
  gains: { a: 1, b: 1 },
  crossfader: 0.5,
  error: null,
}));

type ContextFactory = () => AudioContext;
let makeContext: ContextFactory = () => new AudioContext({ latencyHint: "interactive" });

/** Tests replace the AudioContext (jsdom has none). */
export function setAudioContextFactory(factory: ContextFactory): void {
  makeContext = factory;
  player.reset();
}

const BUFFER_CACHE = 8;

class SyncPlayer {
  private ctx: AudioContext | null = null;
  private chains: Partial<Record<Side, { deck: GainNode; fader: GainNode }>> = {};
  private sources: AudioBufferSourceNode[] = [];
  private buffers = new Map<string, Promise<AudioBuffer>>();
  private generation = 0;

  reset(): void {
    this.stop();
    this.ctx = null;
    this.chains = {};
    this.buffers.clear();
  }

  /** Current AudioContext time (0 before the first playback). */
  now(): number {
    return this.ctx?.currentTime ?? 0;
  }

  private context(): AudioContext {
    this.ctx ??= makeContext();
    return this.ctx;
  }

  private chain(side: Side) {
    const ctx = this.context();
    let chain = this.chains[side];
    if (!chain) {
      const deck = ctx.createGain();
      const fader = ctx.createGain();
      deck.connect(fader).connect(ctx.destination);
      chain = { deck, fader };
      this.chains[side] = chain;
      this.applyGains();
    }
    return chain;
  }

  private applyGains(): void {
    const { gains, crossfader } = usePlaybackStore.getState();
    const xf = crossfadeGains(crossfader);
    for (const side of ["a", "b"] as const) {
      const chain = this.chains[side];
      if (!chain) continue;
      chain.deck.gain.value = gains[side];
      chain.fader.gain.value = side === "a" ? xf.a : xf.b;
    }
  }

  setGain(side: Side, value: number): void {
    usePlaybackStore.setState((s) => ({ gains: { ...s.gains, [side]: value } }));
    this.applyGains();
  }

  setCrossfader(value: number): void {
    usePlaybackStore.setState({ crossfader: Math.min(1, Math.max(0, value)) });
    this.applyGains();
  }

  private load(path: string): Promise<AudioBuffer> {
    let buffer = this.buffers.get(path);
    if (!buffer) {
      buffer = (async () => {
        await allowPlayback(path);
        const response = await fetch(convertFileSrc(path));
        if (!response.ok) throw new Error(`audio ${response.status}`);
        return this.context().decodeAudioData(await response.arrayBuffer());
      })();
      this.buffers.set(path, buffer);
      buffer.catch(() => this.buffers.delete(path));
      while (this.buffers.size > BUFFER_CACHE)
        this.buffers.delete(this.buffers.keys().next().value as string);
    }
    return buffer;
  }

  private stopSources(): void {
    for (const source of this.sources) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // never started
      }
      source.disconnect();
    }
    this.sources = [];
  }

  stop(): void {
    this.generation++;
    this.stopSources();
    usePlaybackStore.setState({ status: "idle", kind: null, clocks: {} });
  }

  async play(plan: PlayPlan): Promise<void> {
    const generation = ++this.generation;
    this.stopSources();
    usePlaybackStore.setState({ status: "loading", kind: plan.kind, clocks: {}, error: null });
    const ctx = this.context();
    // Resume inside the click that asked for playback (autoplay policies).
    void ctx.resume?.().catch(() => undefined);
    try {
      const renders = await Promise.all(plan.decks.map((d) => renderPreview(d.spec)));
      if (generation !== this.generation) return;
      const buffers = await Promise.all(renders.map((r) => this.load(r.path)));
      if (generation !== this.generation) return;

      const downbeats = renders.map((r) => (r.firstDownbeat ?? 0) / r.sampleRate);
      const starts = alignStarts(
        downbeats,
        plan.decks.map((d) => d.delay),
        ctx.currentTime,
      );
      // The common downbeat: deck i's first downbeat plays at common + delay[i].
      const common = (starts[0] ?? 0) + (downbeats[0] ?? 0) - (plan.decks[0]?.delay ?? 0);
      const clocks: Partial<Record<Side, DeckClock>> = {};
      let playing = plan.decks.length;

      plan.decks.forEach((deck, i) => {
        const buffer = buffers[i] as AudioBuffer;
        const render = renders[i];
        const at = starts[i] ?? ctx.currentTime;
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        const fade = ctx.createGain();
        if (deck.fade) {
          fade.gain.setValueAtTime(deck.fade.direction === "in" ? 0 : 1, ctx.currentTime);
          fade.gain.setValueCurveAtTime(
            fadeCurve(deck.fade.direction),
            common + deck.fade.at,
            deck.fade.length,
          );
        }
        const ratio = render?.timeRatio ?? 1;
        const loop = deck.loop ? Math.min(buffer.duration, deck.loop * ratio) : 0;
        if (loop > 0) {
          // The render starts exactly at the loop start (sample 0 = spec.start).
          source.loop = true;
          source.loopStart = 0;
          source.loopEnd = loop;
        }
        source.connect(fade).connect(this.chain(deck.side).deck);
        source.onended = () => {
          playing--;
          if (playing === 0 && generation === this.generation) this.stop();
        };
        source.start(at);
        this.sources.push(source);
        clocks[deck.side] = {
          segStart: deck.spec.start ?? 0,
          ratio,
          startAt: at,
          length: buffer.duration,
          ...(loop > 0 ? { loop } : {}),
        };
      });
      usePlaybackStore.setState({ status: "playing", clocks });
    } catch (err) {
      if (generation !== this.generation) return;
      usePlaybackStore.setState({
        status: "idle",
        kind: null,
        clocks: {},
        error: errorMessage(err),
      });
    }
  }
}

export const player = new SyncPlayer();

/** Position of a deck in its original track at AudioContext time `now`. */
export function clockPosition(clock: DeckClock, now: number): number {
  const played = Math.max(0, now - clock.startAt);
  const elapsed = clock.loop ? played % clock.loop : Math.min(clock.length, played);
  return clock.segStart + elapsed / clock.ratio;
}
