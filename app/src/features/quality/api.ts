// The spectrogram of a track (SPEC 13.5), cached by the engine like the waveform.
import { useQuery } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import { request } from "../../lib/rpc";
import type { SpectrogramResult } from "../../lib/rpc.types";

export function useSpectrogram(trackId: number, enabled = true) {
  return useQuery({
    queryKey: ["track", trackId, "spectrogram"],
    queryFn: () => request("quality.spectrogram", { trackId }),
    enabled,
    staleTime: Infinity,
  });
}

const LOSSLESS = new Set(["flac", "wav", "aiff", "aif", "alac"]);

/** What the file says it is: «320 kbps» or «FLAC»; null when it claims nothing high. */
function claimed(s: SpectrogramResult): string | null {
  const format = (s.format ?? "").toLowerCase();
  if (LOSSLESS.has(format)) return format.toUpperCase();
  if ((s.bitrate ?? 0) >= 256) return `${s.bitrate} kbps`;
  return null;
}

export type Verdict = "fake" | "suspect" | "expected" | "clean";

/** The sentence under the picture, and how worried it is. */
export function explain(
  s: SpectrogramResult,
  t: TFunction,
  locale: string,
): { verdict: Verdict; text: string } {
  const khz = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(s.cutoffHz / 1000);
  const claim = claimed(s);
  if (s.fakeHq && claim)
    return {
      verdict: "fake",
      text: s.likelyKbps
        ? t("spectrogram.fake", { khz, claim, kbps: s.likelyKbps })
        : t("spectrogram.fakeUnknown", { khz, claim }),
    };
  if (s.likelyKbps && claim)
    return {
      verdict: "suspect",
      text: t("spectrogram.suspect", { khz, claim, kbps: s.likelyKbps }),
    };
  if (s.likelyKbps)
    return { verdict: "expected", text: t("spectrogram.expected", { khz, kbps: s.likelyKbps }) };
  return { verdict: "clean", text: t("spectrogram.clean", { khz }) };
}
