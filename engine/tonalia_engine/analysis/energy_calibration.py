"""Fit the energy weights and sigmoid to a user's ratings (SPEC 2.5, 12.2).

Ridge regression with 5-fold cross-validation on the logit of the target level, using the
mean normalized descriptors of the most energetic half of each track's blocks (what the
track level averages). Used by ``energy.calibrate`` and by ``tools/calibrate_energy.py``.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import numpy.typing as npt

from .energy import DESCRIPTORS, EnergyModel, track_energy

FloatArray = npt.NDArray[np.float64]
RIDGE_ALPHAS = (0.01, 0.1, 1.0, 10.0)
LEVEL_EPS = 0.02  # targets are squeezed into (eps, 1 - eps) before the logit
FOLDS = 5


def track_features(blocks: FloatArray, model: EnergyModel) -> FloatArray:
    """Mean normalized descriptors of the most energetic half of the blocks."""
    x = model.normalize(blocks)
    levels = model.levels_from_normalized(x)
    top = np.argsort(levels)[::-1][: max(1, int(np.ceil(len(levels) / 2)))]
    out: FloatArray = x[top].mean(axis=0)
    return out


def _logit(levels: FloatArray) -> FloatArray:
    p = np.clip((levels - 1.0) / 9.0, LEVEL_EPS, 1 - LEVEL_EPS)
    out: FloatArray = np.log(p / (1 - p))
    return out


def ridge(x: FloatArray, y: FloatArray, alpha: float) -> tuple[FloatArray, float]:
    """Ridge regression with an unpenalized intercept; returns (weights, intercept)."""
    mx, my = x.mean(axis=0), y.mean()
    xc = x - mx
    w = np.linalg.solve(xc.T @ xc + alpha * np.eye(x.shape[1]), xc.T @ (y - my))
    return w, float(my - mx @ w)


def predict(x: FloatArray, w: FloatArray, b: float) -> FloatArray:
    out: FloatArray = 1.0 + 9.0 / (1.0 + np.exp(-(x @ w + b)))
    return out


def cross_validate(x: FloatArray, y: FloatArray, alpha: float, folds: int = FOLDS) -> float:
    """MAE of the rounded levels on held-out tracks."""
    order = np.random.default_rng(0).permutation(len(y))
    errors: list[float] = []
    for f in range(min(folds, len(y))):
        val = order[f::folds]
        train = np.setdiff1d(order, val)
        w, b = ridge(x[train], _logit(y[train]), alpha)
        errors.extend(np.abs(np.clip(np.round(predict(x[val], w, b)), 1, 10) - y[val]))
    return float(np.mean(errors))


@dataclass(frozen=True)
class Calibration:
    tracks: int
    mae_before: float  # the default model on the rated tracks
    mae_after: float  # the calibrated model, cross-validated (tracks it was not fitted on)
    alpha: float
    weights: dict[str, float]
    bias: float

    def params(self) -> dict[str, object]:
        """What ``EnergyModel.with_params`` reads (sigmoid folded into the weights)."""
        return {
            "weights": self.weights,
            "bias": self.bias,
            "sigmoid": {"center": 0.0, "slope": 1.0},
        }


def calibrate(
    blocks: list[FloatArray], ratings: FloatArray, model: EnergyModel | None = None
) -> Calibration:
    """Fit weights and sigmoid to ``ratings`` (1-10) of tracks with these block descriptors."""
    model = model or EnergyModel.load()
    x = np.stack([track_features(b, model) for b in blocks])
    y = np.asarray(ratings, dtype=np.float64)
    before = float(
        np.mean([abs(track_energy(model.levels(b)) - r) for b, r in zip(blocks, y, strict=True)])
    )
    scores = {alpha: cross_validate(x, y, alpha) for alpha in RIDGE_ALPHAS}
    alpha = min(scores, key=lambda a: scores[a])
    w, b = ridge(x, _logit(y), alpha)
    return Calibration(
        tracks=len(y),
        mae_before=round(before, 3),
        mae_after=round(scores[alpha], 3),
        alpha=alpha,
        weights={name: round(float(v), 5) for name, v in zip(DESCRIPTORS, w, strict=True)},
        bias=round(b, 5),
    )
