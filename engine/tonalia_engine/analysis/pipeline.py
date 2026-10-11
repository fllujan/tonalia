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

from ..audio_io import ANALYSIS_SAMPLE_RATE, decode, downmix
from .energy import detect_energy
from .key import detect_key
from .quality import analyze_quality
from .structure import detect_structure
from .tempo import TempoSettings, detect_tempo

# Bump when an algorithm changes in a way that alters results: the UI then offers to
# re-analyze tracks analysed with an older version (SPEC §3, reproducibility).
ANALYSIS_VERSION = "2.5"

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
    *,
    fmt: str | None = None,
    bitrate: int | None = None,
) -> dict[str, Any]:
    """Analyse one file. Raises ``DecodeError`` for unreadable audio. ``fmt`` and
    ``bitrate`` (kbps) come from the library and feed the quality checks."""

    def stage(name: Stage) -> None:
        if report:
            report(name)

    stage("decoding")
    # One decode: peaks and loudness need the channels, the rest uses FFmpeg's mono.
    stereo = decode(Path(path), channels=2)
    audio = downmix(stereo)
    stage("key")
    key = detect_key(audio, ANALYSIS_SAMPLE_RATE)
    stage("tempo")
    tempo = detect_tempo(
        audio,
        ANALYSIS_SAMPLE_RATE,
        TempoSettings(min_bpm=settings.min_bpm, max_bpm=settings.max_bpm),
        genre=genre,
    )
    stage("energy")
    energy = detect_energy(audio, ANALYSIS_SAMPLE_RATE, tempo.grid if tempo else None)
    stage("structure")
    blocks = [(b.start, b.end, b.level) for b in energy.curve] if energy else None
    structure = detect_structure(audio, ANALYSIS_SAMPLE_RATE, tempo.grid if tempo else None, blocks)
    stage("quality")
    quality = analyze_quality(stereo, ANALYSIS_SAMPLE_RATE, fmt=fmt, bitrate=bitrate)
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
        "energy": None,
        "energy_curve": None,
        "loudness_lufs": None,
        "peak_db": None,
        "clipping_ratio": None,
        "cutoff_hz": None,
        "silence_start": None,
        "silence_end": None,
        "quality_flags": None,
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
    if quality is not None:
        row.update(
            loudness_lufs=quality.loudness_lufs,
            peak_db=quality.peak_db,
            clipping_ratio=quality.clipping_ratio,
            cutoff_hz=quality.cutoff_hz,
            silence_start=quality.silence_start,
            silence_end=quality.silence_end,
            quality_flags=json.dumps(quality.flags),
        )
    # Not an analysis column: the queue stores it in ``segments`` and derives the cues.
    row["_segments"] = [asdict(s) for s in structure.segments] if structure else []
    if energy is not None:
        row.update(
            energy=energy.energy,
            energy_curve=json.dumps([asdict(b) for b in energy.curve]),
        )
    return row
