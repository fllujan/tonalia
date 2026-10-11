"""Key detection (SPEC 2.2) over a harmonic HPCP.

Pipeline: HPSS keeps the harmonic part; tracks without tonal frames (pure percussion,
silence) return None; the tuning reference is estimated and compensated before the HPCP.

Decision, in order of preference:

1. Learned key profiles (``key_model.json``, trained by ``tools/train_key.py`` on the
   GiantSteps-MTG-Key set): per mode, one 12-bin profile for each of four HPCP bands
   (25-120, 120-250, 250-1000, 1000-3500 Hz), the bass-note and dominant-note
   histograms and the RMS chroma. The score of a key is the dot product of its profiles
   with the features rotated to its tonic, so the model is the same for every
   transposition; a softmax over the 24 keys gives the confidence.
2. Fallback when the model file is missing: ensemble of the published profiles
   (edma, bgate, temperley, krumhansl), each voting for its best key weighted by its
   configured weight and its correlation ("strength").

The track is also analysed in 30 s windows: a key that rules a majority of windows
becomes the main key, and a different key ruling more than 25 % of the track is
reported as the secondary key.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from importlib import resources

import numpy as np
import numpy.typing as npt

from ..keys import Key, format_key
from .chroma import (
    ANALYSIS_SR,
    FMAX,
    FMIN,
    HOP,
    FloatArray,
    estimate_tuning,
    hpcp,
    hpss,
    magnitude_spectrogram,
)

# Major/minor templates (C = index 0). Published values:
#   krumhansl — Krumhansl & Kessler (1982), "Cognitive Foundations of Musical Pitch";
#   temperley — Temperley (1999), "What's key for key? The Krumhansl-Schmuckler
#               key-finding algorithm reconsidered";
#   bgate, edma — Faraldo, Gómez, Jordà & Herrera (2016/2017), key estimation in
#               electronic dance music (major/minor rows).
PROFILES: dict[str, tuple[tuple[float, ...], tuple[float, ...]]] = {
    "krumhansl": (
        (6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88),
        (6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17),
    ),
    "temperley": (
        (5.0, 2.0, 3.5, 2.0, 4.5, 4.0, 2.0, 4.5, 2.0, 3.5, 1.5, 4.0),
        (5.0, 2.0, 3.5, 4.5, 2.0, 4.0, 2.0, 4.5, 3.5, 2.0, 1.5, 4.0),
    ),
    "bgate": (
        (1.00, 0.00, 0.42, 0.00, 0.53, 0.37, 0.00, 0.77, 0.00, 0.38, 0.21, 0.30),
        (1.00, 0.00, 0.36, 0.39, 0.00, 0.38, 0.00, 0.74, 0.27, 0.00, 0.42, 0.23),
    ),
    "edma": (
        (1.00, 0.29, 0.50, 0.40, 0.60, 0.56, 0.32, 0.80, 0.31, 0.45, 0.42, 0.39),
        (1.00, 0.31, 0.44, 0.58, 0.33, 0.49, 0.29, 0.78, 0.43, 0.29, 0.53, 0.32),
    ),
}

ALL_KEYS: tuple[Key, ...] = tuple(Key(r, m) for m in ("major", "minor") for r in range(12))

# Frequency bands (Hz) of the learned model's HPCP features.
KEY_BANDS: tuple[tuple[float, float], ...] = ((25, 120), (120, 250), (250, 1000), (1000, 3500))
BASS_BAND = (25.0, 250.0)
FULL_BAND = (25.0, 3500.0)
N_CHANNELS = len(KEY_BANDS) + 3  # bands, bass-note histogram, top-note histogram, RMS chroma
_ROTATIONS = (np.arange(12)[None, :] + np.arange(12)[:, None]) % 12  # [r, j] -> (j + r) % 12


@dataclass(frozen=True)
class KeyWeights:
    profiles: dict[str, float]
    min_harmonic_ratio: float = 0.65
    window_seconds: float = 30.0
    secondary_min_share: float = 0.25

    @classmethod
    def load(cls) -> KeyWeights:
        text = resources.files(__package__).joinpath("key_weights.json").read_text("utf-8")
        data = json.loads(text)
        raw = {k: float(v) for k, v in data["profiles"].items() if k in PROFILES}
        total = sum(raw.values()) or 1.0
        return cls(
            profiles={k: v / total for k, v in raw.items()},
            min_harmonic_ratio=float(data.get("min_harmonic_ratio", 0.65)),
            window_seconds=float(data.get("window_seconds", 30.0)),
            secondary_min_share=float(data.get("secondary_min_share", 0.25)),
        )


@dataclass(frozen=True)
class SecondaryKey:
    key: Key
    start_sec: float
    share: float


@dataclass(frozen=True)
class KeyResult:
    key: Key
    confidence: float
    alternatives: tuple[Key, ...]
    tuning_hz: float
    secondary: SecondaryKey | None = None
    scores: dict[str, float] = field(default_factory=dict, compare=False)


def _templates() -> dict[str, FloatArray]:
    """(24, 12) z-scored templates per profile, row index = ALL_KEYS index."""
    out: dict[str, FloatArray] = {}
    for name, (major, minor) in PROFILES.items():
        rows = [np.roll(np.asarray(major), r) for r in range(12)]
        rows += [np.roll(np.asarray(minor), r) for r in range(12)]
        t = np.asarray(rows, dtype=np.float64)
        t = (t - t.mean(axis=1, keepdims=True)) / t.std(axis=1, keepdims=True)
        out[name] = t
    return out


_TEMPLATES = _templates()


def _correlations(chroma: FloatArray) -> dict[str, FloatArray]:
    std = chroma.std()
    if std <= 1e-9:
        return {name: np.zeros(24) for name in _TEMPLATES}
    z = (chroma - chroma.mean()) / std
    return {name: t @ z / 12.0 for name, t in _TEMPLATES.items()}


def _ensemble(chroma: FloatArray, weights: KeyWeights) -> tuple[int, float, FloatArray]:
    """Winner index, confidence and the weighted score of every key."""
    corr = _correlations(chroma)
    votes = np.zeros(24)
    scores = np.zeros(24)
    for name, w in weights.profiles.items():
        c = corr[name]
        best = int(np.argmax(c))
        votes[best] += w * max(float(c[best]), 0.0)
        scores += w * c
    if votes.sum() <= 0:
        return int(np.argmax(scores)), 0.0, scores
    # Ties between votes are broken by the aggregate correlation.
    winner = int(np.lexsort((scores, votes))[-1])
    agreement = votes[winner] / votes.sum()
    strength = float(np.clip(scores[winner], 0.0, 1.0))
    return winner, float(np.clip(agreement * strength, 0.0, 1.0)), scores


@dataclass(frozen=True)
class TonalFrames:
    """Per-frame HPCP, the mask of tonal frames, and the estimated tuning."""

    hpcp: FloatArray
    tonal: npt.NDArray[np.bool_]
    tuning_hz: float
    harmonic: FloatArray = field(repr=False, default_factory=lambda: np.zeros((0, 0)))
    freqs: FloatArray = field(repr=False, default_factory=lambda: np.zeros(0))
    loud: npt.NDArray[np.bool_] = field(repr=False, default_factory=lambda: np.zeros(0, bool))

    @property
    def mean_chroma(self) -> FloatArray:
        mean: FloatArray = self.hpcp[self.tonal].mean(axis=0)
        return mean


def tonal_frames(
    audio: npt.NDArray[np.floating], sr: int, min_harmonic_ratio: float = 0.65
) -> TonalFrames | None:
    spec, freqs = magnitude_spectrogram(audio, sr)
    harmonic, percussive = hpss(spec)
    # Judge "tonal vs percussive" only in the band the HPCP uses: a sustained sub-bass
    # kick is harmonic to HPSS but carries no pitch information for key detection.
    band = (freqs >= FMIN) & (freqs <= FMAX)
    h_energy = (harmonic[:, band] ** 2).sum(axis=1)
    p_energy = (percussive[:, band] ** 2).sum(axis=1)
    total = h_energy + p_energy
    if total.max() <= 1e-10:
        return None
    ratio = h_energy / np.maximum(total, 1e-12)
    loud = total > total.max() * 10 ** (-50 / 10)  # within 50 dB of the loudest frame
    tonal = loud & (ratio >= min_harmonic_ratio)
    if tonal.sum() < 3:
        return None
    a4 = estimate_tuning(harmonic[tonal], freqs)
    frames = hpcp(harmonic, freqs, a4)
    tonal &= frames.max(axis=1) > 0
    if tonal.sum() < 3:
        return None
    return TonalFrames(frames, tonal, a4, harmonic, freqs, loud)


def frame_features(harmonic: FloatArray, freqs: FloatArray, a4: float) -> FloatArray:
    """Per-frame inputs of the learned model, shape (frames, N_CHANNELS, 12)."""
    bands = [hpcp(harmonic, freqs, a4, fmin=lo, fmax=hi) for lo, hi in KEY_BANDS]
    bass = hpcp(harmonic, freqs, a4, harmonics=1, fmin=BASS_BAND[0], fmax=BASS_BAND[1])
    full = hpcp(harmonic, freqs, a4, fmin=FULL_BAND[0], fmax=FULL_BAND[1])

    def onehot(chroma: FloatArray) -> FloatArray:
        out: FloatArray = np.eye(12)[chroma.argmax(axis=1)] * (chroma.max(axis=1) > 0)[:, None]
        return out

    return np.stack([*bands, onehot(bass), onehot(full), full**2], axis=1)


def pool_features(frames: FloatArray, mask: npt.NDArray[np.bool_]) -> FloatArray:
    """Aggregate frame features over ``mask`` into one (N_CHANNELS, 12) vector."""
    pooled: FloatArray = frames[mask].mean(axis=0)
    pooled[-1] = np.sqrt(pooled[-1])  # RMS chroma
    return pooled


@dataclass(frozen=True)
class KeyModel:
    """Learned, transposition-invariant key profiles (see module docstring)."""

    weights: FloatArray  # (2 modes, N_CHANNELS, 12): major, minor
    bias: FloatArray  # (2,)

    @classmethod
    def load(cls) -> KeyModel | None:
        path = resources.files(__package__).joinpath("key_model.json")
        if not path.is_file():
            return None
        data = json.loads(path.read_text("utf-8"))
        weights = np.asarray(data["weights"], dtype=np.float64)
        if weights.shape != (2, N_CHANNELS, 12):
            return None
        return cls(weights, np.asarray(data["bias"], dtype=np.float64))

    @staticmethod
    def rotate(features: FloatArray) -> FloatArray:
        """Normalize each channel and rotate to every tonic: (..., 12 tonics, C*12)."""
        f = features / (features.max(axis=-1, keepdims=True) + 1e-9)
        rotated = f[..., _ROTATIONS]  # (..., C, r, j)
        rotated = np.moveaxis(rotated, -2, -3)  # (..., r, C, j)
        out: FloatArray = rotated.reshape(*rotated.shape[:-2], -1)
        return out

    def logits(self, features: FloatArray) -> FloatArray:
        """Unnormalized scores of the 24 keys (ALL_KEYS order) for (..., C, 12) features."""
        rotated = self.rotate(features)  # (..., 12, C*12)
        s = rotated @ self.weights.reshape(2, -1).T + self.bias  # (..., 12, 2)
        out: FloatArray = np.swapaxes(s, -1, -2).reshape(*s.shape[:-2], 24)
        return out

    def probabilities(self, features: FloatArray) -> FloatArray:
        z = self.logits(features)
        z = z - z.max(axis=-1, keepdims=True)
        e = np.exp(z)
        out: FloatArray = e / e.sum(axis=-1, keepdims=True)
        return out


def key_from_chroma(chroma: FloatArray, weights: KeyWeights) -> tuple[Key, float]:
    """Ensemble decision for one chroma vector (used by detection and weight tuning)."""
    winner, confidence, _ = _ensemble(chroma, weights)
    return ALL_KEYS[winner], confidence


def detect_key(
    audio: npt.NDArray[np.floating], sr: int, weights: KeyWeights | None = None
) -> KeyResult | None:
    """Detect the key of mono ``audio``. Returns None when there is no tonal content."""
    weights = weights or KeyWeights.load()
    features = tonal_frames(audio, sr, weights.min_harmonic_ratio)
    if features is None:
        return None
    frames, tonal, a4 = features.hpcp, features.tonal.copy(), features.tuning_hz
    model = KeyModel.load()
    if model is not None:
        # The learned profiles were trained on every non-silent frame (percussive frames
        # included), which works better on real tracks than gating them out.
        learned = frame_features(features.harmonic, features.freqs, a4)
        frames, tonal = learned, features.loud.copy()

    def decide(chroma: FloatArray) -> tuple[int, float, FloatArray]:
        if model is None:
            return _ensemble(chroma, weights)
        p = model.probabilities(chroma)
        return int(np.argmax(p)), float(np.max(p)), p

    def pooled(mask: npt.NDArray[np.bool_], start: int = 0, stop: int | None = None) -> FloatArray:
        block = frames[start:stop]
        if model is None:
            return block[mask].mean(axis=0)  # type: ignore[no-any-return]
        return pool_features(block, mask)

    winner, confidence, scores = decide(pooled(tonal))

    # Windowed analysis: dominant key and key changes.
    per_window = max(1, round(weights.window_seconds * ANALYSIS_SR / HOP))
    shares = np.zeros(24)
    first_window_sec: dict[int, float] = {}
    for start in range(0, len(frames), per_window):
        mask = tonal[start : start + per_window]
        if mask.sum() < max(3, per_window // 4):
            continue
        w_winner, _, _ = decide(pooled(mask, start, start + per_window))
        shares[w_winner] += mask.sum()
        first_window_sec.setdefault(w_winner, start * HOP / ANALYSIS_SR)
    if shares.sum() > 0:
        shares /= shares.sum()
        dominant = int(np.argmax(shares))
        # The learned model is trained on whole tracks, so its global decision is only
        # overridden by a clear window majority (e.g. a track that modulates).
        majority = 0.5 if model is None else 0.6
        if shares[dominant] >= majority - 1e-9 and dominant != winner:
            winner = dominant
            confidence *= float(shares[dominant])

    secondary = None
    if shares.sum() > 0:
        rest = shares.copy()
        rest[winner] = 0.0
        candidate = int(np.argmax(rest))
        if rest[candidate] > weights.secondary_min_share:
            secondary = SecondaryKey(
                ALL_KEYS[candidate], first_window_sec[candidate], float(rest[candidate])
            )

    order = [int(i) for i in np.argsort(scores)[::-1] if int(i) != winner]
    return KeyResult(
        key=ALL_KEYS[winner],
        confidence=round(confidence, 4),
        alternatives=tuple(ALL_KEYS[i] for i in order[:2]),
        tuning_hz=round(a4, 2),
        secondary=secondary,
        scores={
            format_key(k, "alphanumeric"): round(float(s), 4)
            for k, s in zip(ALL_KEYS, scores, strict=True)
        },
    )
