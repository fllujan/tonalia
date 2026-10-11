"""Train the learned key profiles (``analysis/key_model.json``, SPEC 2.2).

Trains on GiantSteps-MTG-Key (manual keys with confidence 2), which is disjoint from
GiantSteps Key, so ``tools.eval_key --giantsteps`` stays an untouched test set. The
model is linear and transposition-invariant (2 modes x 7 channels x 12 bins); it is
fitted by multinomial logistic regression (softmax over the 24 keys, L2, Adam) with a
fixed seed, so the result is reproducible.

    uv run python -m tools.fetch_datasets mtg-key
    uv run python -m tools.train_key            # 5-fold CV report + writes the model
    uv run python -m tools.train_key --cv-only
"""

from __future__ import annotations

import argparse
import json
import sys
from importlib import resources
from pathlib import Path

import numpy as np

from tonalia_engine.analysis.key import (
    ALL_KEYS,
    KeyModel,
    KeyWeights,
    frame_features,
    pool_features,
    tonal_frames,
)
from tonalia_engine.audio_io import ANALYSIS_SAMPLE_RATE, DecodeError, decode
from tonalia_engine.keys import Key

from .evaluation import MIREX_WEIGHTS, ROOT, mirex_category, parse_reference_key, run_parallel

MTG = ROOT / "datasets" / "giantsteps-mtg-key"
L2 = 1e-3
ITERATIONS = 800
LEARNING_RATE = 0.02


def training_refs() -> list[tuple[Path, Key]]:
    rows = []
    table = MTG / "annotations" / "annotations.txt"
    for line in table.read_text(encoding="utf-8").splitlines()[1:]:
        parts = line.split("\t")
        if len(parts) < 3 or parts[2].strip() != "2":
            continue
        key, audio = parse_reference_key(parts[1]), MTG / "audio" / f"{parts[0]}.LOFI.mp3"
        if key is not None and audio.exists():
            rows.append((audio, key))
    return rows


def track_features(path: Path) -> list[list[float]] | None:
    try:
        audio = decode(path)
    except DecodeError:
        return None
    tf = tonal_frames(audio, ANALYSIS_SAMPLE_RATE, KeyWeights.load().min_harmonic_ratio)
    if tf is None:
        return None
    frames = frame_features(tf.harmonic, tf.freqs, tf.tuning_hz)
    features: list[list[float]] = pool_features(frames, tf.loud).tolist()
    return features


def fit(features: np.ndarray, labels: np.ndarray, seed: int = 0) -> KeyModel:
    """Softmax regression on rotated features; returns the fitted model."""
    rotated = KeyModel.rotate(features)  # (n, 12, d)
    n, _, d = rotated.shape
    rng = np.random.default_rng(seed)
    w = rng.normal(0.0, 1e-3, (d, 2))
    b = np.zeros(2)
    target = np.zeros((n, 24))
    target[np.arange(n), labels] = 1.0
    state = {name: (np.zeros_like(v), np.zeros_like(v)) for name, v in (("w", w), ("b", b))}
    for t in range(1, ITERATIONS + 1):
        s = rotated @ w + b  # (n, 12, 2)
        z = np.swapaxes(s, 1, 2).reshape(n, 24)
        z -= z.max(axis=1, keepdims=True)
        p = np.exp(z)
        p /= p.sum(axis=1, keepdims=True)
        g = np.swapaxes(((p - target) / n).reshape(n, 2, 12), 1, 2)  # (n, 12, 2)
        grads = {"w": np.einsum("nrd,nrm->dm", rotated, g) + L2 * w, "b": g.sum(axis=(0, 1))}
        for name, param in (("w", w), ("b", b)):
            m, v = state[name]
            m[...] = 0.9 * m + 0.1 * grads[name]
            v[...] = 0.999 * v + 0.001 * grads[name] ** 2
            param -= LEARNING_RATE * (m / (1 - 0.9**t)) / (np.sqrt(v / (1 - 0.999**t)) + 1e-8)
    return KeyModel(w.T.reshape(2, -1, 12).copy(), b.copy())


def mirex(model: KeyModel, features: np.ndarray, keys: list[Key]) -> float:
    pred = model.logits(features).argmax(axis=1)
    hits = [MIREX_WEIGHTS[mirex_category(ALL_KEYS[i], k)] for i, k in zip(pred, keys, strict=True)]
    return float(np.mean(hits))


def cross_validate(features: np.ndarray, keys: list[Key], folds: int = 5) -> float:
    labels = np.array([ALL_KEYS.index(k) for k in keys])
    order = np.random.default_rng(1).permutation(len(keys))
    scores = []
    for f in range(folds):
        val = order[f::folds]
        train = np.setdiff1d(order, val)
        model = fit(features[train], labels[train])
        scores.append(mirex(model, features[val], [keys[i] for i in val]))
    return float(np.mean(scores))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--cv-only", action="store_true")
    parser.add_argument("--workers", type=int, default=0)
    args = parser.parse_args()
    refs = training_refs()
    if not refs:
        sys.exit("GiantSteps-MTG-Key not found: run `python -m tools.fetch_datasets mtg-key`")
    feats = run_parallel(track_features, [p for p, _ in refs], args.workers or None)
    pairs = [(np.asarray(f), k) for f, (_, k) in zip(feats, refs, strict=True) if f is not None]
    features = np.stack([f for f, _ in pairs])
    keys = [k for _, k in pairs]
    cv = cross_validate(features, keys)
    print(f"{len(keys)} tracks · 5-fold CV MIREX {cv:.3f}")
    if args.cv_only:
        return
    labels = np.array([ALL_KEYS.index(k) for k in keys])
    model = fit(features, labels)
    out = Path(str(resources.files("tonalia_engine.analysis").joinpath("key_model.json")))
    payload = {
        "_comment": "Learned key profiles; regenerate with `uv run python -m tools.train_key`.",
        "trained_on": "GiantSteps-MTG-Key (confidence 2)",
        "tracks": len(keys),
        "cv_mirex": round(cv, 4),
        "weights": np.round(model.weights, 6).tolist(),
        "bias": np.round(model.bias, 6).tolist(),
    }
    out.write_text(json.dumps(payload) + "\n", encoding="utf-8")
    print(f"model written to {out}")


if __name__ == "__main__":
    main()
