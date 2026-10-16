"""Reduced spectrogram for "Review quality" and the track detail (SPEC 13.5).

The same back-to-back STFT as the cut-off check (``quality.stft_power``): the average of
all frames gives ``spectral_cutoff_hz`` (what the fake-high-quality flag uses), and the
frames grouped into at most ``COLUMNS`` time columns and ``ROWS`` linear frequency rows
(0 Hz to half the sample rate) give the picture. Levels are dB below the loudest cell,
mapped to 0-255 over ``RANGE_DB``.

File layout (little endian): ``b"TSG1"``, u16 version, u16 rows, u16 columns, u32
sample rate, f32 duration, f32 cut-off, 2 reserved bytes, then ``rows x columns`` bytes,
row 0 = the lowest frequencies.
"""

from __future__ import annotations

import struct
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import numpy.typing as npt

from ..fsutil import write_atomic
from .quality import cutoff_from_power, stft_power

ROWS = 128
COLUMNS = 480
RANGE_DB = 90.0
MAGIC = b"TSG1"
VERSION = 1
_HEADER = struct.Struct("<4sHHHIff2x")  # 24 bytes


@dataclass(frozen=True, eq=False)
class Spectrogram:
    sample_rate: int
    duration: float
    cutoff_hz: float
    data: npt.NDArray[np.uint8]  # (rows, columns)

    @property
    def max_hz(self) -> float:
        return self.sample_rate / 2


def compute_spectrogram(audio: npt.NDArray[np.floating], sr: int) -> Spectrogram:
    x = np.asarray(audio, dtype=np.float64)
    mono = x.mean(axis=1) if x.ndim == 2 else x
    power, freqs = stft_power(mono, sr)
    duration = len(mono) / sr if sr else 0.0
    if len(power) == 0:
        return Spectrogram(sr, duration, sr / 2, np.zeros((ROWS, 0), dtype=np.uint8))
    cutoff = cutoff_from_power(power.mean(axis=0), freqs)
    columns = min(COLUMNS, len(power))
    col_edges = np.linspace(0, len(power), columns + 1).astype(int)
    by_time = np.add.reduceat(power, col_edges[:-1], axis=0) / np.diff(col_edges)[:, None]
    row_edges = np.linspace(0, power.shape[1], ROWS + 1).astype(int)
    cells = np.add.reduceat(by_time, row_edges[:-1], axis=1) / np.diff(row_edges)[None, :]
    db = 10 * np.log10(cells + 1e-20)
    level = np.clip((db - (db.max() - RANGE_DB)) / RANGE_DB, 0.0, 1.0)
    data = np.round(255 * level).astype(np.uint8).T  # (rows, columns)
    return Spectrogram(sr, round(duration, 3), round(cutoff, 0), np.ascontiguousarray(data))


def write_spectrogram(path: Path, spec: Spectrogram) -> None:
    """Atomic write: a temporary file next to the target, then a rename."""
    path.parent.mkdir(parents=True, exist_ok=True)
    rows, columns = spec.data.shape
    header = _HEADER.pack(
        MAGIC, VERSION, rows, columns, spec.sample_rate, spec.duration, spec.cutoff_hz
    )
    write_atomic(path, header + np.ascontiguousarray(spec.data, dtype=np.uint8).tobytes())


def read_spectrogram(path: Path) -> Spectrogram:
    raw = path.read_bytes()
    if len(raw) < _HEADER.size:
        raise ValueError(f"not a Tonalia spectrogram: {path.name}")
    magic, version, rows, columns, sr, duration, cutoff = _HEADER.unpack_from(raw)
    if magic != MAGIC or version != VERSION or len(raw) != _HEADER.size + rows * columns:
        raise ValueError(f"not a Tonalia spectrogram: {path.name}")
    data = np.frombuffer(raw, dtype=np.uint8, offset=_HEADER.size).reshape(rows, columns)
    return Spectrogram(int(sr), float(duration), float(cutoff), data.copy())
