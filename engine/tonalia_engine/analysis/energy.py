"""Energy level 1-10 (SPEC 2.5) — Tonalia's own algorithm.

1. The track is cut into 8-bar blocks following the beatgrid (fixed ~15 s blocks when
   there is no grid).
2. Per block: short-term loudness (LUFS, ITU-R BS.1770 via pyloudnorm), onset density
   (onsets/s), percussive share (HPSS), mean spectral flux, share of energy in 20-150 Hz
   and spectral centroid.
3. Each descriptor is normalized with reference ranges (``energy_ref.json``), combined
   with weights (``energy_weights.json``) into a score, and mapped to 1-10 with a
   calibrated sigmoid (``tools/calibrate_energy.py`` fits weights and sigmoid).
4. The track energy is the mean of the most energetic half of the blocks (the main
   parts, not the intro); the per-block curve is kept to draw over the waveform.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field, replace
from importlib import resources
from itertools import pairwise
from math import gcd
from typing import Any

import numpy as np
import numpy.typing as npt
import pyloudnorm
from scipy.ndimage import median_filter
from scipy.signal import resample_poly

from .tempo import BeatGrid

FloatArray = npt.NDArray[np.float64]

DESCRIPTORS: tuple[str, ...] = (
    "loudness",
    "onset_density",
    "percussive_ratio",
    "spectral_flux",
    "low_ratio",
    "centroid",
)
BARS_PER_BLOCK = 8
BEATS_PER_BAR = 4
FALLBACK_BLOCK_SECONDS = 15.0
SILENCE_LUFS = -70.0

ENERGY_SR = 22050
N_FFT = 2048
HOP = 1024
FPS = ENERGY_SR / HOP
HPSS_KERNEL = 9
LOW_BAND = (20.0, 150.0)


@dataclass(frozen=True)
class EnergyBlock:
    start: float
    end: float
    level: float  # 1.0-10.0, unrounded so the curve stays smooth


@dataclass(frozen=True)
class EnergyResult:
    energy: int
    curve: list[EnergyBlock]
    # Raw descriptors per block (blocks, len(DESCRIPTORS)): kept so a personal calibration
    # can recompute the levels without decoding the audio again (SPEC 12.2).
    descriptors: list[list[float]] = field(default_factory=list)


@dataclass(frozen=True)
class EnergyModel:
    """Reference ranges, weights and sigmoid that turn descriptors into levels."""

    ref: FloatArray  # (descriptors, 2): value mapped to 0 and to 1
    weights: dict[str, float]
    bias: float
    center: float
    slope: float

    @classmethod
    def load(cls) -> EnergyModel:
        pkg = resources.files(__package__)
        ref = json.loads(pkg.joinpath("energy_ref.json").read_text("utf-8"))["ranges"]
        data = json.loads(pkg.joinpath("energy_weights.json").read_text("utf-8"))
        return cls(
            ref=np.array([ref[name] for name in DESCRIPTORS], dtype=np.float64),
            weights={name: float(data["weights"].get(name, 0.0)) for name in DESCRIPTORS},
            bias=float(data.get("bias", 0.0)),
            center=float(data["sigmoid"]["center"]),
            slope=float(data["sigmoid"]["slope"]),
        )

    def with_params(self, params: dict[str, Any] | None) -> EnergyModel:
        """This model with the weights and sigmoid of a personal calibration (if any)."""
        if not params:
            return self
        weights = params.get("weights")
        sigmoid = params.get("sigmoid")
        if not isinstance(weights, dict) or not isinstance(sigmoid, dict):
            return self
        return replace(
            self,
            weights={name: float(weights.get(name, 0.0)) for name in DESCRIPTORS},
            bias=float(params.get("bias", 0.0)),
            center=float(sigmoid.get("center", 0.0)),
            slope=float(sigmoid.get("slope", 1.0)),
        )

    def normalize(self, raw: FloatArray) -> FloatArray:
        lo, hi = self.ref[:, 0], self.ref[:, 1]
        out: FloatArray = np.clip((raw - lo) / (hi - lo), 0.0, 1.0)
        return out

    def levels_from_normalized(self, x: FloatArray) -> FloatArray:
        w = np.array([self.weights[name] for name in DESCRIPTORS])
        score = x @ w + self.bias
        out: FloatArray = 1.0 + 9.0 / (1.0 + np.exp(-self.slope * (score - self.center)))
        return out

    def levels(self, raw: FloatArray) -> FloatArray:
        """Levels 1-10 (float) for raw descriptor rows, shape (blocks, descriptors)."""
        return self.levels_from_normalized(self.normalize(raw))


def block_bounds(duration: float, grid: BeatGrid | None) -> list[tuple[float, float]]:
    """(start, end) of 8-bar blocks aligned to the downbeats; the first block may be a
    partial pickup before the first downbeat, a short tail joins the last block."""
    if duration <= 0:
        return []
    starts: list[float]
    beats_per_block = BARS_PER_BLOCK * BEATS_PER_BAR
    if grid is not None and grid.kind == "variable" and grid.beats:
        beats = np.asarray(grid.beats)
        first = int(np.argmin(np.abs(beats - grid.first_downbeat)))
        starts = [float(t) for t in beats[first::beats_per_block]]
    elif grid is not None and grid.bpm > 0:
        block = beats_per_block * 60.0 / grid.bpm
        first = grid.first_downbeat - block * np.floor(grid.first_downbeat / block)
        starts = [float(t) for t in np.arange(first, duration, block)]
    else:
        n = max(1, round(duration / FALLBACK_BLOCK_SECONDS))
        starts = [i * duration / n for i in range(n)]
    if not starts or starts[0] > 1e-6:
        starts.insert(0, 0.0)
    edges = [*starts, duration]
    bounds = [(a, b) for a, b in pairwise(edges) if b - a > 1e-6]
    # A tail shorter than half a block is merged into the previous block.
    typical = float(np.median([b - a for a, b in bounds])) if bounds else 0.0
    if len(bounds) > 1 and bounds[-1][1] - bounds[-1][0] < typical / 2:
        last = bounds.pop()
        bounds[-1] = (bounds[-1][0], last[1])
    return bounds


def _resample(audio: npt.NDArray[np.floating], sr: int) -> FloatArray:
    x = np.asarray(audio, dtype=np.float64)
    if sr == ENERGY_SR:
        return x
    g = gcd(sr, ENERGY_SR)
    return np.asarray(resample_poly(x, ENERGY_SR // g, sr // g), dtype=np.float64)


@dataclass(frozen=True)
class _Frames:
    """Per-frame spectral features shared by all blocks."""

    flux: FloatArray
    onsets: npt.NDArray[np.bool_]
    perc: FloatArray  # percussive energy
    harm: FloatArray  # harmonic energy
    low: FloatArray  # energy in LOW_BAND
    total: FloatArray  # energy above 20 Hz
    centroid: FloatArray  # Hz


def _frame_features(audio: npt.NDArray[np.floating], sr: int) -> _Frames:
    x = _resample(audio, sr)
    if len(x) < N_FFT:
        x = np.pad(x, (0, N_FFT - len(x)))
    n = 1 + (len(x) - N_FFT) // HOP
    frames = np.lib.stride_tricks.as_strided(
        x, shape=(n, N_FFT), strides=(x.strides[0] * HOP, x.strides[0])
    )
    mag = np.abs(np.fft.rfft(frames * np.hanning(N_FFT), axis=1))
    freqs = np.fft.rfftfreq(N_FFT, 1 / ENERGY_SR)
    power = mag**2

    harm = median_filter(mag, size=(HPSS_KERNEL, 1), mode="nearest")
    perc = median_filter(mag, size=(1, HPSS_KERNEL), mode="nearest")
    mask = harm**2 / (harm**2 + perc**2 + 1e-12)

    log_mag = np.log1p(100.0 * mag)
    flux = np.maximum(0.0, np.diff(log_mag, axis=0)).mean(axis=1)
    flux = np.concatenate([[0.0], flux])
    # Onsets: local maxima of the flux clearly above its running median (~1 s).
    baseline = median_filter(flux, size=int(FPS) | 1, mode="nearest")
    threshold = 1.5 * baseline + 0.1 * flux.std()
    peak = np.zeros_like(flux, dtype=bool)
    mid = flux[1:-1]
    peak[1:-1] = (mid > flux[:-2]) & (mid >= flux[2:]) & (mid > threshold[1:-1])

    audible = freqs >= LOW_BAND[0]
    low_band = (freqs >= LOW_BAND[0]) & (freqs <= LOW_BAND[1])
    amp = mag[:, audible].sum(axis=1)
    centroid = (mag[:, audible] @ freqs[audible]) / np.maximum(amp, 1e-12)
    return _Frames(
        flux=flux,
        onsets=peak,
        perc=(power * (1 - mask)).sum(axis=1),
        harm=(power * mask).sum(axis=1),
        low=power[:, low_band].sum(axis=1),
        total=power[:, audible].sum(axis=1),
        centroid=centroid,
    )


def block_descriptors(
    audio: npt.NDArray[np.floating], sr: int, bounds: list[tuple[float, float]]
) -> FloatArray:
    """Raw descriptors per block, shape (blocks, len(DESCRIPTORS))."""
    f = _frame_features(audio, sr)
    meter = pyloudnorm.Meter(sr)
    x = np.asarray(audio, dtype=np.float64)
    rows = []
    for start, end in bounds:
        a, b = int(start * FPS), max(int(start * FPS) + 1, int(end * FPS))
        seg = x[int(start * sr) : int(end * sr)]
        loud = SILENCE_LUFS
        if len(seg) >= int(0.4 * sr) and np.any(seg):
            value = float(meter.integrated_loudness(seg))
            loud = max(SILENCE_LUFS, value) if np.isfinite(value) else SILENCE_LUFS
        total = f.total[a:b]
        weight = total / max(float(total.sum()), 1e-12)
        rows.append(
            [
                loud,
                float(f.onsets[a:b].sum()) / max(end - start, 1e-6),
                float(f.perc[a:b].sum() / max(float((f.perc[a:b] + f.harm[a:b]).sum()), 1e-12)),
                float(f.flux[a:b].mean()) if b > a else 0.0,
                float(f.low[a:b].sum() / max(float(total.sum()), 1e-12)),
                float((f.centroid[a:b] * weight).sum()),
            ]
        )
    return np.asarray(rows, dtype=np.float64)


def track_energy(levels: FloatArray) -> int:
    """Mean of the most energetic half of the blocks, as an integer 1-10."""
    top = np.sort(levels)[::-1][: max(1, int(np.ceil(len(levels) / 2)))]
    return int(np.clip(round(float(top.mean())), 1, 10))


def detect_energy(
    audio: npt.NDArray[np.floating],
    sr: int,
    grid: BeatGrid | None = None,
    model: EnergyModel | None = None,
) -> EnergyResult | None:
    """Energy level and per-block curve of mono ``audio``; None for silence."""
    x = np.asarray(audio, dtype=np.float64)
    if len(x) < sr or float(np.sqrt(np.mean(x**2))) < 1e-5:
        return None
    model = model or EnergyModel.load()
    bounds = block_bounds(len(x) / sr, grid)
    raw = block_descriptors(x, sr, bounds)
    levels = model.levels(raw)
    curve = [
        EnergyBlock(round(a, 3), round(b, 3), round(float(lv), 2))
        for (a, b), lv in zip(bounds, levels, strict=True)
    ]
    descriptors = [[round(float(v), 6) for v in row] for row in raw]
    return EnergyResult(track_energy(levels), curve, descriptors)
