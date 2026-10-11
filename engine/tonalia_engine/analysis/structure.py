"""Structure, labelled segments and automatic cue points (SPEC 2.6).

Everything is computed per bar (downbeat to downbeat), so boundaries and cues always
land on a downbeat:

1. Bar features: chroma, an MFCC-like timbre vector, loudness, low-band (kick/bass)
   level and spectral flux.
2. Novelty: Foote's checkerboard kernel over the bar self-similarity matrix, plus the
   jumps of loudness and of the low band (the kick dropping out or coming back).
3. Phrase grid: each novelty component is scaled by its 90th percentile (so one dramatic
   breakdown does not hide the other changes); the bar offset where novelty concentrates
   is found and boundaries are searched on the 4-bar grid from it, 8-bar phrase starts
   preferred.
4. Labels (heuristic): intro and outro at the ends, drop = loud with kick, breakdown =
   no kick and quieter, build = the section right before a drop, verse = the rest.
5. Cues: cue 1 on the first downbeat, then section starts by priority (drop, breakdown,
   second drop, outro, builds…) at least 16 bars apart, up to the configured number.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from itertools import pairwise
from math import gcd

import numpy as np
import numpy.typing as npt
from scipy.fft import dct
from scipy.signal import resample_poly

from .tempo import BeatGrid

FloatArray = npt.NDArray[np.float64]

STRUCT_SR = 22050
N_FFT = 2048
HOP = 512
FPS = STRUCT_SR / HOP
KERNEL_BARS = 4  # Foote kernel half-width
PHRASE_BARS = 8
MIN_SEGMENT_BARS = 4
BOUNDARY_THRESHOLD = 0.5  # in units of the 90th percentile of each novelty component
MIN_CUE_BARS = 16
LOW_BAND = (20.0, 150.0)

# DESIGN 2.5: one colour per section type.
CUE_COLORS: dict[str, str] = {
    "intro": "#4CC3FF",
    "build": "#3DDC97",
    "drop": "#FF5F8A",
    "breakdown": "#FFB547",
    "build2": "#9D8CFF",
    "drop2": "#FF7A3D",
    "verse": "#E0A4EE",
    "outro": "#8A879E",
}


@dataclass(frozen=True)
class Segment:
    start: float
    end: float
    label: str  # intro, verse, build, drop, breakdown, outro
    energy: float | None = None


@dataclass(frozen=True)
class StructureResult:
    segments: list[Segment]


@dataclass(frozen=True)
class AutoCue:
    position: float
    label: str  # key of CUE_COLORS
    color: str


def bar_length(grid: BeatGrid) -> float:
    if grid.kind == "variable" and grid.beats and len(grid.beats) > 1:
        return 4.0 * float(np.median(np.diff(grid.beats)))
    return 240.0 / grid.bpm


def downbeats(grid: BeatGrid, duration: float) -> FloatArray:
    """Every downbeat of the track (from the first one at or after 0)."""
    if grid.kind == "variable" and grid.beats:
        beats = np.asarray(grid.beats, dtype=np.float64)
        first = int(np.argmin(np.abs(beats - grid.first_downbeat)))
        out: FloatArray = beats[first % 4 :: 4]
        return out[out < duration]
    bar = bar_length(grid)
    t0 = grid.first_downbeat - bar * np.floor(grid.first_downbeat / bar)
    times: FloatArray = np.arange(t0, duration, bar)
    return times


def _resample(audio: npt.NDArray[np.floating], sr: int) -> FloatArray:
    x = np.asarray(audio, dtype=np.float64)
    if sr == STRUCT_SR:
        return x
    g = gcd(sr, STRUCT_SR)
    return np.asarray(resample_poly(x, STRUCT_SR // g, sr // g), dtype=np.float64)


def _mel_filters(freqs: FloatArray, n_bands: int = 26) -> FloatArray:
    def mel(f: FloatArray | float) -> FloatArray:
        return np.asarray(2595.0 * np.log10(1.0 + np.asarray(f) / 700.0))

    edges_mel = np.linspace(mel(30.0), mel(STRUCT_SR / 2), n_bands + 2)
    edges = 700.0 * (10 ** (edges_mel / 2595.0) - 1.0)
    bank = np.zeros((n_bands, len(freqs)))
    for i in range(n_bands):
        lo, mid, hi = edges[i], edges[i + 1], edges[i + 2]
        up = (freqs - lo) / (mid - lo)
        down = (hi - freqs) / (hi - mid)
        bank[i] = np.clip(np.minimum(up, down), 0.0, None)
    return bank


def bar_features(
    audio: npt.NDArray[np.floating], sr: int, bars: FloatArray, duration: float
) -> dict[str, FloatArray]:
    """Per-bar descriptors: chroma (12), timbre (12), loudness, low band and flux (dB)."""
    x = _resample(audio, sr)
    if len(x) < N_FFT:
        x = np.pad(x, (0, N_FFT - len(x)))
    n = 1 + (len(x) - N_FFT) // HOP
    frames = np.lib.stride_tricks.as_strided(
        x, shape=(n, N_FFT), strides=(x.strides[0] * HOP, x.strides[0])
    )
    mag = np.abs(np.fft.rfft(frames * np.hanning(N_FFT), axis=1))
    freqs: FloatArray = np.fft.rfftfreq(N_FFT, 1 / STRUCT_SR).astype(np.float64)
    power = mag**2

    pitched = (freqs >= 60.0) & (freqs <= 2000.0)
    pitch_class = np.round(12 * np.log2(freqs[pitched] / 440.0) + 9).astype(int) % 12
    fold = np.zeros((pitched.sum(), 12))
    fold[np.arange(pitched.sum()), pitch_class] = 1.0
    chroma = power[:, pitched] @ fold
    mel = np.log(power @ _mel_filters(freqs).T + 1e-10)
    timbre = dct(mel, type=2, norm="ortho", axis=1)[:, 1:13]
    low = power[:, (freqs >= LOW_BAND[0]) & (freqs <= LOW_BAND[1])].sum(axis=1)
    flux = np.maximum(0.0, np.diff(np.log1p(100 * mag), axis=0)).mean(axis=1)
    flux = np.concatenate([[0.0], flux])
    total = power.sum(axis=1)

    edges = [*bars.tolist(), duration]
    rows: dict[str, list[FloatArray | float]] = {
        "chroma": [],
        "timbre": [],
        "loud": [],
        "low": [],
        "flux": [],
    }
    for a, b in pairwise(edges):
        i, j = int(a * FPS), max(int(a * FPS) + 1, int(b * FPS))
        c = chroma[i:j].sum(axis=0)
        rows["chroma"].append(c / (np.linalg.norm(c) + 1e-12))
        rows["timbre"].append(timbre[i:j].mean(axis=0))
        rows["loud"].append(10 * np.log10(total[i:j].mean() + 1e-12))
        rows["low"].append(10 * np.log10(low[i:j].mean() + 1e-12))
        rows["flux"].append(float(flux[i:j].mean()))
    return {k: np.asarray(v, dtype=np.float64) for k, v in rows.items()}


def _foote(similarity: FloatArray, half: int) -> FloatArray:
    """Novelty at the start of each bar from a Gaussian-tapered checkerboard kernel."""
    n = len(similarity)
    idx = np.arange(-half, half)
    taper = np.exp(-0.5 * ((idx + 0.5) / (half / 2)) ** 2)
    sign = np.where(idx < 0, -1.0, 1.0)
    kernel = np.outer(sign * taper, sign * taper)
    padded = np.pad(similarity, half, mode="reflect")
    out = np.zeros(n)
    for i in range(n):
        out[i] = float((kernel * padded[i : i + 2 * half, i : i + 2 * half]).sum())
    return np.maximum(out, 0.0)


def _jump(values: FloatArray, half: int) -> FloatArray:
    out = np.zeros(len(values))
    for i in range(1, len(values)):
        before = values[max(0, i - half) : i]
        after = values[i : i + half]
        out[i] = abs(float(after.mean()) - float(before.mean()))
    return out


def _robust(x: FloatArray) -> FloatArray:
    scale = float(np.percentile(x, 90)) if len(x) else 0.0
    return x / scale if scale > 1e-12 else np.zeros_like(x)


def novelty(features: dict[str, FloatArray]) -> FloatArray:
    def standardize(m: FloatArray) -> FloatArray:
        out: FloatArray = (m - m.mean(axis=0)) / (m.std(axis=0) + 1e-9)
        return out

    stacked = np.hstack(
        [
            features["chroma"],
            standardize(features["timbre"]),
            standardize(np.column_stack([features["loud"], features["low"], features["flux"]])),
        ]
    )
    norms = np.linalg.norm(stacked, axis=1, keepdims=True) + 1e-12
    unit = stacked / norms
    similarity = unit @ unit.T
    out: FloatArray = (
        0.5 * _robust(_foote(similarity, KERNEL_BARS))
        + 0.25 * _robust(_jump(features["loud"], KERNEL_BARS))
        + 0.25 * _robust(_jump(features["low"], KERNEL_BARS))
    )
    out[0] = 0.0
    return out


def pick_boundaries(score: FloatArray) -> list[int]:
    """Bar indices where a new section starts (bar 0 excluded), on the 4-bar grid."""
    n = len(score)
    if n < 2 * MIN_SEGMENT_BARS:
        return []
    # The kernel smears a change over neighbouring bars: judge each bar by its ±1 window.
    local = np.array([score[max(0, i - 1) : i + 2].max() for i in range(n)])
    # Phrase offset from the unsmoothed novelty (the smeared one ties neighbouring bars).
    offset = int(np.argmax([score[o::PHRASE_BARS].sum() for o in range(PHRASE_BARS)]))
    candidates = [i for i in range(n) if (i - offset) % 4 == 0]
    weighted = {i: local[i] * (1.0 if (i - offset) % PHRASE_BARS == 0 else 0.8) for i in candidates}
    chosen: list[int] = []
    for i in sorted(weighted, key=lambda k: weighted[k], reverse=True):
        if weighted[i] < BOUNDARY_THRESHOLD:
            break
        if i < MIN_SEGMENT_BARS or n - i < MIN_SEGMENT_BARS:
            continue
        if all(abs(i - c) >= MIN_SEGMENT_BARS for c in chosen):
            chosen.append(i)
    return sorted(chosen)


def label_segments(loud: list[float], low: list[float]) -> list[str]:
    """Heuristic section labels from each segment's mean loudness and low band (dB)."""
    n = len(loud)
    if n == 1:
        return ["verse"]

    def rel(values: list[float]) -> FloatArray:
        v = np.asarray(values)
        span = float(v.max() - v.min())
        return (v - v.min()) / span if span > 1e-9 else np.full(len(v), 0.5)

    energy, bass = rel(loud), rel(low)
    labels = ["verse"] * n
    for i in range(n):
        if bass[i] < 0.35 and energy[i] < 0.6:
            labels[i] = "breakdown"
        elif energy[i] >= 0.75 and bass[i] >= 0.5:
            labels[i] = "drop"
    for i in range(n - 1):
        if labels[i] == "verse" and labels[i + 1] == "drop":
            labels[i] = "build"
    if labels[0] != "drop" or n > 2:
        labels[0] = "intro"
    if n > 2 and labels[-1] != "drop":
        labels[-1] = "outro"
    elif n > 2:
        labels[-1] = "outro" if energy[-1] < 0.75 else labels[-1]
    return labels


def merge_runs(starts: list[int], labels: list[str]) -> tuple[list[int], list[str]]:
    """Join consecutive segments with the same label (one drop split in two is one drop)."""
    out_starts, out_labels = [starts[0]], [labels[0]]
    for start, label in zip(starts[1:], labels[1:], strict=True):
        if label != out_labels[-1]:
            out_starts.append(start)
            out_labels.append(label)
    return out_starts, out_labels


def detect_structure(
    audio: npt.NDArray[np.floating],
    sr: int,
    grid: BeatGrid | None,
    energy_levels: Sequence[tuple[float, float, float]] | None = None,
) -> StructureResult | None:
    """Labelled segments on downbeats. ``energy_levels`` = (start, end, level) blocks."""
    x = np.asarray(audio, dtype=np.float64)
    if grid is None or len(x) < sr or float(np.sqrt(np.mean(x**2))) < 1e-5:
        return None
    duration = len(x) / sr
    bars = downbeats(grid, duration)
    if len(bars) < 2 * MIN_SEGMENT_BARS:
        return None
    features = bar_features(x, sr, bars, duration)
    starts = [0, *pick_boundaries(novelty(features))]
    ends = [*starts[1:], len(bars)]
    loud = [float(features["loud"][a:b].mean()) for a, b in zip(starts, ends, strict=True)]
    low = [float(features["low"][a:b].mean()) for a, b in zip(starts, ends, strict=True)]
    starts, labels = merge_runs(starts, label_segments(loud, low))
    ends = [*starts[1:], len(bars)]
    segments = []
    for k, (a, b) in enumerate(zip(starts, ends, strict=True)):
        start = 0.0 if a == 0 else float(bars[a])
        end = duration if b == len(bars) else float(bars[b])
        segments.append(Segment(start, end, labels[k], _mean_level(energy_levels, start, end)))
    return StructureResult(segments)


def _mean_level(
    blocks: Sequence[tuple[float, float, float]] | None, start: float, end: float
) -> float | None:
    if not blocks:
        return None
    total = weight = 0.0
    for a, b, level in blocks:
        overlap = min(b, end) - max(a, start)
        if overlap > 0:
            total += overlap * level
            weight += overlap
    return round(total / weight, 2) if weight > 0 else None


def _cue_keys(segments: Sequence[Segment]) -> list[str]:
    """Cue label per segment: second and later drops/builds get their own colour."""
    seen: dict[str, int] = {}
    keys = []
    for seg in segments:
        seen[seg.label] = seen.get(seg.label, 0) + 1
        if seg.label in ("drop", "build") and seen[seg.label] >= 2:
            keys.append(f"{seg.label}2")
        else:
            keys.append(seg.label if seg.label in CUE_COLORS else "verse")
    return keys


def _priority(key: str, label: str, occurrence: int) -> int:
    if label == "drop":
        return 0 if occurrence == 1 else 2 if occurrence == 2 else 7
    if label == "breakdown":
        return 1 if occurrence == 1 else 6
    order = {"outro": 3, "build": 4, "build2": 5, "verse": 8, "intro": 9}
    return order.get(key, 8)


def auto_cues(
    segments: Sequence[Segment],
    grid: BeatGrid,
    max_cues: int = 8,
    min_bars: int = MIN_CUE_BARS,
    reserved: Sequence[float] = (),
) -> list[AutoCue]:
    """Automatic cues: first downbeat, then section starts by priority, time-ordered.

    ``reserved`` holds positions of the user's cues: autos within one bar are skipped.
    """
    if max_cues <= 0 or not segments:
        return []
    bar = bar_length(grid)
    keys = _cue_keys(segments)
    first = float(downbeats(grid, segments[-1].end)[0]) if segments[-1].end > 0 else 0.0
    candidates: list[tuple[int, float, str]] = [(-1, first, keys[0])]
    counts: dict[str, int] = {}
    for seg, key in zip(segments[1:], keys[1:], strict=True):
        counts[seg.label] = counts.get(seg.label, 0) + 1
        candidates.append((_priority(key, seg.label, counts[seg.label]), seg.start, key))
    chosen: list[tuple[float, str]] = []
    for _, position, key in sorted(candidates):
        if len(chosen) >= max_cues:
            break
        if any(abs(position - r) <= bar for r in reserved):
            continue
        if all(abs(position - p) >= min_bars * bar - 1e-6 for p, _ in chosen):
            chosen.append((position, key))
    return [AutoCue(round(p, 4), k, CUE_COLORS[k]) for p, k in sorted(chosen)]
