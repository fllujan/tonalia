import { fileStem, formatBpm, formatCount, formatDate, formatDuration } from "./format";

describe("format", () => {
  it("formats durations", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(65.4)).toBe("1:05");
    expect(formatDuration(372)).toBe("6:12");
    expect(formatDuration(3725)).toBe("1:02:05");
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(Number.NaN)).toBe("—");
  });

  it("formats BPM with the DJ convention", () => {
    expect(formatBpm(124)).toBe("124.00");
    expect(formatBpm(174.456)).toBe("174.46");
    expect(formatBpm(null)).toBe("—");
  });

  it("groups thousands per locale", () => {
    expect(formatCount(12480, "es-ES")).toBe("12.480");
    expect(formatCount(12480, "en")).toBe("12,480");
  });

  it("formats dates per locale", () => {
    expect(formatDate("2026-10-11T09:30:00.000Z", "es-ES")).toBe("11/10/2026");
    expect(formatDate("not a date", "es-ES")).toBe("—");
  });

  it("extracts file stems on any platform", () => {
    expect(fileStem("/Users/dj/Música/Canción 🎵.flac")).toBe("Canción 🎵");
    expect(fileStem("C:\\Music\\Track.01.mp3")).toBe("Track.01");
    expect(fileStem("noext")).toBe("noext");
  });
});
