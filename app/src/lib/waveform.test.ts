import { parseWaveform } from "./waveform";

function file(points: number[][], pps = 150): ArrayBuffer {
  const buf = new ArrayBuffer(16 + points.length * 3);
  const view = new DataView(buf);
  [..."TWF1"].forEach((c, i) => view.setUint8(i, c.charCodeAt(0)));
  view.setUint16(4, 1, true);
  view.setUint16(6, pps, true);
  view.setUint32(8, points.length, true);
  view.setUint8(12, 3);
  new Uint8Array(buf, 16).set(points.flat());
  return buf;
}

describe("parseWaveform", () => {
  it("reads the header and band-interleaved points", () => {
    const wf = parseWaveform(
      file([
        [10, 20, 30],
        [255, 0, 7],
      ]),
    );
    expect(wf).toMatchObject({ pointsPerSecond: 150, points: 2, bands: 3 });
    expect(Array.from(wf.data)).toEqual([10, 20, 30, 255, 0, 7]);
  });

  it("rejects other files and truncated data", () => {
    expect(() => parseWaveform(new TextEncoder().encode("RIFF1234abcdefgh").buffer)).toThrow();
    expect(() => parseWaveform(file([[1, 2, 3]]).slice(0, 18))).toThrow();
  });
});
