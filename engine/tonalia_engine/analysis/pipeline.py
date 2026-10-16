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
from ..duplicates import compute as fingerprint
from .energy import EnergyModel, detect_energy
from .key import detect_key
from .quality import analyze_quality, replaygain_db
from .spectrogram import compute_spectrogram
from .structure import detect_structure
from .tempo import BeatGrid, TempoSettings, detect_tempo
from .vocals import estimate_presence, main_sections
from .waveform import compute_waveform

# Bump when an algorithm changes in a way that alters results: the UI then offers to
# re-analyze tracks analysed with an older version (SPEC §3, reproducibility).
ANALYSIS_VERSION = "3.0"

Stage = str
Reporter = Callable[[Stage], None]


@dataclass(frozen=True)
class AnalysisSettings:
    min_bpm: float = 70.0
    max_bpm: float = 180.0
    # The user's energy calibration when it is the active model (SPEC 12.2), else None.
    energy_params: dict[str, Any] | None = None


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
    grid: BeatGrid | None = None,
) -> dict[str, Any]:
    """Analyse one file. Raises ``DecodeError`` for unreadable audio. ``fmt`` and
    ``bitrate`` (kbps) come from the library and feed the quality checks. ``grid`` is the
    user's locked beatgrid (SPEC 12.4): energy blocks and sections follow it, while the
    tempo is still detected (the queue keeps that grid aside for "Reset")."""

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
    grid = grid or (tempo.grid if tempo else None)
    energy = detect_energy(
        audio,
        ANALYSIS_SAMPLE_RATE,
        grid,
        EnergyModel.load().with_params(settings.energy_params),
    )
    stage("structure")
    blocks = [(b.start, b.end, b.level) for b in energy.curve] if energy else None
    structure = detect_structure(audio, ANALYSIS_SAMPLE_RATE, grid, blocks)
    sections = main_sections(
        structure.segments if structure else [], audio.size / ANALYSIS_SAMPLE_RATE
    )
    vocal_presence, vocal_source = estimate_presence(audio, ANALYSIS_SAMPLE_RATE, sections)
    stage("quality")
    spectrogram = compute_spectrogram(audio, ANALYSIS_SAMPLE_RATE)
    quality = analyze_quality(
        stereo, ANALYSIS_SAMPLE_RATE, fmt=fmt, bitrate=bitrate, cutoff_hz=spectrogram.cutoff_hz
    )
    stage("waveform")
    waveform = compute_waveform(audio, ANALYSIS_SAMPLE_RATE)
    print_ = fingerprint(audio, ANALYSIS_SAMPLE_RATE)  # duplicates (SPEC 13.3)
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
        "energy_blocks": None,
        "loudness_lufs": None,
        "peak_db": None,
        "true_peak_db": None,
        "replaygain_db": None,
        "clipping_ratio": None,
        "cutoff_hz": None,
        "silence_start": None,
        "silence_end": None,
        "quality_flags": None,
        # Replaced by the stems measurement once the track is separated (queue keeps it).
        "vocal_presence": vocal_presence,
        "vocal_source": vocal_source,
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
            true_peak_db=quality.true_peak_db,
            replaygain_db=replaygain_db(quality.loudness_lufs),
            clipping_ratio=quality.clipping_ratio,
            cutoff_hz=quality.cutoff_hz,
            silence_start=quality.silence_start,
            silence_end=quality.silence_end,
            quality_flags=json.dumps(quality.flags),
        )
    # Not analysis columns: the queue writes the waveform file and stores the segments
    # (deriving the cues from them).
    row["_waveform"] = waveform
    row["_spectrogram"] = spectrogram
    row["_fingerprint"] = print_.encode() if print_ is not None else None
    row["_segments"] = [asdict(s) for s in structure.segments] if structure else []
    if energy is not None:
        row.update(
            energy=energy.energy,
            energy_curve=json.dumps([asdict(b) for b in energy.curve]),
            energy_blocks=json.dumps(energy.descriptors),
        )
    return row
