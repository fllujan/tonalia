"""Vocal presence 0-1 (SPEC 2.16): how much of a track's main sections is voice.

With stems it is measured: RMS(vocals) / RMS(mix) over the main sections. Before the
track is separated it is estimated from the mix: the share of harmonic (non-percussive)
energy in the voice band, 300-3400 Hz, mapped to the stems scale by a linear fit
calibrated against stem measurements (``ESTIMATE_FIT``).

Main sections are every segment but the intro and the outro, which are often
instrumental by design; without segments, the track minus its first and last 10 %.
"""

from __future__ import annotations

from collections.abc import Sequence
from math import gcd

import numpy as np
import numpy.typing as npt
from scipy.ndimage import median_filter
from scipy.signal import resample_poly

from .structure import Segment

FloatArray = npt.NDArray[np.float64]

VOCAL_SR = 11025
N_FFT = 1024
HOP = 512
HPSS_KERNEL = 17
VOICE_BAND = (300.0, 3400.0)
EDGE_SHARE = 0.1  # trimmed from each end when there are no segments
# presence ≈ slope * feature + intercept, least squares against htdemucs measurements of
# 22 commercial tracks (2026-10-12; leave-one-out MAE 0.090).
ESTIMATE_FIT = (0.670, 0.070)

Section = tuple[float, float]


def main_sections(segments: Sequence[Segment], duration: float) -> list[Section]:
    main = [(s.start, s.end) for s in segments if s.label not in ("intro", "outro")]
    if main:
        return main
    if segments:  # only an intro and an outro: use everything
        return [(segments[0].start, segments[-1].end)]
    return [(duration * EDGE_SHARE, duration * (1 - EDGE_SHARE))]


def _mask(n: int, rate: float, sections: Sequence[Section]) -> npt.NDArray[np.bool_]:
    mask = np.zeros(n, dtype=bool)
    for start, end in sections:
        mask[max(0, int(start * rate)) : max(0, int(end * rate))] = True
    return mask if mask.any() else np.ones(n, dtype=bool)


def _mono(audio: npt.NDArray[np.floating]) -> FloatArray:
    x = np.asarray(audio, dtype=np.float64)
    return x.mean(axis=1) if x.ndim == 2 else x


def measured_presence(
    vocals: npt.NDArray[np.floating],
    mix: npt.NDArray[np.floating],
    sr: int,
    sections: Sequence[Section],
) -> float:
    """RMS(vocals) / RMS(mix) over ``sections`` (mono or (n, channels) arrays)."""
    v, m = _mono(vocals), _mono(mix)
    n = min(v.size, m.size)
    keep = _mask(n, sr, sections)
    mix_power = float(np.mean(m[:n][keep] ** 2))
    if mix_power < 1e-12:
        return 0.0
    ratio = np.sqrt(float(np.mean(v[:n][keep] ** 2)) / mix_power)
    return round(float(np.clip(ratio, 0.0, 1.0)), 3)


def voice_band_feature(
    audio: npt.NDArray[np.floating], sr: int, sections: Sequence[Section]
) -> float:
    """sqrt(harmonic power in the voice band / total power) over ``sections`` (mono)."""
    x = _mono(audio)
    g = gcd(sr, VOCAL_SR)
    if sr != VOCAL_SR:
        x = resample_poly(x, VOCAL_SR // g, sr // g)
    if x.size < N_FFT:
        x = np.pad(x, (0, N_FFT - x.size))
    n = 1 + (x.size - N_FFT) // HOP
    frames = np.lib.stride_tricks.as_strided(
        x, shape=(n, N_FFT), strides=(x.strides[0] * HOP, x.strides[0])
    )
    keep = _mask(n, VOCAL_SR / HOP, sections)
    mag = np.abs(np.fft.rfft(frames * np.hanning(N_FFT), axis=1))
    freqs = np.fft.rfftfreq(N_FFT, 1 / VOCAL_SR)
    total = float((mag[keep][:, freqs >= 20.0] ** 2).sum())
    if total < 1e-9:
        return 0.0
    # The HPSS mask is only needed in the voice band: filter just those bins plus the
    # percussive kernel's reach on each side (same result, a third of the work).
    band = np.flatnonzero((freqs >= VOICE_BAND[0]) & (freqs <= VOICE_BAND[1]))
    reach = HPSS_KERNEL // 2
    lo, hi = max(0, band[0] - reach), min(freqs.size, band[-1] + 1 + reach)
    sub = mag[:, lo:hi]
    harm = median_filter(sub, size=(HPSS_KERNEL, 1), mode="nearest")
    perc = median_filter(sub, size=(1, HPSS_KERNEL), mode="nearest")
    inner = slice(band[0] - lo, band[-1] + 1 - lo)
    h, p = harm[keep][:, inner], perc[keep][:, inner]
    mask = h**2 / (h**2 + p**2 + 1e-12)
    voice = float((sub[keep][:, inner] ** 2 * mask).sum())
    return float(np.sqrt(voice / total))


def estimate_presence(
    audio: npt.NDArray[np.floating], sr: int, sections: Sequence[Section]
) -> float:
    if not np.any(np.abs(audio) > 1e-6):
        return 0.0  # silence has no voice (the fit's intercept would say otherwise)
    slope, intercept = ESTIMATE_FIT
    value = slope * voice_band_feature(audio, sr, sections) + intercept
    return round(float(np.clip(value, 0.0, 1.0)), 3)
