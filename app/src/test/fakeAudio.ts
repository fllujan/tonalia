// Minimal AudioContext stand-in (jsdom has no Web Audio): records when each buffer source
// starts and the gain automation, so tests can check the deck sync.
export interface StartedSource {
  when: number;
  buffer: unknown;
  loop: boolean;
  loopStart: number;
  loopEnd: number;
}

export interface Curve {
  curve: Float32Array;
  at: number;
  length: number;
}

export class FakeAudioContext {
  currentTime = 10;
  destination = {};
  started: StartedSource[] = [];
  curves: Curve[] = [];
  decoded = 0;

  createGain() {
    return {
      gain: {
        value: 1,
        setValueAtTime: () => undefined,
        setValueCurveAtTime: (curve: Float32Array, at: number, length: number) => {
          this.curves.push({ curve, at, length });
        },
      },
      connect: <T>(node: T) => node,
      disconnect: () => undefined,
    };
  }

  createBufferSource() {
    const started = this.started;
    const node = {
      buffer: null as unknown,
      loop: false,
      loopStart: 0,
      loopEnd: 0,
      onended: null as (() => void) | null,
      connect: <T>(n: T) => n,
      disconnect: () => undefined,
      start(when: number) {
        const { buffer, loop, loopStart, loopEnd } = node;
        started.push({ when, buffer, loop, loopStart, loopEnd });
      },
      stop: () => undefined,
    };
    return node;
  }

  decodeAudioData(): Promise<{ duration: number }> {
    this.decoded++;
    return Promise.resolve({ duration: 30 });
  }

  resume(): Promise<void> {
    return Promise.resolve();
  }
}
