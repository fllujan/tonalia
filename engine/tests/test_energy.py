import numpy as np
import pytest

from tests.fixtures.energy import arrangement, section
from tests.fixtures.music import SR
from tonalia_engine.analysis.energy import (
    DESCRIPTORS,
    EnergyModel,
    block_bounds,
    detect_energy,
)
from tonalia_engine.analysis.tempo import BeatGrid

BPM = 124.0
BAR = 4 * 60.0 / BPM
PHRASE = 8 * BAR  # one energy block


def grid(first_downbeat: float = 0.0) -> BeatGrid:
    return BeatGrid("constant", BPM, first_downbeat)


def test_blocks_follow_eight_bar_phrases_of_the_grid() -> None:
    bounds = block_bounds(60.0, grid(0.5))
    starts = [round(s, 3) for s, _ in bounds]
    assert starts[:3] == [0.0, 0.5, round(0.5 + PHRASE, 3)]
    assert bounds[-1][1] == pytest.approx(60.0)
    assert all(b - a > 0 for a, b in bounds)
    # Without a beatgrid: fixed blocks of about the same length.
    plain = block_bounds(60.0, None)
    assert len(plain) == 4 and plain[-1][1] == pytest.approx(60.0)


def test_variable_grid_uses_its_beats() -> None:
    beats = list(np.cumsum(np.full(80, 0.5)) - 0.5)  # 120 BPM, first beat at 0
    g = BeatGrid("variable", 120.0, 0.0, beats)
    bounds = block_bounds(40.0, g)
    assert [round(s, 3) for s, _ in bounds[:2]] == [0.0, 16.0]


def test_energy_follows_intensity() -> None:
    audio = arrangement([0.1, 0.5, 1.0], PHRASE)
    result = detect_energy(audio, SR, grid())
    assert result is not None
    levels = [b.level for b in result.curve]
    assert len(levels) == 3
    assert levels[0] < levels[1] < levels[2]
    assert levels[0] <= 3.5
    assert levels[2] >= 7.5
    assert all(1.0 <= lv <= 10.0 for lv in levels)
    assert isinstance(result.energy, int) and 1 <= result.energy <= 10


def test_track_energy_reflects_the_main_parts_not_the_intro() -> None:
    audio = arrangement([0.1, 1.0, 1.0, 1.0], PHRASE)
    result = detect_energy(audio, SR, grid())
    assert result is not None
    loud = detect_energy(section(1.0, 3 * PHRASE), SR, grid())
    assert loud is not None
    assert abs(result.energy - loud.energy) <= 1
    assert result.energy >= 7


def test_quiet_track_is_low_energy() -> None:
    result = detect_energy(section(0.0, 2 * PHRASE), SR, grid())
    assert result is not None and result.energy <= 3


def test_silence_has_no_energy() -> None:
    assert detect_energy(np.zeros(SR * 20, dtype=np.float32), SR, grid()) is None


def test_model_maps_scores_through_a_monotonic_sigmoid() -> None:
    model = EnergyModel.load()
    assert set(model.weights) == set(DESCRIPTORS)
    low = np.zeros((1, len(DESCRIPTORS)))
    high = np.ones((1, len(DESCRIPTORS)))
    raw_low = model.ref[:, 0][None, :]
    raw_high = model.ref[:, 1][None, :]
    assert model.levels(raw_low)[0] < model.levels(raw_high)[0]
    assert model.levels(model.ref.mean(axis=1)[None, :])[0] == pytest.approx(
        model.levels_from_normalized(0.5 * (low + high))[0]
    )
    levels = model.levels(np.vstack([raw_low, raw_high]))
    assert np.all((levels >= 1.0) & (levels <= 10.0))
