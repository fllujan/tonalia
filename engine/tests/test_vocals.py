"""Vocal presence (SPEC 2.16): measured from stems, estimated from the mix before."""

from __future__ import annotations

from importlib import resources

import numpy as np
import pytest
import torch

from tonalia_engine.analysis.structure import Segment
from tonalia_engine.analysis.vocals import (
    N_FEATURES,
    VOCAL_SR,
    VocalModel,
    estimate_presence,
    frame_features,
    frame_voice_share,
    heuristic_presence,
    main_sections,
    measured_presence,
    pooled_presence,
    voice_band_feature,
)
from tools.train_vocals import _export, _net

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
    voice = np.zeros_like(phase)
    for k in range(1, 14):
        voice += np.sin(k * phase) / k
    return voice * 0.2


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
        <= heuristic_presence(beat, SR, sections)
        < heuristic_presence(voice + beat, SR, sections)
        <= 1.0
    )
    assert heuristic_presence(np.zeros(SR), SR, sections) == 0.0


def test_frame_features_ignore_the_gain() -> None:
    audio = harmonic_voice(4) + kick_and_bass(4)
    features, power = frame_features(audio, SR)
    louder, louder_power = frame_features(audio * 4.0, SR)
    assert features.shape == (len(power), N_FEATURES)
    np.testing.assert_allclose(features, louder, atol=1e-6)
    np.testing.assert_allclose(louder_power, power * 16.0, rtol=1e-6)


def test_pooled_shares_reproduce_the_measurement() -> None:
    voice, beat = harmonic_voice(6), kick_and_bass(6)
    mix = voice + beat
    _, power = frame_features(mix, SR)
    share = frame_voice_share(voice, mix, SR)[: len(power)]
    keep = np.ones(len(power), dtype=bool)
    # Voice and beat are not correlated, so frame powers add up: same value either way.
    assert pooled_presence(share, power, keep) == pytest.approx(
        measured_presence(voice, mix, SR, [(0.0, 6.0)]), abs=0.03
    )


def _toy_model(bias: float) -> VocalModel:
    """A network whose output is the bias alone: every frame gets the same share."""
    arrays = _export(_net())
    arrays["head_w"] = np.zeros_like(arrays["head_w"])
    arrays["head_b"] = np.asarray(bias, dtype=np.float32)
    arrays["instrumental"] = np.asarray(0.1)
    arrays["acapella"] = np.asarray(0.9)
    return VocalModel.from_arrays(arrays)


def test_numpy_inference_matches_pytorch() -> None:
    torch.manual_seed(2)
    net = _net()
    for m in net.modules():  # non-trivial batch-norm statistics to fold
        if isinstance(m, torch.nn.BatchNorm2d):
            m.running_mean.uniform_(-0.5, 0.5)
            m.running_var.uniform_(0.5, 2.0)
            m.weight.data.uniform_(0.5, 1.5)
    net.eval()
    x = np.random.default_rng(0).normal(size=(50, N_FEATURES)).astype(np.float32)
    with torch.no_grad():
        expected = torch.sigmoid(net(torch.from_numpy(x)[None, None])[0, 0, :, 0]).numpy()
    model = VocalModel.from_arrays(_export(net))
    np.testing.assert_allclose(model.frame_shares(x), expected, rtol=1e-4, atol=1e-5)


def test_shipped_weights_are_small_and_load() -> None:
    path = resources.files("tonalia_engine.analysis").joinpath("vocals_model.npz")
    assert path.is_file()
    assert len(path.read_bytes()) < 1024 * 1024  # SPEC 12.3: < 1 MB
    assert VocalModel.load() is not None


def test_the_model_pools_its_frame_shares_and_names_the_kind() -> None:
    audio = harmonic_voice(4) + kick_and_bass(4)
    # A constant share s per frame pools to sqrt(s).
    half = _toy_model(0.0).presence(audio, SR, [(0.0, 4.0)])
    assert half == pytest.approx(np.sqrt(0.5), abs=1e-6)
    value, source = estimate_presence(audio, SR, [(0.0, 4.0)], model=_toy_model(-6.0))
    assert source == "model" and value < 0.1
    model = _toy_model(0.0)
    assert model.kind(0.05) == "instrumental"
    assert model.kind(0.5) == "vocal"
    assert model.kind(0.95) == "acapella"
    assert VOCAL_SR == 11025
