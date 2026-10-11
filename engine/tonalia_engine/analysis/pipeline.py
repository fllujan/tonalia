"""Per-track analysis run inside worker processes.

``analyze_file`` decodes a file and runs every analysis stage, returning a plain dict
(picklable, ready for the database). Stage changes are reported through a callback so
the UI can show the per-track stepper (Decoding → Key → Tempo → …).
"""

from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from ..audio_io import ANALYSIS_SAMPLE_RATE, decode
from .key import detect_key
from .tempo import TempoSettings, detect_tempo

# Bump when an algorithm changes in a way that alters results: the UI then offers to
# re-analyze tracks analysed with an older version (SPEC §3, reproducibility).
ANALYSIS_VERSION = "2.1"

Stage = str
Reporter = Callable[[Stage], None]


@dataclass(frozen=True)
class AnalysisSettings:
    min_bpm: float = 70.0
    max_bpm: float = 180.0


def _key_dict(root: int, mode: str) -> dict[str, Any]:
    return {"root": root, "mode": mode}


def analyze_file(
    path: str,
    genre: str | None,
    settings: AnalysisSettings,
    report: Reporter | None = None,
) -> dict[str, Any]:
    """Analyse one file. Raises ``DecodeError`` for unreadable audio."""

    def stage(name: Stage) -> None:
        if report:
            report(name)

    stage("decoding")
    audio = decode(Path(path))
    stage("key")
    key = detect_key(audio, ANALYSIS_SAMPLE_RATE)
    stage("tempo")
    tempo = detect_tempo(
        audio,
        ANALYSIS_SAMPLE_RATE,
        TempoSettings(min_bpm=settings.min_bpm, max_bpm=settings.max_bpm),
        genre=genre,
    )
    row: dict[str, Any] = {
        "key_root": None,
        "key_mode": None,
        "key_confidence": None,
        "key_alternatives": None,
        "key_secondary_root": None,
        "key_secondary_mode": None,
        "key_secondary_start": None,
        "tuning_hz": None,
        "bpm": None,
        "bpm_confidence": None,
        "beat_grid": None,
    }
    if key is not None:
        row.update(
            key_root=key.key.root,
            key_mode=key.key.mode,
            key_confidence=key.confidence,
            key_alternatives=json.dumps([_key_dict(k.root, k.mode) for k in key.alternatives]),
            tuning_hz=key.tuning_hz,
        )
        if key.secondary is not None:
            row.update(
                key_secondary_root=key.secondary.key.root,
                key_secondary_mode=key.secondary.key.mode,
                key_secondary_start=round(key.secondary.start_sec, 2),
            )
    if tempo is not None:
        row.update(
            bpm=tempo.bpm,
            bpm_confidence=tempo.confidence,
            beat_grid=json.dumps(asdict(tempo.grid)),
        )
    return row
