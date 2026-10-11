"""Audio quality checks (SPEC 2.7) feeding the "Review quality" smart list.

Measured on the original channels (a mono downmix lowers the peaks):

- clipping: share of samples at or above -0.1 dBFS;
- low bitrate: MP3 below 192 kbps;
- fake high quality: a spectral cut-off below 16 kHz in a file that claims high
  quality (>= 256 kbps or lossless), i.e. transcoded from a low-bitrate encode;
- quiet: integrated loudness below -14 LUFS (ITU-R BS.1770 via pyloudnorm);
- silence: more than 3 s below -60 dBFS at the start or the end.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import numpy.typing as npt
import pyloudnorm

CLIP_DBFS = -0.1
CLIP_RATIO = 0.001  # share of clipped samples that raises the flag
LOW_BITRATE_KBPS = 192
HQ_BITRATE_KBPS = 256
LOSSLESS = frozenset({"flac", "wav", "aiff", "aif", "alac"})
MIN_CUTOFF_HZ = 16000.0
QUIET_LUFS = -14.0
SILENCE_DBFS = -60.0
SILENCE_SECONDS = 3.0
CUTOFF_DROP_DB = 40.0  # below the 2-8 kHz reference level

FLAGS = ("clipping", "low_bitrate", "fake_hq", "quiet", "silence_start", "silence_end")


@dataclass(frozen=True)
class QualityResult:
    loudness_lufs: float
    peak_db: float
    clipping_ratio: float
    cutoff_hz: float
    silence_start: float
    silence_end: float
    flags: list[str] = field(default_factory=list)


def _silence(mono: npt.NDArray[np.float64], sr: int) -> tuple[float, float]:
    """Seconds of silence (below SILENCE_DBFS in 50 ms windows) at each end."""
    win = max(1, int(0.05 * sr))
    n = len(mono) // win
    if n == 0:
        return 0.0, 0.0
    rms = np.sqrt((mono[: n * win].reshape(n, win) ** 2).mean(axis=1))
    loud = np.nonzero(rms > 10 ** (SILENCE_DBFS / 20))[0]
    if len(loud) == 0:
        return n * win / sr, n * win / sr
    return loud[0] * win / sr, (n - 1 - loud[-1]) * win / sr


def spectral_cutoff(mono: npt.NDArray[np.float64], sr: int, n_fft: int = 4096) -> float:
    """Highest frequency whose average level stays within 40 dB of the 2-8 kHz level."""
    hop = n_fft
    n = (len(mono) - n_fft) // hop
    if n < 1:
        return sr / 2
    frames = np.lib.stride_tricks.as_strided(
        mono, shape=(n, n_fft), strides=(mono.strides[0] * hop, mono.strides[0])
    )
    power = (np.abs(np.fft.rfft(frames * np.hanning(n_fft), axis=1)) ** 2).mean(axis=0)
    freqs = np.fft.rfftfreq(n_fft, 1 / sr)
    db = 10 * np.log10(power + 1e-20)
    # Smooth over ~250 Hz so single tonal peaks do not decide the cut-off.
    width = max(1, int(250 / (freqs[1] - freqs[0])))
    db = np.convolve(db, np.ones(width) / width, mode="same")
    ref = float(db[(freqs >= 2000) & (freqs <= 8000)].mean())
    above = np.nonzero((db > ref - CUTOFF_DROP_DB) & (freqs >= 2000))[0]
    return float(freqs[above[-1]]) if len(above) else 2000.0


def analyze_quality(
    audio: npt.NDArray[np.floating], sr: int, fmt: str | None, bitrate: int | None
) -> QualityResult | None:
    """Quality report for ``audio`` (mono ``(n,)`` or ``(n, channels)``); None if silent."""
    x = np.asarray(audio, dtype=np.float64)
    channels = x if x.ndim == 2 else x[:, None]
    if channels.size == 0 or float(np.abs(channels).max()) < 10 ** (SILENCE_DBFS / 20):
        return None
    mono = channels.mean(axis=1)
    peak = float(np.abs(channels).max())
    clipping = float((np.abs(channels) >= 10 ** (CLIP_DBFS / 20)).mean())
    meter = pyloudnorm.Meter(sr)
    loudness = float(meter.integrated_loudness(channels if channels.shape[1] > 1 else mono))
    if not np.isfinite(loudness):
        loudness = -70.0
    cutoff = spectral_cutoff(mono, sr)
    head, tail = _silence(mono, sr)

    fmt = (fmt or "").lower()
    claims_hq = fmt in LOSSLESS or (bitrate or 0) >= HQ_BITRATE_KBPS
    flags = []
    if clipping > CLIP_RATIO:
        flags.append("clipping")
    if fmt == "mp3" and bitrate is not None and bitrate < LOW_BITRATE_KBPS:
        flags.append("low_bitrate")
    if claims_hq and sr >= 2 * MIN_CUTOFF_HZ and cutoff < MIN_CUTOFF_HZ:
        flags.append("fake_hq")
    if loudness < QUIET_LUFS:
        flags.append("quiet")
    if head > SILENCE_SECONDS:
        flags.append("silence_start")
    if tail > SILENCE_SECONDS:
        flags.append("silence_end")
    return QualityResult(
        loudness_lufs=round(loudness, 2),
        peak_db=round(20 * np.log10(max(peak, 1e-10)), 2),
        clipping_ratio=round(clipping, 6),
        cutoff_hz=round(cutoff, 0),
        silence_start=round(head, 2),
        silence_end=round(tail, 2),
        flags=flags,
    )
