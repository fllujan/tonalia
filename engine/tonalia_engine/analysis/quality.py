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
# The cut-off is read on a spectrum smoothed over 250 Hz: an encode cut at exactly 16 kHz
# measures a little above it and still counts.
CUTOFF_TOLERANCE_HZ = 150.0
QUIET_LUFS = -14.0
SILENCE_DBFS = -60.0
SILENCE_SECONDS = 3.0
CUTOFF_DROP_DB = 40.0  # below the 2-8 kHz reference level
N_FFT = 4096
# Where an MP3 encoder usually cuts at each bitrate (LAME's default low-pass, with room
# for the measurement): a cut-off up to the first number points at the second.
LOWPASS_KBPS = ((12000.0, 64), (15500.0, 96), (17200.0, 128), (18000.0, 160), (19300.0, 192))

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


def stft_power(
    mono: npt.NDArray[np.float64], sr: int, n_fft: int = N_FFT
) -> tuple[npt.NDArray[np.float64], npt.NDArray[np.float64]]:
    """Power spectrum of back-to-back Hann frames ``(frames, bins)`` and the bin
    frequencies. Shared by the cut-off check and the spectrogram (SPEC 13.5)."""
    hop = n_fft
    n = (len(mono) - n_fft) // hop
    freqs = np.fft.rfftfreq(n_fft, 1 / sr).astype(np.float64)
    if n < 1:
        return np.zeros((0, len(freqs))), freqs
    x = np.ascontiguousarray(mono, dtype=np.float64)
    frames = np.lib.stride_tricks.as_strided(
        x, shape=(n, n_fft), strides=(x.strides[0] * hop, x.strides[0])
    )
    power = (np.abs(np.fft.rfft(frames * np.hanning(n_fft), axis=1)) ** 2).astype(np.float64)
    return power, freqs


def cutoff_from_power(power: npt.NDArray[np.float64], freqs: npt.NDArray[np.float64]) -> float:
    """Highest frequency whose average level stays within 40 dB of the 2-8 kHz level
    (``power``: the mean power per bin)."""
    if power.size == 0:
        return float(freqs[-1]) if freqs.size else 0.0
    db = 10 * np.log10(power + 1e-20)
    # Smooth over ~250 Hz so single tonal peaks do not decide the cut-off.
    width = max(1, int(250 / (freqs[1] - freqs[0])))
    db = np.convolve(db, np.ones(width) / width, mode="same")
    ref = float(db[(freqs >= 2000) & (freqs <= 8000)].mean())
    above = np.nonzero((db > ref - CUTOFF_DROP_DB) & (freqs >= 2000))[0]
    return float(freqs[above[-1]]) if len(above) else 2000.0


def spectral_cutoff(mono: npt.NDArray[np.float64], sr: int, n_fft: int = N_FFT) -> float:
    """``spectral_cutoff_hz`` (SPEC 13.5): the cut-off of the average spectrum."""
    power, freqs = stft_power(mono, sr, n_fft)
    if len(power) == 0:
        return sr / 2
    return cutoff_from_power(power.mean(axis=0), freqs)


def likely_source_kbps(cutoff_hz: float) -> int | None:
    """The MP3 bitrate whose usual low-pass matches a cut-off (LAME's defaults), or None
    when the cut-off is high enough for any good encode."""
    for limit, kbps in LOWPASS_KBPS:
        if cutoff_hz <= limit:
            return kbps
    return None


def analyze_quality(
    audio: npt.NDArray[np.floating],
    sr: int,
    fmt: str | None,
    bitrate: int | None,
    cutoff_hz: float | None = None,
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
    # The spectrogram measures the same cut-off; the analysis passes it in (SPEC 13.5).
    cutoff = spectral_cutoff(mono, sr) if cutoff_hz is None else cutoff_hz
    head, tail = _silence(mono, sr)

    fmt = (fmt or "").lower()
    claims_hq = fmt in LOSSLESS or (bitrate or 0) >= HQ_BITRATE_KBPS
    flags = []
    if clipping > CLIP_RATIO:
        flags.append("clipping")
    if fmt == "mp3" and bitrate is not None and bitrate < LOW_BITRATE_KBPS:
        flags.append("low_bitrate")
    if claims_hq and sr >= 2 * MIN_CUTOFF_HZ and cutoff < MIN_CUTOFF_HZ + CUTOFF_TOLERANCE_HZ:
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
