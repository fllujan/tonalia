// Browser preview of render.preview: instead of the engine's Rubber Band renders, a click
// track at the rendered tempo (downbeats louder, pitch following the semitones) so the
// Pro decks' Web Audio sync can be heard and checked without Tauri.
import type { RenderResult, RenderSpec, TrackSummary } from "../lib/rpc.types";

const SR = 44_100;
const FIRST_DOWNBEAT = 0.3; // the preview's beatgrids (see layout() in browserPreview)

interface Render {
  spec: RenderSpec;
  bpm: number;
  ratio: number;
  firstDownbeat: number; // seconds in the render
  duration: number;
}

const renders = new Map<string, Render>();

export function previewRender(track: TrackSummary, spec: RenderSpec): { result: RenderResult } {
  const bpm = track.bpm ?? 120;
  const ratio = spec.targetBpm ? bpm / spec.targetBpm : 1;
  const start = spec.start ?? 0;
  const length = spec.duration ?? Math.max(1, (track.duration ?? 300) - start);
  const bar = 240 / bpm;
  const nextBar =
    FIRST_DOWNBEAT + Math.max(0, Math.ceil((start - FIRST_DOWNBEAT - 5e-4) / bar)) * bar;
  const path = `/preview/render/${renders.size + 1}.wav`;
  const render: Render = {
    spec,
    bpm: bpm / ratio,
    ratio,
    firstDownbeat: (nextBar - start) * ratio,
    duration: length * ratio,
  };
  renders.set(path, render);
  return {
    result: {
      path,
      sampleRate: SR,
      frames: Math.round(render.duration * SR),
      duration: render.duration,
      bpm: render.bpm,
      timeRatio: ratio,
      firstDownbeat: Math.round(render.firstDownbeat * SR),
      cached: false,
    },
  };
}

/** WAV bytes of a preview render, or null if `url` is not one. */
export function previewRenderWav(url: string): ArrayBuffer | null {
  const match = /preview(?:%2F|\/)render(?:%2F|\/)(\d+)\.wav/.exec(url);
  const render = match ? renders.get(`/preview/render/${match[1]}.wav`) : undefined;
  if (!render) return null;
  const frames = Math.round(render.duration * SR);
  const samples = new Int16Array(frames);
  const period = 60 / render.bpm;
  const freq = (render.spec.trackId % 2 ? 1000 : 1500) * 2 ** ((render.spec.semitones ?? 0) / 12);
  let beat = Math.floor(render.firstDownbeat / period);
  for (let t = render.firstDownbeat - beat * period; t < render.duration; t += period, beat--) {
    const at = Math.round(t * SR);
    const level = beat === 0 || beat % 4 === 0 ? 0.6 : 0.25;
    for (let k = 0; k < 2200 && at + k < frames; k++) {
      const v = level * Math.sin((2 * Math.PI * freq * k) / SR) * Math.exp(-k / 400);
      samples[at + k] = Math.round(v * 32767);
    }
  }
  const out = new ArrayBuffer(44 + samples.byteLength);
  const view = new DataView(out);
  const text = (offset: number, s: string) =>
    [...s].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + samples.byteLength, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, SR, true);
  view.setUint32(28, SR * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples.byteLength, true);
  new Int16Array(out, 44).set(samples);
  return out;
}
