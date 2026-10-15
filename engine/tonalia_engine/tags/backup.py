"""Exact undo for writes to the user's files (SPEC §0.3 and 2.9).

Before a written file replaces the original, the region of the original that differs
from the new file is kept (in practice the tag block: audio data is shared prefix or
suffix), together with xxh64 digests of both versions. Undo rebuilds the original
byte for byte, and refuses when the file was changed by anything else since.
"""

from __future__ import annotations

import json
import zlib
from pathlib import Path

import xxhash

from ..errors import TonaliaError
from ..fsutil import write_atomic

PATCH_VERSION = 1


class UndoRefusedError(TonaliaError, RuntimeError):
    """The file is not the one Tonalia wrote (edited, replaced or missing)."""

    reason = "undo_mismatch"


def digest(data: bytes) -> str:
    return xxhash.xxh64(data).hexdigest()


def _common_length(a: bytes, b: bytes, from_end: bool, limit: int) -> int:
    """Length of the common prefix (or suffix) of ``a`` and ``b``, at most ``limit``.

    Binary search on memoryview slices: memcmp speed, no copies of the file.
    """
    va, vb = memoryview(a), memoryview(b)
    lo, hi = 0, limit
    while lo < hi:
        mid = (lo + hi + 1) // 2
        same = va[len(a) - mid :] == vb[len(b) - mid :] if from_end else va[:mid] == vb[:mid]
        if same:
            lo = mid
        else:
            hi = mid - 1
    return lo


def make_patch(original: bytes, new: bytes) -> bytes:
    """Compressed record that turns ``new`` back into ``original``."""
    shortest = min(len(original), len(new))
    prefix = _common_length(original, new, False, shortest)
    suffix = _common_length(original, new, True, shortest - prefix)
    header = {
        "v": PATCH_VERSION,
        "prefix": prefix,
        "suffix": suffix,
        "original_size": len(original),
        "original_hash": digest(original),
        "written_size": len(new),
        "written_hash": digest(new),
    }
    middle = original[prefix : len(original) - suffix]
    return zlib.compress(json.dumps(header).encode() + b"\n" + middle, 6)


def read_header(patch: bytes) -> dict[str, int | str]:
    raw = zlib.decompress(patch)
    header: dict[str, int | str] = json.loads(raw[: raw.index(b"\n")])
    return header


def apply_patch(current: bytes, patch: bytes) -> bytes:
    raw = zlib.decompress(patch)
    split = raw.index(b"\n")
    header = json.loads(raw[:split])
    middle = raw[split + 1 :]
    if header.get("v") != PATCH_VERSION:
        raise UndoRefusedError("unknown backup format", reason="undo_mismatch")
    if len(current) != header["written_size"] or digest(current) != header["written_hash"]:
        raise UndoRefusedError("the file has changed since Tonalia wrote it", reason="undo_changed")
    prefix, suffix = int(header["prefix"]), int(header["suffix"])
    original = current[:prefix] + middle + current[len(current) - suffix :]
    if digest(original) != header["original_hash"]:
        raise UndoRefusedError("backup does not match the original file", reason="undo_mismatch")
    return original


def atomic_replace(path: Path, data: bytes) -> None:
    """Write ``data`` next to ``path`` (exclusive temporary file) and rename it over."""
    write_atomic(path, data, keep_mode_of=path)


def restore(path: Path, patch: bytes) -> None:
    """Undo one write. Raises :class:`UndoRefusedError` and leaves the file alone if it
    is not exactly the file Tonalia wrote."""
    if not path.is_file():
        raise UndoRefusedError("file not found", reason="file_not_found")
    atomic_replace(path, apply_patch(path.read_bytes(), patch))
