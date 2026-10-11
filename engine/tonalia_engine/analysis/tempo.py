"""Tempo, beatgrid and downbeats (SPEC 2.4) — numpy/scipy implementation.

1. Onset strength: half-wave rectified spectral flux of the log spectrum (~172 frames/s),
   plus the linear sub-150 Hz energy used to find downbeats.
2. Tempo: autocorrelation of the onset envelope, reinforced by its multiples; the octave
   (x0.5, x1, x2) is chosen inside the configured range with a log-normal prior around
   120 BPM (around 172 BPM for drum & bass / dubstep / jungle genres).
3. Beats: dynamic-programming beat tracker (Ellis 2007), then a robust linear fit of the
   beat times gives the precise BPM and grid phase.
4. Variable tempo: local BPM over 32-beat windows; deviations above 1 % produce a beat
   list instead of a fixed grid.
5. Downbeat: the beat phase (of 4) with the most bass and onset energy, validated by where
   the largest energy changes (phrase boundaries) fall.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal
from functools import lru_cache
from itertools import pairwise
from math import gcd
from typing import Literal

import numpy as np
import numpy.typing as npt
from scipy.signal import resample_poly

TEMPO_SR = 22050
N_FFT = 1024
HOP = 128
FPS = TEMPO_SR / HOP  # ~172.27 frames per second
BASS_HZ = 150.0
VARIABLE_TOLERANCE = 0.01
FAST_GENRES = ("drum", "dnb", "d&b", "jungle", "dubstep", "neurofunk")

FloatArray = npt.NDArray[np.float64]


@dataclass(frozen=True)
class TempoSettings:
    min_bpm: float = 70.0
    max_bpm: float = 180.0


@dataclass(frozen=True)
class BeatGrid:
    kind: Literal["constant", "variable"]
    bpm: float
    first_downbeat: float
    beats: list[float] | None = None  # only for variable tempo


@dataclass(frozen=True)
class TempoResult:
    bpm: float
    confidence: float
    grid: BeatGrid
    beats: list[float] = field(repr=False)
    downbeats: list[float] = field(repr=False)


def round_bpm(bpm: float, decimals: int) -> float:
    quantum = Decimal(1).scaleb(-decimals)
    return float(Decimal(str(bpm)).quantize(quantum, rounding=ROUND_HALF_UP))


def onset_envelopes(audio: npt.NDArray[np.floating], sr: int) -> tuple[FloatArray, FloatArray]:
    """Onset strength (for beats) and linear sub-150 Hz energy (for downbeats), per frame."""
    x = np.asarray(audio, dtype=np.float64)
    if sr != TEMPO_SR:
        g = gcd(sr, TEMPO_SR)
        x = np.asarray(resample_poly(x, TEMPO_SR // g, sr // g), dtype=np.float64)
    if len(x) < N_FFT * 2:
        return np.zeros(1), np.zeros(1)
    n = 1 + (len(x) - N_FFT) // HOP
    frames = np.lib.stride_tricks.as_strided(
        x, shape=(n, N_FFT), strides=(x.strides[0] * HOP, x.strides[0])
    )
    mag = np.abs(np.fft.rfft(frames * np.hanning(N_FFT), axis=1))
    log_mag = np.log1p(100.0 * mag)
    flux = np.maximum(0.0, np.diff(log_mag, axis=0))
    flux = np.vstack([np.zeros((1, flux.shape[1])), flux])
    freqs = np.fft.rfftfreq(N_FFT, 1 / TEMPO_SR)
    # Sum the flux per log-spaced band and normalize each band, so broadband noise (hats)
    # cannot outweigh the kick just by spanning more bins; then emphasize the low end,
    # because DJ beatgrids align to the kick.
    edges = np.geomspace(30.0, TEMPO_SR / 2, 9)
    bands = []
    for lo, hi in pairwise(edges):
        sel = (freqs >= lo) & (freqs < hi)
        if sel.any():
            band = flux[:, sel].sum(axis=1)
            bands.append(band / (band.std() + 1e-12))
    bass = flux[:, freqs <= BASS_HZ].sum(axis=1)
    onset = np.sum(bands, axis=0) + 2.0 * bass / (bass.std() + 1e-12)
    # Downbeats need levels, which log compression flattens: linear low-band energy.
    low_energy: FloatArray = (mag[:, freqs <= BASS_HZ] ** 2).sum(axis=1)

    def highpass(env: FloatArray) -> FloatArray:
        # Remove the slowly varying part (≈0.4 s moving average) to sharpen peaks.
        width = int(FPS * 0.4)
        kernel = np.ones(width) / width
        out: FloatArray = np.maximum(0.0, env - np.convolve(env, kernel, mode="same"))
        return out

    return highpass(onset), low_energy


@lru_cache(maxsize=1)
def onset_latency() -> float:
    """Seconds by which the onset envelope precedes the real onset.

    With log compression the flux jumps as soon as a transient enters the edge of the
    analysis window, i.e. before the frame's start time catches up with it. Measured once
    with a synthetic impulse so it stays exact if the STFT parameters change.
    """
    impulse = np.zeros(TEMPO_SR * 2)
    impulse[TEMPO_SR] = 1.0
    onset, _ = onset_envelopes(impulse, TEMPO_SR)
    return 1.0 - int(np.argmax(onset)) / FPS


def _frame_of(t: float) -> int:
    return round((t - onset_latency()) * FPS)


def _autocorrelation(env: FloatArray) -> FloatArray:
    x = env - env.mean()
    spectrum = np.fft.rfft(x, n=2 * len(x))
    acf = np.fft.irfft(np.abs(spectrum) ** 2)[: len(x)]
    out: FloatArray = acf / acf[0] if acf[0] > 0 else acf
    return out


def _acf_at(acf: FloatArray, lag: float) -> float:
    i = int(lag)
    if i + 1 >= len(acf) or i < 1:
        return 0.0
    frac = lag - i
    return float((1 - frac) * acf[i] + frac * acf[i + 1])


def _beat_salience(acf: FloatArray, bpm: float) -> float:
    lag = 60.0 * FPS / bpm
    return _acf_at(acf, lag) + 0.5 * _acf_at(acf, 2 * lag) + 0.25 * _acf_at(acf, 4 * lag)


def _prior(bpm: float, centre: float) -> float:
    return float(np.exp(-0.5 * (np.log2(bpm / centre) / 0.9) ** 2))


def estimate_bpm(onset: FloatArray, settings: TempoSettings, genre: str | None = None) -> float:
    acf = _autocorrelation(onset)
    centre = 172.0 if genre and any(g in genre.lower() for g in FAST_GENRES) else 120.0
    bpms = np.arange(50.0, 240.0, 0.25)
    salience = np.array([_beat_salience(acf, b) for b in bpms])
    best = float(bpms[int(np.argmax(salience * np.array([_prior(b, centre) for b in bpms])))])
    # Octave choice inside the configured range.
    candidates = [best * f for f in (0.25, 0.5, 1.0, 2.0, 4.0)]
    in_range = [b for b in candidates if settings.min_bpm <= b <= settings.max_bpm]
    if not in_range:
        folded = best
        while folded < settings.min_bpm:
            folded *= 2
        while folded > settings.max_bpm:
            folded /= 2
        return folded
    return max(in_range, key=lambda b: max(_beat_salience(acf, b), 1e-6) * _prior(b, centre))


def track_beats(onset: FloatArray, bpm: float, tightness: float = 100.0) -> npt.NDArray[np.intp]:
    """Ellis (2007) dynamic-programming beat tracker; returns beat frame indices."""
    period = 60.0 * FPS / bpm
    sigma = period / 32.0
    t = np.arange(-int(4 * sigma), int(4 * sigma) + 1)
    local = np.convolve(onset / (onset.std() + 1e-12), np.exp(-0.5 * (t / sigma) ** 2), "same")
    back = np.arange(-round(2 * period), -round(period / 2))
    penalty = -tightness * np.log(-back / period) ** 2
    n = len(local)
    score = local.copy()
    link = np.full(n, -1, dtype=np.intp)
    for i in range(n):
        idx = i + back
        valid = idx >= 0
        if not valid.any():
            continue
        candidates = penalty[valid] + score[idx[valid]]
        j = int(np.argmax(candidates))
        score[i] = local[i] + candidates[j]
        link[i] = idx[valid][j]
    tail = max(1, int(2 * period))
    i = n - tail + int(np.argmax(score[-tail:]))
    beats = [i]
    while link[i] >= 0:
        i = int(link[i])
        beats.append(i)
    return np.asarray(beats[::-1], dtype=np.intp)


def _refine_peaks(onset: FloatArray, frames: npt.NDArray[np.intp], radius: int = 4) -> FloatArray:
    """Sub-frame beat times: parabolic peak of the onset envelope near each beat."""
    out = np.empty(len(frames))
    for k, f in enumerate(frames):
        lo, hi = max(1, f - radius), min(len(onset) - 1, f + radius + 1)
        p = lo + int(np.argmax(onset[lo:hi])) if hi > lo else f
        a, b, c = onset[p - 1], onset[p], onset[min(p + 1, len(onset) - 1)]
        denom = a - 2 * b + c
        out[k] = p + (0.5 * (a - c) / denom if abs(denom) > 1e-12 else 0.0)
    return out / FPS + onset_latency()


def _robust_fit(times: FloatArray) -> tuple[float, float]:
    """Least-squares grid fit t_i = t0 + i·period, ignoring outliers (3 MAD)."""
    idx = np.arange(len(times), dtype=np.float64)
    period, t0 = np.polyfit(idx, times, 1)
    for _ in range(2):
        resid = times - (t0 + idx * period)
        mad = np.median(np.abs(resid - np.median(resid))) + 1e-6
        keep = np.abs(resid) < 3 * 1.4826 * mad + 0.002
        if keep.sum() < 8:
            break
        period, t0 = np.polyfit(idx[keep], times[keep], 1)
    return float(period), float(t0)


def _value_near(env: FloatArray, t: float, radius: int = 5) -> float:
    i = _frame_of(t)
    lo, hi = max(0, i - radius), min(len(env), i + radius + 1)
    return float(env[lo:hi].max()) if hi > lo else 0.0


def _downbeat_phase(beats: FloatArray, onset: FloatArray, low_energy: FloatArray) -> int:
    bass = low_energy
    if len(beats) < 8:
        return 0
    # Low-band energy in the 150 ms after each beat: accented kick + bass on the "one".
    span = max(1, int(0.15 * FPS))
    b = np.array([bass[max(0, _frame_of(t)) : max(0, _frame_of(t)) + span].mean() for t in beats])
    o = np.array([_value_near(onset, t) for t in beats])
    b /= b.max() + 1e-12
    o /= o.max() + 1e-12
    score = np.array([b[p::4].mean() + 0.5 * o[p::4].mean() for p in range(4)])
    # Phrase validation: the biggest energy changes (new sections every 16/32 bars) should
    # land on bar starts. Novelty at beat i compares the bar starting at i with the bar
    # before it; the strongest changes vote, with a small total weight (a tie-breaker).
    novelty = np.array(
        [abs(o[i : i + 4].sum() - o[max(0, i - 4) : i].sum()) for i in range(4, len(o) - 4)]
    )
    if len(novelty):
        top = np.argsort(novelty)[-max(1, len(novelty) // 20) :] + 4
        for i in top:
            score[i % 4] += 0.2 / len(top)
    return int(np.argmax(score))


def detect_tempo(
    audio: npt.NDArray[np.floating],
    sr: int,
    settings: TempoSettings | None = None,
    genre: str | None = None,
) -> TempoResult | None:
    settings = settings or TempoSettings()
    onset, bass = onset_envelopes(audio, sr)
    if len(onset) < FPS * 4 or onset.max() <= 1e-9:
        return None
    bpm0 = estimate_bpm(onset, settings, genre)
    frames = track_beats(onset, bpm0)
    if len(frames) < 8:
        return None
    beats = _refine_peaks(onset, frames)

    # Local tempo over 32-beat windows to detect variable tempo.
    period, t0 = _robust_fit(beats)
    local = []
    for start in range(0, len(beats) - 16, 16):
        chunk = beats[start : start + 32]
        if len(chunk) >= 16:
            local.append(60.0 / _robust_fit(chunk)[0])
    global_bpm = 60.0 / period
    variable = bool(local) and max(abs(b - global_bpm) / global_bpm for b in local) > (
        VARIABLE_TOLERANCE
    )

    phase = _downbeat_phase(beats, onset, bass)
    if variable:
        bpm = float(np.median(local))
        first_downbeat = float(beats[phase])
        grid = BeatGrid(
            "variable", round(bpm, 3), round(first_downbeat, 4), beats.round(4).tolist()
        )
        downbeats = beats[phase::4]
        grid_beats = beats
    else:
        bpm = global_bpm
        # Extend the fitted grid over the whole track (before the first tracked beat too).
        k0 = int(np.ceil(-t0 / period)) if t0 < 0 else -int(t0 // period)
        n_total = int((len(audio) / sr - (t0 + k0 * period)) // period) + 1
        grid_beats = (t0 + period * np.arange(k0, k0 + n_total)).astype(np.float64)
        grid_beats = grid_beats[grid_beats >= 0]
        first_index = int(np.argmin(np.abs(grid_beats - beats[phase])))
        first_downbeat = float(grid_beats[first_index % 4])
        downbeats = grid_beats[first_index % 4 :: 4]
        grid = BeatGrid("constant", round(bpm, 3), round(first_downbeat, 4))

    on = np.array([_value_near(onset, t, 3) for t in grid_beats])
    off = np.array([_value_near(onset, t + 30.0 / bpm, 3) for t in grid_beats])
    contrast = on.mean() / (on.mean() + off.mean() + 1e-12)
    confidence = float(np.clip((contrast - 0.5) * 2.5, 0.0, 1.0))
    return TempoResult(
        bpm=round(bpm, 3),
        confidence=round(confidence, 4),
        grid=grid,
        beats=grid_beats.round(4).tolist(),
        downbeats=np.asarray(downbeats).round(4).tolist(),
    )
