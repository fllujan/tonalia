// Reader for the engine's three-band waveform files (engine/tonalia_engine/analysis/waveform.py).

export interface WaveformData {
  pointsPerSecond: number;
  points: number;
  bands: number;
  /** Band-interleaved bytes: point i, band b at data[i * bands + b]; 255 = full scale. */
  data: Uint8Array;
}

const MAGIC = "TWF1";
const HEADER_BYTES = 16;

export function parseWaveform(buffer: ArrayBuffer): WaveformData {
  if (buffer.byteLength < HEADER_BYTES) throw new Error("not a Tonalia waveform");
  const view = new DataView(buffer);
  const magic = String.fromCharCode(...new Uint8Array(buffer, 0, 4));
  const version = view.getUint16(4, true);
  const pointsPerSecond = view.getUint16(6, true);
  const points = view.getUint32(8, true);
  const bands = view.getUint8(12);
  if (magic !== MAGIC || version !== 1 || buffer.byteLength !== HEADER_BYTES + points * bands) {
    throw new Error("not a Tonalia waveform");
  }
  return { pointsPerSecond, points, bands, data: new Uint8Array(buffer, HEADER_BYTES) };
}
