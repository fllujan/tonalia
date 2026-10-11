"""Three-band waveform (SPEC 2.8): 150 points per second, stored as a compact binary.

Each point holds the peak of the low (< 250 Hz), mid (250 Hz - 4 kHz) and high
(> 4 kHz) band in one byte each, with a square-root curve so quiet passages stay
visible (255 = full scale). The UI paints the bands stacked like a booth display.

File layout (little endian): ``b"TWF1"``, u16 version, u16 points per second,
u32 point count, u8 band count, 3 reserved bytes, then ``count x bands`` bytes.
"""

from __future__ import annotations

import os
import struct
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import numpy.typing as npt
from scipy.signal import butter, sosfilt

POINTS_PER_SECOND = 150
BANDS = ("low", "mid", "high")
LOW_HZ = 250.0
HIGH_HZ = 4000.0
MAGIC = b"TWF1"
VERSION = 1
_HEADER = struct.Struct("<4sHHIB3x")  # 16 bytes


@dataclass(frozen=True, eq=False)
class Waveform:
    points_per_second: int
    data: npt.NDArray[np.uint8]  # (points, bands)

    def __eq__(self, other: object) -> bool:
        return (
            isinstance(other, Waveform)
            and self.points_per_second == other.points_per_second
            and np.array_equal(self.data, other.data)
        )

    __hash__ = None  # type: ignore[assignment]


def compute_waveform(audio: npt.NDArray[np.floating], sr: int) -> Waveform:
    x = np.asarray(audio, dtype=np.float64)
    filters = [
        butter(4, LOW_HZ, "lowpass", fs=sr, output="sos"),
        butter(4, [LOW_HZ, HIGH_HZ], "bandpass", fs=sr, output="sos"),
        butter(4, HIGH_HZ, "highpass", fs=sr, output="sos"),
    ]
    hop = sr / POINTS_PER_SECOND
    n = int(len(x) / hop)
    edges = np.round(np.arange(n + 1) * hop).astype(int)
    out = np.zeros((n, len(BANDS)), dtype=np.uint8)
    if n == 0:
        return Waveform(POINTS_PER_SECOND, out)
    for b, sos in enumerate(filters):
        band = np.abs(sosfilt(sos, x))
        peaks = np.maximum.reduceat(band[: edges[-1]], edges[:-1])
        out[:, b] = np.round(255 * np.sqrt(np.clip(peaks, 0.0, 1.0))).astype(np.uint8)
    return Waveform(POINTS_PER_SECOND, out)


def write_waveform(path: Path, waveform: Waveform) -> None:
    """Atomic write: a temporary file next to the target, then a rename."""
    path.parent.mkdir(parents=True, exist_ok=True)
    data = np.ascontiguousarray(waveform.data, dtype=np.uint8)
    header = _HEADER.pack(MAGIC, VERSION, waveform.points_per_second, len(data), data.shape[1])
    tmp = path.with_name(path.name + ".tmp")
    with tmp.open("wb") as f:
        f.write(header)
        f.write(data.tobytes())
        f.flush()
        os.fsync(f.fileno())
    tmp.replace(path)


def read_waveform(path: Path) -> Waveform:
    raw = path.read_bytes()
    if len(raw) < _HEADER.size:
        raise ValueError(f"not a Tonalia waveform: {path.name}")
    magic, version, pps, count, bands = _HEADER.unpack_from(raw)
    if magic != MAGIC or version != VERSION or len(raw) != _HEADER.size + count * bands:
        raise ValueError(f"not a Tonalia waveform: {path.name}")
    data = np.frombuffer(raw, dtype=np.uint8, offset=_HEADER.size).reshape(count, bands)
    return Waveform(pps, data.copy())
