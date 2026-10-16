"""Tempo, beatgrid and downbeats (SPEC 2.4) — numpy/scipy implementation.

1. Onset strength: half-wave rectified spectral flux of the log spectrum (~172 frames/s),
   plus the linear sub-150 Hz energy used to find downbeats.
2. Tempo: autocorrelation of the onset envelope at the beat lag reinforced by the
   half-beat, 2-beat, 1-bar and 2-bar lags (which separates the beat from its 4/3 and
   2/3 neighbours),
   searched inside the configured range with a log-normal prior centred on the genre's
   typical tempo (125 BPM when the genre is unknown).
3. Grid: a comb over the whole onset envelope refines the BPM (to 0.01 %) and the phase,
   so the grid stays locked to the kick for the full track.
4. Variable tempo: the same comb runs on each third of the track; if the sections differ
   by more than 1 %, the beats of a dynamic-programming beat tracker (Ellis 2007) are
   stored instead of a fixed grid.
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
SECTIONS = 3
MIN_SECTION_SECONDS = 20.0
DEFAULT_TEMPO = 125.0
PRIOR_WIDTH = 0.9  # octaves (standard deviation of the log-normal prior)
# (lag multiple in beats, weight) of the tempo salience.
SALIENCE_LAGS = ((0.5, 0.5), (1.0, 1.0), (2.0, 0.25), (4.0, 1.0), (8.0, 1.0))
# Typical tempo per genre, matched by substring in order (first match wins), so the
# octave choice follows the genre (SPEC 2.4): drum & bass sits at 160-180, house ~124.
GENRE_TEMPOS: tuple[tuple[tuple[str, ...], float], ...] = (
    (("drum", "dnb", "d&b", "jungle", "neurofunk", "liquid"), 174.0),
    (("dubstep", "riddim"), 140.0),
    (("psy",), 142.0),
    (("hardcore", "hard techno", "hard-techno", "hardstyle", "hard dance", "hard-dance"), 150.0),
    (("trance",), 138.0),
    (("house", "minimal", "garage"), 124.0),
    (("techno",), 130.0),
    (("breaks", "breakbeat"), 130.0),
    (("hip-hop", "hip hop", "rap", "trap", "reggaeton"), 95.0),
    (("glitch", "chill", "downtempo", "ambient", "lounge"), 100.0),
    (("disco",), 118.0),
)

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
    # Grids drawn in the editor with tempo anchors (SPEC 12.4): [beat, time] pins, beat 0
    # being the first downbeat; the beats above are interpolated between them.
    anchors: list[list[float]] | None = None


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
    return sum(w * _acf_at(acf, k * lag) for k, w in SALIENCE_LAGS)


def prior_centre(genre: str | None) -> float:
    """Typical tempo of ``genre`` (free text from tags), or the default."""
    text = (genre or "").lower()
    for keywords, bpm in GENRE_TEMPOS:
        if any(k in text for k in keywords):
            return bpm
    return DEFAULT_TEMPO


def _prior(bpm: float, centre: float) -> float:
    return float(np.exp(-0.5 * (np.log2(bpm / centre) / PRIOR_WIDTH) ** 2))


def estimate_bpm(onset: FloatArray, settings: TempoSettings, genre: str | None = None) -> float:
    acf = _autocorrelation(onset)
    centre = prior_centre(genre)
    bpms = np.arange(settings.min_bpm, settings.max_bpm + 1e-9, 0.25)
    score = [max(_beat_salience(acf, b), 0.0) * _prior(b, centre) for b in bpms]
    return float(bpms[int(np.argmax(score))])


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


def _smooth(onset: FloatArray) -> FloatArray:
    t = np.arange(-6, 7)
    out: FloatArray = np.convolve(onset, np.exp(-0.5 * (t / 2.0) ** 2), "same")
    return out


def _comb_scan(env: FloatArray, bpms: FloatArray, phase_step: float) -> tuple[float, float]:
    """(bpm, phase in frames) whose grid collects the most onset energy on average."""
    idx = np.arange(len(env), dtype=np.float64)
    best_score, best_bpm, best_phase = -1.0, float(bpms[len(bpms) // 2]), 0.0
    for bpm in bpms:
        period = 60.0 * FPS / bpm
        n = int((len(env) - period) / period)
        if n < 4:
            continue
        phases = np.arange(0.0, period, phase_step)
        positions = phases[:, None] + np.arange(n)[None, :] * period
        score = np.interp(positions, idx, env).mean(axis=1)
        j = int(np.argmax(score))
        if score[j] > best_score:
            best_score, best_bpm, best_phase = float(score[j]), float(bpm), float(phases[j])
    return best_bpm, best_phase


def comb_refine(env: FloatArray, bpm: float, span: float) -> tuple[float, float]:
    """Refine ``bpm`` within ±span (coarse 0.1 % steps, then 0.01 %); returns (bpm, phase)."""
    coarse, _ = _comb_scan(env, bpm * (1 + np.arange(-span, span + 1e-9, 0.001)), 2.0)
    return _comb_scan(env, coarse * (1 + np.arange(-0.0015, 0.0015 + 1e-9, 0.0001)), 0.5)


def section_tempos(env: FloatArray, bpm: float) -> list[float]:
    """Comb-refined tempo of each third of the track (empty when it is too short)."""
    n = len(env)
    if n / FPS < SECTIONS * MIN_SECTION_SECONDS:
        return []
    return [
        comb_refine(env[i * n // SECTIONS : (i + 1) * n // SECTIONS], bpm, 0.06)[0]
        for i in range(SECTIONS)
    ]


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
    env = _smooth(onset)
    bpm, phase = comb_refine(env, bpm0, 0.03)
    sections = section_tempos(env, bpm)
    variable = bool(sections) and (max(sections) - min(sections)) / bpm > VARIABLE_TOLERANCE

    if variable:
        frames = track_beats(onset, bpm)
        if len(frames) < 8:
            return None
        grid_beats = _refine_peaks(onset, frames)
        local = [
            60.0 / _robust_fit(grid_beats[i : i + 32])[0]
            for i in range(0, len(grid_beats) - 16, 16)
            if len(grid_beats[i : i + 32]) >= 16
        ]
        bpm = float(np.median(local)) if local else bpm
        phase_index = _downbeat_phase(grid_beats, onset, bass)
        downbeats = grid_beats[phase_index::4]
        grid = BeatGrid(
            "variable",
            round(bpm, 3),
            round(float(grid_beats[phase_index]), 4),
            grid_beats.round(4).tolist(),
        )
    else:
        # Extend the comb grid over the whole track.
        period = 60.0 / bpm
        t0 = phase / FPS + onset_latency()
        t0 -= period * np.floor(t0 / period)
        grid_beats = (t0 + period * np.arange(int((len(audio) / sr - t0) / period) + 1)).astype(
            np.float64
        )
        if len(grid_beats) < 8:
            return None
        phase_index = _downbeat_phase(grid_beats, onset, bass)
        downbeats = grid_beats[phase_index::4]
        grid = BeatGrid("constant", round(bpm, 3), round(float(grid_beats[phase_index]), 4))

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
