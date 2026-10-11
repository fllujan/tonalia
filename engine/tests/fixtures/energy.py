"""Synthetic sections of controlled intensity for energy tests (no copyrighted audio)."""

from __future__ import annotations

import numpy as np
import numpy.typing as npt
import pyloudnorm

from tests.fixtures.music import SR, progression
from tests.fixtures.rhythm import click_track
from tonalia_engine.keys import Key

F32 = npt.NDArray[np.float32]


def _hats(bpm: float, seconds: float, per_beat: int, sr: int = SR, seed: int = 5) -> F32:
    rng = np.random.default_rng(seed)
    out = np.zeros(int(seconds * sr), dtype=np.float32)
    hit_len = int(0.03 * sr)
    hit = (rng.standard_normal(hit_len) * np.exp(-np.arange(hit_len) / (0.006 * sr))).astype(
        np.float32
    )
    # High-passed noise: a hat, not a snare.
    hit = np.diff(hit, prepend=0.0).astype(np.float32)
    step = 60.0 / bpm / per_beat
    t = 0.0
    while t < seconds:
        i = int(t * sr)
        n = min(hit_len, len(out) - i)
        out[i : i + n] += hit[:n]
        t += step
    return out


def section(level: float, seconds: float, bpm: float = 124.0, seed: int = 0) -> F32:
    """``level`` 0 = soft pad alone … 1 = loud kick, bass and 16th hats over the pad."""
    pad = progression(Key(9, "minor"), seconds)
    mix = 0.25 * pad
    if level > 0.2:
        mix = mix + (level**1.5) * click_track(bpm, seconds)[: len(pad)]
    if level > 0.5:
        per_beat = 4 if level > 0.8 else 2
        mix = mix + 0.6 * level * _hats(bpm, seconds, per_beat, seed=seed)[: len(pad)]
    # Realistic loudness: about -20 LUFS (soft pad) to -7 LUFS (club-level full mix).
    target = -20.0 + 13.0 * level
    measured = pyloudnorm.Meter(SR).integrated_loudness(mix.astype(np.float64))
    out: F32 = np.clip(mix * 10 ** ((target - measured) / 20), -1.0, 1.0).astype(np.float32)
    return out


def arrangement(levels: list[float], seconds_each: float, bpm: float = 124.0) -> F32:
    return np.concatenate([section(lv, seconds_each, bpm, seed=i) for i, lv in enumerate(levels)])
