"""Vocal presence (SPEC 2.16): measured from stems, estimated from the mix before."""

from __future__ import annotations

import numpy as np
import pytest

from tonalia_engine.analysis.structure import Segment
from tonalia_engine.analysis.vocals import (
    estimate_presence,
    main_sections,
    measured_presence,
    voice_band_feature,
)

SR = 44100


def test_main_sections_skip_intro_and_outro() -> None:
    segs = [
        Segment(0, 30, "intro"),
        Segment(30, 90, "drop"),
        Segment(90, 120, "breakdown"),
        Segment(120, 150, "outro"),
    ]
    assert main_sections(segs, 150) == [(30, 90), (90, 120)]
    assert main_sections([Segment(0, 10, "intro"), Segment(10, 20, "outro")], 20) == [(0, 20)]
    assert main_sections([], 100) == pytest.approx([(10, 90)])


def test_measured_presence_is_the_rms_ratio_in_the_main_sections() -> None:
    n = 10 * SR
    rng = np.random.default_rng(1)
    vocals = np.zeros(n)
    vocals[2 * SR : 8 * SR] = rng.normal(0, 0.1, 6 * SR)  # voice only in the middle
    music = rng.normal(0, 0.1, n)
    mix = vocals + music
    middle = measured_presence(vocals, mix, SR, [(2, 8)])
    assert middle == pytest.approx(np.sqrt(0.5), abs=0.02)
    # Over the whole track the instrumental ends dilute the voice.
    assert measured_presence(vocals, mix, SR, [(0, 10)]) < middle
    stereo = np.stack([vocals, vocals], axis=1)
    assert measured_presence(stereo, np.stack([mix, mix], axis=1), SR, [(2, 8)]) == middle
    assert measured_presence(vocals, np.zeros(n), SR, [(0, 10)]) == 0.0
    assert measured_presence(mix, mix, SR, [(0, 10)]) == 1.0


def harmonic_voice(seconds: float) -> np.ndarray:
    """A sung-like tone: 220 Hz with harmonics up to 3 kHz and vibrato."""
    t = np.arange(int(seconds * SR)) / SR
    f0 = 220 * (1 + 0.01 * np.sin(2 * np.pi * 5 * t))
    phase = 2 * np.pi * np.cumsum(f0) / SR
    return sum(np.sin(k * phase) / k for k in range(1, 14)) * 0.2


def kick_and_bass(seconds: float) -> np.ndarray:
    t = np.arange(int(seconds * SR)) / SR
    bass = 0.4 * np.sin(2 * np.pi * 55 * t)
    kick = np.zeros_like(t)
    for start in np.arange(0, seconds, 0.5):
        i = int(start * SR)
        seg = t[: int(0.15 * SR)]
        kick[i : i + seg.size] += np.sin(2 * np.pi * 60 * seg) * np.exp(-seg / 0.04)
    return bass + kick


def test_the_estimate_follows_the_voice_band() -> None:
    voice, beat = harmonic_voice(8), kick_and_bass(8)
    sections = [(0.0, 8.0)]
    with_voice = voice_band_feature(voice + beat, SR, sections)
    without = voice_band_feature(beat, SR, sections)
    assert with_voice > 3 * without
    assert (
        0.0
        <= estimate_presence(beat, SR, sections)
        < estimate_presence(voice + beat, SR, sections)
        <= 1.0
    )
    assert estimate_presence(np.zeros(SR), SR, sections) == 0.0
