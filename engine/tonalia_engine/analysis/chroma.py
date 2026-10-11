"""Tonal features: harmonic spectrogram (HPSS), tuning estimation and HPCP.

Implemented with numpy/scipy only (no Essentia/librosa, see PROGRESS.md decisions).
Audio is analysed at 11 025 Hz with long frames (8192 samples, ~0.74 s) because key
estimation needs fine frequency resolution and little time resolution.
"""

from __future__ import annotations

from math import gcd

import numpy as np
import numpy.typing as npt
from scipy.ndimage import median_filter
from scipy.signal import resample_poly

ANALYSIS_SR = 11025
FRAME = 8192
HOP = 2048
FMIN = 100.0
FMAX = 5000.0
HPSS_KERNEL = 17

FloatArray = npt.NDArray[np.float64]


def frame_seconds(n_frames: int) -> float:
    return n_frames * HOP / ANALYSIS_SR


def _resample(audio: npt.NDArray[np.floating], sr: int) -> FloatArray:
    x = np.asarray(audio, dtype=np.float64)
    if sr == ANALYSIS_SR:
        return x
    g = gcd(sr, ANALYSIS_SR)
    return np.asarray(resample_poly(x, ANALYSIS_SR // g, sr // g), dtype=np.float64)


def magnitude_spectrogram(
    audio: npt.NDArray[np.floating], sr: int
) -> tuple[FloatArray, FloatArray]:
    """|STFT| as (frames, bins), restricted to 0..FMAX, plus the bin frequencies."""
    x = _resample(audio, sr)
    if len(x) < FRAME:
        x = np.pad(x, (0, FRAME - len(x)))
    n_frames = 1 + (len(x) - FRAME) // HOP
    frames = np.lib.stride_tricks.as_strided(
        x, shape=(n_frames, FRAME), strides=(x.strides[0] * HOP, x.strides[0])
    )
    window = np.hanning(FRAME)
    freqs = np.fft.rfftfreq(FRAME, 1 / ANALYSIS_SR)
    keep = freqs <= FMAX
    spec: FloatArray = np.abs(np.fft.rfft(frames * window, axis=1))[:, keep].astype(np.float64)
    kept: FloatArray = freqs[keep].astype(np.float64)
    return spec, kept


def hpss(spec: FloatArray) -> tuple[FloatArray, FloatArray]:
    """Median-filtering HPSS (Fitzgerald 2010): returns (harmonic, percussive)."""
    harm = median_filter(spec, size=(HPSS_KERNEL, 1), mode="nearest")
    perc = median_filter(spec, size=(1, HPSS_KERNEL), mode="nearest")
    h2, p2 = harm**2, perc**2
    mask = h2 / (h2 + p2 + 1e-12)
    return spec * mask, spec * (1.0 - mask)


def harmonic_spectrogram(audio: npt.NDArray[np.floating], sr: int) -> tuple[FloatArray, FloatArray]:
    spec, freqs = magnitude_spectrogram(audio, sr)
    harmonic, _ = hpss(spec)
    return harmonic, freqs


def spectral_peaks(
    spec: FloatArray, freqs: FloatArray, rel_threshold: float = 0.05
) -> tuple[npt.NDArray[np.intp], FloatArray, FloatArray]:
    """Local maxima in FMIN..FMAX with parabolic interpolation.

    Returns (frame index, frequency in Hz, magnitude) for every peak.
    """
    centre = spec[:, 1:-1]
    is_peak = (centre > spec[:, :-2]) & (centre >= spec[:, 2:])
    frame_max = spec.max(axis=1, keepdims=True)
    is_peak &= centre > rel_threshold * frame_max
    band = (freqs[1:-1] >= FMIN) & (freqs[1:-1] <= FMAX)
    is_peak &= band[None, :]
    frame_idx, bin_idx = np.nonzero(is_peak)
    bin_idx = bin_idx + 1
    a = np.log(spec[frame_idx, bin_idx - 1] + 1e-12)
    b = np.log(spec[frame_idx, bin_idx] + 1e-12)
    c = np.log(spec[frame_idx, bin_idx + 1] + 1e-12)
    denom = a - 2 * b + c
    offset = np.where(np.abs(denom) > 1e-12, 0.5 * (a - c) / denom, 0.0)
    df = freqs[1] - freqs[0]
    return frame_idx, (bin_idx + offset) * df, spec[frame_idx, bin_idx]


def estimate_tuning(spec: FloatArray, freqs: FloatArray) -> float:
    """Reference frequency of A4 (e.g. 440 or 432 Hz) from peak deviations in cents."""
    _, f, m = spectral_peaks(spec, freqs)
    if len(f) == 0:
        return 440.0
    cents = 1200.0 * np.log2(f / 440.0)
    angle = 2 * np.pi * (cents % 100.0) / 100.0
    mean = np.angle(np.sum(m * np.exp(1j * angle)))
    deviation = mean / (2 * np.pi) * 100.0  # -50..50 cents
    return float(440.0 * 2.0 ** (deviation / 1200.0))


def hpcp(spec: FloatArray, freqs: FloatArray, a4: float = 440.0, harmonics: int = 4) -> FloatArray:
    """Harmonic pitch class profile per frame, shape (frames, 12), C = 0.

    Each peak contributes to the pitch class of its frequency and, with decaying
    weight, to those of f/2..f/h (it may be an upper harmonic of a lower note). The
    contribution is spread with a cos² window of 4/3 semitone (Gómez 2006).
    """
    out = np.zeros((spec.shape[0], 12))
    frame_idx, f, m = spectral_peaks(spec, freqs)
    if len(f) == 0:
        return out
    weight = np.sqrt(m)
    width = 4.0 / 3.0
    for h in range(1, harmonics + 1):
        f0 = f / h
        valid = f0 >= FMIN / 2
        pc = (12.0 * np.log2(f0[valid] / a4) + 9.0) % 12.0
        w = weight[valid] * (0.6 ** (h - 1))
        fi = frame_idx[valid]
        base = np.floor(pc).astype(int)
        for k in (-1, 0, 1, 2):
            pitch = (base + k) % 12
            d = np.abs(((pc - (base + k)) + 6.0) % 12.0 - 6.0)
            contrib = np.where(d < width / 2, np.cos(np.pi * d / width) ** 2, 0.0) * w
            np.add.at(out, (fi, pitch), contrib)
    peak = out.max(axis=1, keepdims=True)
    normalized: FloatArray = np.divide(out, peak, out=np.zeros_like(out), where=peak > 0)
    return normalized
