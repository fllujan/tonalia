import numpy as np

from tonalia_engine.analysis.energy import DESCRIPTORS
from tools.calibrate_energy import calibrate, predict, reference_ranges, ridge


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
    fit = calibrate(x, y)
    assert fit["cv_mae"] <= 0.6  # SPEC 2.5 target is MAE <= 1.0
    assert fit["alpha"] in (0.01, 0.1, 1.0, 10.0)
