"""Synthetic rhythm fixtures with a known beatgrid (SPEC §5: clicks at a known BPM).

A four-on-the-floor pattern: kick on every beat, snare on 2 and 4, hats on the
off-beats, and on every bar's first beat a louder kick plus a sub-bass note — the cue
used to find downbeats. ``first_beat`` shifts the grid in time and ``downbeat_beat``
says which beat (0-3) of the audio starts a bar.
"""

from __future__ import annotations

import numpy as np
import numpy.typing as npt

SR = 44100
F32 = npt.NDArray[np.float32]


def _kick(sr: int, gain: float) -> F32:
    t = np.arange(int(0.18 * sr)) / sr
    freq = 45 + 90 * np.exp(-t * 30)
    phase = 2 * np.pi * np.cumsum(freq) / sr
    out: F32 = (gain * np.sin(phase) * np.exp(-t * 14)).astype(np.float32)
    return out


def _noise(sr: int, seconds: float, decay: float, gain: float, seed: int) -> F32:
    rng = np.random.default_rng(seed)
    n = int(seconds * sr)
    out: F32 = (gain * rng.standard_normal(n) * np.exp(-np.arange(n) / (decay * sr))).astype(
        np.float32
    )
    return out


def _bass(sr: int, seconds: float) -> F32:
    t = np.arange(int(seconds * sr)) / sr
    out: F32 = (0.5 * np.sin(2 * np.pi * 55 * t) * np.exp(-t * 3)).astype(np.float32)
    return out


def _add(buf: F32, sound: F32, at: float, sr: int) -> None:
    start = round(at * sr)
    if 0 <= start < len(buf):
        end = min(len(buf), start + len(sound))
        buf[start:end] += sound[: end - start]


def click_track(
    bpm: float,
    seconds: float,
    *,
    first_beat: float = 0.0,
    downbeat_beat: int = 0,
    sr: int = SR,
) -> F32:
    beat = 60.0 / bpm
    buf = np.zeros(int(seconds * sr), dtype=np.float32)
    kick, accent = _kick(sr, 0.6), _kick(sr, 0.9)
    snare = _noise(sr, 0.12, 0.03, 0.35, seed=1)
    hat = _noise(sr, 0.04, 0.008, 0.12, seed=2)
    bass = _bass(sr, beat * 0.9)
    i = 0
    while first_beat + i * beat < seconds:
        t = first_beat + i * beat
        position = (i - downbeat_beat) % 4
        if position == 0:
            _add(buf, accent, t, sr)
            _add(buf, bass, t, sr)
        else:
            _add(buf, kick, t, sr)
        if position in (1, 3):
            _add(buf, snare, t, sr)
        _add(buf, hat, t + beat / 2, sr)
        i += 1
    peak = float(np.max(np.abs(buf))) or 1.0
    out: F32 = (0.8 * buf / peak).astype(np.float32)
    return out


def tempo_change_track(bpm_a: float, bpm_b: float, seconds_each: float, sr: int = SR) -> F32:
    a = click_track(bpm_a, seconds_each, sr=sr)
    b = click_track(bpm_b, seconds_each, sr=sr)
    return np.concatenate([a, b]).astype(np.float32)
