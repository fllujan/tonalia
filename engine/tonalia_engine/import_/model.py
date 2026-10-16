"""What a DJ program's collection holds, as the readers hand it to the importer.

Readers never write: they parse the program's file (or a copy of its database) into these
plain records, with every path already turned into a path of this computer when the
program stores it some other way (relative to a drive, as a URL, as volume + folders).
"""

from __future__ import annotations

import re
import shutil
import tempfile
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from itertools import pairwise
from pathlib import Path
from typing import Literal

from ..keys import Key
from ..rpc_schema import GridAnchor, GridSpec, ImportSource, ImportWarning

CueKind = Literal["hot", "memory", "loop"]
# A Tonalia export writes its playlists into a folder of this name; it is not imported back.
OWN_FOLDER = "Tonalia"


@dataclass(frozen=True)
class ImportedCue:
    kind: CueKind
    position: float  # seconds
    slot: int | None = None  # 0-7 for hot cues
    length: float | None = None  # seconds, loops
    name: str | None = None
    color: str | None = None  # "#RRGGBB"


@dataclass
class ImportedTrack:
    path: str
    title: str | None = None
    artist: str | None = None
    size: int | None = None
    key: Key | None = None
    bpm: float | None = None
    grid: GridSpec | None = None
    rating: int | None = None  # 0-5 stars
    play_count: int | None = None
    comment: str | None = None
    cues: list[ImportedCue] = field(default_factory=list)


@dataclass
class ImportedPlaylist:
    name: str
    is_folder: bool
    paths: list[str] = field(default_factory=list)
    children: list[ImportedPlaylist] = field(default_factory=list)


@dataclass
class ImportedCollection:
    source: ImportSource
    path: Path
    tracks: list[ImportedTrack] = field(default_factory=list)
    playlists: list[ImportedPlaylist] = field(default_factory=list)
    warnings: list[ImportWarning] = field(default_factory=list)


def network_share(path: str) -> str | None:
    """The ``\\\\server\\share`` a network path lives on (folded), or None for a local
    path. Opening a path on a share makes Windows connect to that server and send the
    user's credentials, so a collection must not make Tonalia reach shares of its own."""
    if not path.startswith(("\\\\", "//")):
        return None
    parts = [p for p in re.split(r"[\\/]+", path) if p]
    if parts and parts[0] in ("?", "."):  # \\?\C:\… is local; \\?\UNC\server\share is not
        if len(parts) < 2 or parts[1].upper() != "UNC":
            return None
        parts = parts[2:]
    return "\\\\" + "\\".join(parts[:2]).casefold() if len(parts) >= 2 else ""


def stars(value: float, full: float) -> int | None:
    """A rating on a 0..``full`` scale as 0-5 stars (None when there is none)."""
    if value <= 0:
        return None
    return max(0, min(5, round(value / full * 5)))


def constant_grid(bpm: float, first_downbeat: float) -> GridSpec | None:
    if not 40 <= bpm <= 300:
        return None
    return GridSpec(bpm=round(bpm, 4), first_downbeat=round(first_downbeat, 4))


def anchored_grid(pins: list[tuple[int, float]], end_bpm: float) -> GridSpec | None:
    """A grid through beats pinned at times: ``pins[0]`` is beat 0 (a downbeat) and the
    tempo after the last pin is ``end_bpm``. Steady pins give a constant grid."""
    pins = sorted(dict(pins).items())
    if not pins:
        return None
    if len(pins) == 1:
        return constant_grid(end_bpm, pins[0][1])
    periods = [(t1 - t0) / (b1 - b0) for (b0, t0), (b1, t1) in pairwise(pins)]
    if any(p <= 0 for p in periods):
        return None
    bpms = [60.0 / p for p in periods] + [end_bpm]
    if max(bpms) - min(bpms) < 0.01:
        return constant_grid(bpms[0], pins[0][1])
    last_beat, last_time = pins[-1]
    # One more pin so the tempo after the last change is the program's, not the one before.
    tail = (last_beat + 64, last_time + 64 * 60.0 / end_bpm)
    anchors = [GridAnchor(beat=b, time=round(t, 4)) for b, t in [*pins[1:], tail]]
    median = sorted(bpms)[len(bpms) // 2]
    try:
        return GridSpec(
            bpm=round(min(300.0, max(40.0, median)), 4),
            first_downbeat=round(pins[0][1], 4),
            anchors=anchors,
        )
    except ValueError:
        return None


@contextmanager
def snapshot(*paths: Path) -> Iterator[Path]:
    """Copies of ``paths`` in a private folder (an open program may be writing them);
    yields the folder, removed afterwards."""
    with tempfile.TemporaryDirectory(prefix="tonalia-import-") as scratch:
        folder = Path(scratch)
        for path in paths:
            if path.exists():
                shutil.copy2(path, folder / path.name)
        yield folder
