"""Vocal presence 0-1 (SPEC 2.16, 12.3): how much of a track's main sections is voice.

With stems it is measured: RMS(vocals) / RMS(mix) over the main sections. Before the
track is separated it is estimated from the mix by a small model (``vocals_model.npz``,
trained by ``tools/train_vocals.py`` on Demucs separations): per frame it predicts the
share of the power that is voice from log-mel bands, their change and their local
average, and those shares are pooled exactly like the measurement. Without the weights,
the first heuristic remains: the share of harmonic energy in the voice band, 300-3400 Hz,
mapped to the stems scale by a linear fit (``ESTIMATE_FIT``).

The presence also tells acapellas and instrumentals apart from tracks with voice
(``vocal_kind``), which replaces guessing it from the title or the genre.

Main sections are every segment but the intro and the outro, which are often
instrumental by design; without segments, the track minus its first and last 10 %.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from functools import lru_cache
from importlib import resources
from math import gcd
from typing import Literal

import numpy as np
import numpy.typing as npt
from scipy.ndimage import median_filter
from scipy.signal import resample_poly

from .key_cnn import Float32Array, conv_same
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
VocalSource = Literal["heuristic", "model", "stems"]
VocalKind = Literal["acapella", "instrumental", "vocal"]

# Input of the model (SPEC 12.3): log-mel bands per frame.
N_MELS = 40
MEL_RANGE = (80.0, 5000.0)
N_FEATURES = N_MELS


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


def _resampled(audio: npt.NDArray[np.floating], sr: int) -> FloatArray:
    x = _mono(audio)
    if sr != VOCAL_SR:
        g = gcd(sr, VOCAL_SR)
        x = resample_poly(x, VOCAL_SR // g, sr // g)
    return x


def _stft_power(x: FloatArray) -> FloatArray:
    """Power spectrogram (frames, N_FFT // 2 + 1) at ``VOCAL_SR``."""
    if x.size < N_FFT:
        x = np.pad(x, (0, N_FFT - x.size))
    n = 1 + (x.size - N_FFT) // HOP
    frames = np.lib.stride_tricks.as_strided(
        x, shape=(n, N_FFT), strides=(x.strides[0] * HOP, x.strides[0])
    )
    out: FloatArray = np.abs(np.fft.rfft(frames * np.hanning(N_FFT), axis=1)) ** 2
    return out


@lru_cache(maxsize=1)
def mel_filterbank() -> FloatArray:
    """Triangular filters, equally spaced on the mel scale: (N_FFT // 2 + 1, N_MELS)."""

    def mel(f: FloatArray | float) -> FloatArray:
        return np.asarray(2595.0 * np.log10(1.0 + np.asarray(f) / 700.0))

    freqs = np.fft.rfftfreq(N_FFT, 1 / VOCAL_SR)
    edges_mel = np.linspace(mel(MEL_RANGE[0]), mel(MEL_RANGE[1]), N_MELS + 2)
    edges = 700.0 * (10 ** (edges_mel / 2595.0) - 1.0)
    bank = np.zeros((freqs.size, N_MELS))
    for i in range(N_MELS):
        lo, mid, hi = edges[i], edges[i + 1], edges[i + 2]
        rise = (freqs - lo) / max(mid - lo, 1e-9)
        fall = (hi - freqs) / max(hi - mid, 1e-9)
        bank[:, i] = np.clip(np.minimum(rise, fall), 0.0, None)
    bank /= np.maximum(bank.sum(axis=0, keepdims=True), 1e-12)
    return bank


def frame_features(audio: npt.NDArray[np.floating], sr: int) -> tuple[FloatArray, FloatArray]:
    """The model's input, (frames, N_MELS) log-mel bands with the track's mean level
    removed (so the gain does not matter), and each frame's power."""
    power = _stft_power(_resampled(audio, sr))
    total = power[:, 1:].sum(axis=1)
    mel = power @ mel_filterbank()
    # The floor follows the track's level, so silent bands do not depend on the gain.
    logmel = np.log(mel + max(float(mel.max(initial=0.0)), 1e-20) * 1e-9)
    loud = (
        total > total.max() * 1e-6 if total.size and total.max() > 0 else np.ones(total.size, bool)
    )
    logmel -= logmel[loud].mean() if loud.any() else 0.0
    return logmel, total


def frame_voice_share(
    vocals: npt.NDArray[np.floating], mix: npt.NDArray[np.floating], sr: int
) -> FloatArray:
    """Training target: the share of each frame's power that is voice, 0-1."""
    v = _stft_power(_resampled(vocals, sr))[:, 1:].sum(axis=1)
    m = _stft_power(_resampled(mix, sr))[:, 1:].sum(axis=1)
    n = min(v.size, m.size)
    out: FloatArray = np.clip(v[:n] / np.maximum(m[:n], 1e-12), 0.0, 1.0)
    return out


def pooled_presence(share: FloatArray, power: FloatArray, keep: npt.NDArray[np.bool_]) -> float:
    """sqrt(voice power / mix power) from per-frame shares: the measurement's formula."""
    total = float(power[keep].sum())
    if total <= 1e-12:
        return 0.0
    return float(np.sqrt(np.clip(float((share[keep] * power[keep]).sum()) / total, 0.0, 1.0)))


@dataclass(frozen=True)
class VocalModel:
    """A small convolutional network over the log-mel spectrogram, run in numpy.

    3x3 convolutions (batch norm folded in) with ReLU, each optionally halving the bands,
    a convolution along time, and a last layer over the remaining bands that gives one
    logit per frame: the share of that frame's power that is voice."""

    convs: tuple[tuple[Float32Array, Float32Array, bool], ...]  # (kh, kw, Cin, Cout), bias, pool
    head: tuple[Float32Array, float]  # (F', C), bias
    # Presence thresholds: below ``instrumental`` no voice, above ``acapella`` only voice.
    instrumental: float
    acapella: float

    @classmethod
    def from_arrays(cls, a: dict[str, npt.NDArray[np.floating]]) -> VocalModel:
        n = sum(1 for k in a if k.startswith("conv") and k.endswith("_w"))
        convs = tuple(
            (
                np.asarray(a[f"conv{i}_w"], np.float32),
                np.asarray(a[f"conv{i}_b"], np.float32),
                bool(np.asarray(a[f"conv{i}_pool"])),
            )
            for i in range(n)
        )
        return cls(
            convs,
            (np.asarray(a["head_w"], np.float32), float(np.asarray(a["head_b"]))),
            float(np.asarray(a["instrumental"])),
            float(np.asarray(a["acapella"])),
        )

    @classmethod
    def load(cls) -> VocalModel | None:
        return _load_model()

    def frame_shares(self, features: FloatArray) -> FloatArray:
        x = features.astype(np.float32)[:, :, None]  # (T, F, 1)
        for w, b, pool in self.convs:
            x = np.maximum(conv_same(x, w, b), 0.0)
            if pool:
                f = x.shape[1] // 2 * 2
                x = np.maximum(x[:, 0:f:2], x[:, 1:f:2])
        head_w, head_b = self.head
        z = np.einsum("tfc,fc->t", x, head_w) + head_b
        out: FloatArray = 1.0 / (1.0 + np.exp(-np.clip(z.astype(np.float64), -30, 30)))
        return out

    def presence(
        self, audio: npt.NDArray[np.floating], sr: int, sections: Sequence[Section]
    ) -> float:
        features, power = frame_features(audio, sr)
        keep = _mask(len(power), VOCAL_SR / HOP, sections)
        return pooled_presence(self.frame_shares(features), power, keep)

    def kind(self, presence: float) -> VocalKind:
        if presence < self.instrumental:
            return "instrumental"
        return "acapella" if presence > self.acapella else "vocal"


@lru_cache(maxsize=1)
def _load_model() -> VocalModel | None:
    path = resources.files(__package__).joinpath("vocals_model.npz")
    if not path.is_file():
        return None
    with path.open("rb") as fh, np.load(fh) as data:
        return VocalModel.from_arrays({k: data[k] for k in data.files})


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


def heuristic_presence(
    audio: npt.NDArray[np.floating], sr: int, sections: Sequence[Section]
) -> float:
    """The first estimate (SPEC 7.3): voice-band harmonic energy through a linear fit."""
    if not np.any(np.abs(audio) > 1e-6):
        return 0.0  # silence has no voice (the fit's intercept would say otherwise)
    slope, intercept = ESTIMATE_FIT
    value = slope * voice_band_feature(audio, sr, sections) + intercept
    return round(float(np.clip(value, 0.0, 1.0)), 3)


def estimate_presence(
    audio: npt.NDArray[np.floating],
    sr: int,
    sections: Sequence[Section],
    model: VocalModel | None = None,
) -> tuple[float, VocalSource]:
    """Presence before the track has stems: the model when its weights ship, else the
    heuristic. Returns the value and where it comes from."""
    if not np.any(np.abs(audio) > 1e-6):
        return 0.0, "model" if (model or VocalModel.load()) else "heuristic"
    model = model or VocalModel.load()
    if model is None:
        return heuristic_presence(audio, sr, sections), "heuristic"
    return round(model.presence(audio, sr, sections), 3), "model"


# Without the model (or for a measured value), these thresholds tell the kinds apart.
DEFAULT_THRESHOLDS = (0.12, 0.85)


def vocal_kind(presence: float | None) -> VocalKind | None:
    """Acapella, instrumental or a track with voice, from the presence (None if unknown)."""
    if presence is None:
        return None
    model = VocalModel.load()
    if model is not None:
        return model.kind(presence)
    instrumental, acapella = DEFAULT_THRESHOLDS
    if presence < instrumental:
        return "instrumental"
    return "acapella" if presence > acapella else "vocal"
