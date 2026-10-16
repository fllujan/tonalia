"""The spectrogram of a track for the UI (SPEC 13.5): from the cache the analysis wrote,
or computed from the file (and cached) for tracks analysed before it existed."""

from __future__ import annotations

import base64
import json
from pathlib import Path

from .analysis.quality import likely_source_kbps
from .analysis.queue import spectrogram_path
from .analysis.spectrogram import (
    Spectrogram,
    compute_spectrogram,
    read_spectrogram,
    write_spectrogram,
)
from .audio_io import ANALYSIS_SAMPLE_RATE, decode
from .db import Database
from .errors import TonaliaError
from .rpc_schema import SpectrogramResult


def _load(
    db: Database, data_dir: Path, track_id: int, path: str, stored: str | None
) -> Spectrogram:
    if stored:
        try:
            return read_spectrogram(Path(stored))
        except (OSError, ValueError):
            pass  # gone or damaged: computed again below
    source = Path(path)
    if not source.is_file():
        raise TonaliaError(f"file not found: {source}", reason="file_not_found", name=source.name)
    spec = compute_spectrogram(decode(source), ANALYSIS_SAMPLE_RATE)
    cache = spectrogram_path(data_dir, track_id)
    write_spectrogram(cache, spec)
    db.conn.execute(
        "UPDATE analysis SET spectrogram_path = ? WHERE track_id = ?", (str(cache), track_id)
    )
    return spec


def track_spectrogram(db: Database, data_dir: Path, track_id: int) -> SpectrogramResult:
    row = db.conn.execute(
        "SELECT t.path, t.format, t.bitrate, a.spectrogram_path, a.quality_flags "
        "FROM tracks t LEFT JOIN analysis a ON a.track_id = t.id WHERE t.id = ?",
        (track_id,),
    ).fetchone()
    if row is None:
        raise TonaliaError(f"unknown track {track_id}", reason="track_not_found")
    spec = _load(db, data_dir, track_id, row["path"], row["spectrogram_path"])
    rows, columns = spec.data.shape
    flags = json.loads(row["quality_flags"] or "[]")
    return SpectrogramResult(
        track_id=track_id,
        rows=rows,
        columns=columns,
        max_hz=spec.max_hz,
        duration=spec.duration,
        data=base64.b64encode(spec.data.tobytes()).decode("ascii"),
        cutoff_hz=spec.cutoff_hz,
        likely_kbps=likely_source_kbps(spec.cutoff_hz),
        format=row["format"],
        bitrate=row["bitrate"],
        fake_hq="fake_hq" in flags,
    )
