"""Key detection (SPEC 2.2): ensemble of key profiles over a harmonic HPCP.

Pipeline: HPSS keeps the harmonic part; frames dominated by percussion or silence
(drum intros/outros) are excluded; the tuning reference is estimated and compensated
before computing the HPCP. Each profile correlates the mean HPCP with its 24 rotated
templates and votes for its best key, weighted by its configured weight and its
correlation ("strength"). The track is also analysed in 30 s windows: a key that rules
a majority of windows becomes the main key, and a different key ruling more than 25 %
of the track is reported as the secondary key.
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
    return TonalFrames(frames, tonal, a4)


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
    winner, confidence, scores = _ensemble(frames[tonal].mean(axis=0), weights)

    # Windowed analysis: dominant key and key changes.
    per_window = max(1, round(weights.window_seconds * ANALYSIS_SR / HOP))
    shares = np.zeros(24)
    first_window_sec: dict[int, float] = {}
    for start in range(0, len(frames), per_window):
        mask = tonal[start : start + per_window]
        if mask.sum() < max(3, per_window // 4):
            continue
        w_winner, _, _ = _ensemble(frames[start : start + per_window][mask].mean(axis=0), weights)
        shares[w_winner] += mask.sum()
        first_window_sec.setdefault(w_winner, start * HOP / ANALYSIS_SR)
    if shares.sum() > 0:
        shares /= shares.sum()
        dominant = int(np.argmax(shares))
        if shares[dominant] >= 0.5 and dominant != winner:
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
