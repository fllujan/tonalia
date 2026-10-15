import numpy as np

from tonalia_engine.analysis.energy import DESCRIPTORS, EnergyModel, track_energy
from tonalia_engine.analysis.energy_calibration import calibrate, predict, ridge
from tools.calibrate_energy import reference_ranges


def test_reference_ranges_are_robust_percentiles() -> None:
    rng = np.random.default_rng(0)
    blocks = rng.uniform(0, 100, size=(2000, len(DESCRIPTORS)))
    blocks[0] = 1e6  # an outlier must not stretch the range
    ranges = reference_ranges(blocks)
    assert set(ranges) == set(DESCRIPTORS)
    lo, hi = ranges["loudness"]
    assert 3 < lo < 7 and 93 < hi < 97


def test_ridge_recovers_a_known_mapping() -> None:
    rng = np.random.default_rng(1)
    x = rng.uniform(0, 1, size=(300, len(DESCRIPTORS)))
    w_true = np.array([3.0, 1.0, 0.5, 1.5, -0.5, 1.0])
    y = np.clip(np.round(predict(x, w_true, -3.0)), 1, 10)
    w, _ = ridge(x, np.log((y - 0.9) / (10.1 - y)), 0.01)
    assert np.corrcoef(w, w_true)[0, 1] > 0.95


def _synthetic_library(n: int, seed: int) -> tuple[list[np.ndarray], np.ndarray, EnergyModel]:
    """Tracks of raw block descriptors and the ratings of a listener whose sense of energy
    differs from the default model (onset density matters more, low end less)."""
    model = EnergyModel.load()
    rng = np.random.default_rng(seed)
    lo, hi = model.ref[:, 0], model.ref[:, 1]
    listener = model.with_params(
        {
            "weights": dict(zip(DESCRIPTORS, [1.5, 3.0, 0.5, 1.0, -1.0, 0.5], strict=True)),
            "bias": -2.5,
            "sigmoid": {"center": 0.0, "slope": 1.0},
        }
    )
    blocks, ratings = [], []
    for _ in range(n):
        centre = rng.uniform(0.1, 0.9, size=len(DESCRIPTORS))
        x = np.clip(centre + rng.normal(0, 0.08, size=(12, len(DESCRIPTORS))), 0, 1)
        raw = lo + x * (hi - lo)
        blocks.append(raw)
        noisy = track_energy(listener.levels(raw)) + rng.choice([-1, 0, 0, 0, 1])
        ratings.append(float(np.clip(noisy, 1, 10)))
    return blocks, np.array(ratings), model


def test_calibration_learns_a_listener_from_30_ratings() -> None:
    blocks, ratings, model = _synthetic_library(30, seed=2)
    fit = calibrate(blocks, ratings, model)
    assert fit.tracks == 30
    assert fit.mae_after <= 1.0  # SPEC 12.2 target, on tracks it was not fitted on
    assert fit.mae_after < fit.mae_before
    assert fit.alpha in (0.01, 0.1, 1.0, 10.0)
    # The fitted weights generalize to tracks the listener rated afterwards.
    more, more_ratings, _ = _synthetic_library(200, seed=3)
    personal = model.with_params(fit.params())
    mae = np.mean(
        [abs(track_energy(personal.levels(b)) - r) for b, r in zip(more, more_ratings, strict=True)]
    )
    assert mae <= 1.0


def test_with_params_ignores_missing_or_broken_calibrations() -> None:
    model = EnergyModel.load()
    assert model.with_params(None) is model
    assert model.with_params({"weights": "x"}) is model
