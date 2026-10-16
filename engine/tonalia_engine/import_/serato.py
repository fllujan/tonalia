"""Read Serato's library (SPEC 13.1): what it keeps in its folder and in the files.

- ``_Serato_/database V2``: the tracks, as records like the crates' (``otrk`` with
  ``pfil`` = path relative to the drive's root, ``tbpm``, ``tkey``, ``tcom``; text in
  UTF-16BE). Serato keeps no rating or play count there;
- the hot cues, loops and beatgrid live in each audio file: ``Serato Markers2``
  (``export/serato_markers.py``: ``CUE`` and ``LOOP`` entries) and ``Serato BeatGrid``
  (``01 00``, a big-endian ``uint32`` count, then 8 bytes per marker: ``float32``
  position and ``uint32`` beats to the next marker, the last one a ``float32`` BPM);
- crates: ``_Serato_/Subcrates/*.crate``, nested by ``%%`` in the file name, ordered as
  in ``neworder.pref``. Smart crates are left out.
"""

from __future__ import annotations

import binascii
import struct
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path, PurePath, PureWindowsPath

import mutagen

from ..export import serato_crates as crates
from ..export import serato_markers as markers
from ..keys import parse_key
from ..rpc_schema import GridSpec, ImportWarning
from .model import (
    OWN_FOLDER,
    ImportedCollection,
    ImportedCue,
    ImportedPlaylist,
    ImportedTrack,
    anchored_grid,
)

DATABASE = "database V2"
GRID_DESC = "Serato BeatGrid"
GRID_VORBIS = "SERATO_BEATGRID"
GRID_MP4 = "----:com.serato.dj:beatgrid"


def drive_root(folder: Path) -> PurePath:
    """The root the paths of ``folder``'s Serato library are relative to."""
    if folder.drive:
        return PureWindowsPath(folder.anchor)
    parts = folder.parts
    if len(parts) > 2 and parts[1] == "Volumes":
        return PurePath(*parts[:3])
    return PurePath("/")


def _absolute(stored: str, root: PurePath) -> str:
    return str(root.joinpath(*[p for p in stored.replace("\\", "/").split("/") if p]))


def database_tracks(data: bytes, root: PurePath) -> list[ImportedTrack]:
    out: list[ImportedTrack] = []
    for tag, body in crates._records(data):
        if tag != b"otrk":
            continue
        fields = {t.decode("ascii", "replace"): v for t, v in crates._records(body)}

        def text(name: str, fields: dict[str, bytes] = fields) -> str | None:
            raw = fields.get(name)
            value = raw.decode("utf-16-be", "replace").strip("\x00").strip() if raw else ""
            return value or None

        stored = text("pfil")
        if not stored:
            continue
        try:
            bpm = float(text("tbpm") or "")
        except ValueError:
            bpm = 0.0
        out.append(
            ImportedTrack(
                path=_absolute(stored, root),
                title=text("tsng"),
                artist=text("tart"),
                key=parse_key(text("tkey") or ""),
                bpm=bpm if bpm > 0 else None,
                comment=text("tcom"),
            )
        )
    return out


# ---- inside the audio files ----


def parse_loop(entry: markers.Entry) -> ImportedCue | None:
    data = entry.data
    if len(data) < 21:
        return None
    start, end = struct.unpack(">II", data[2:10])
    if end <= start:
        return None
    name = data[20:].split(b"\x00", 1)[0].decode("utf-8", "replace") or None
    return ImportedCue(
        "loop", start / 1000.0, length=(end - start) / 1000.0, name=name,
        color="#" + data[15:18].hex().upper(),
    )  # fmt: skip


def parse_grid(data: bytes) -> GridSpec | None:
    if len(data) < 6 or data[:2] != b"\x01\x00":
        return None
    (count,) = struct.unpack(">I", data[2:6])
    if count < 1 or len(data) < 6 + 8 * count:
        return None
    pins: list[tuple[int, float]] = []
    beat = 0
    for i in range(count):
        position = struct.unpack(">f", data[6 + 8 * i : 10 + 8 * i])[0]
        if i == count - 1:
            bpm = struct.unpack(">f", data[10 + 8 * i : 14 + 8 * i])[0]
            pins.append((beat, float(position)))
            if not pins or bpm <= 0:
                return None
            # Serato's first marker sits on a beat it treats as the bar's first.
            first = pins[0][1]
            return anchored_grid([(b - pins[0][0], t) for b, t in pins if t >= first], bpm)
        (to_next,) = struct.unpack(">I", data[10 + 8 * i : 14 + 8 * i])
        pins.append((beat, float(position)))
        beat += int(to_next)
    return None


def _unwrap(raw: bytes, desc: str) -> bytes:
    """The GEOB data inside a FLAC/MP4 Serato tag (base64 of mime + description + data)."""
    decoded = markers._b64decode(raw)
    prefix = b"application/octet-stream\x00\x00" + desc.encode() + b"\x00"
    return decoded[len(prefix) :] if decoded.startswith(prefix) else b""


def read_grid(path: Path) -> GridSpec | None:
    fmt = markers.file_format(path)
    audio = mutagen.File(path)
    if audio is None or fmt is None or audio.tags is None:
        return None
    if fmt in ("mp3", "aiff"):
        frames = [f for f in audio.tags.getall("GEOB") if f.desc == GRID_DESC]
        return parse_grid(frames[0].data) if frames else None
    if fmt == "flac":
        values = audio.tags.get(GRID_VORBIS)
        return parse_grid(_unwrap(values[0].encode("ascii"), GRID_DESC)) if values else None
    values = audio.tags.get(GRID_MP4)
    return parse_grid(_unwrap(bytes(values[0]), GRID_DESC)) if values else None


def read_file(path: Path) -> tuple[list[ImportedCue], GridSpec | None]:
    """The hot cues, loops and beatgrid Serato wrote into one audio file."""
    cues: list[ImportedCue] = []
    for entry in markers.read_entries(path):
        if entry.name == "CUE":
            cue = markers.parse_cue(entry)
            if 0 <= cue.index <= 7:
                cues.append(
                    ImportedCue(
                        "hot", cue.position_ms / 1000.0, slot=cue.index,
                        name=cue.name or None, color=cue.color,
                    )
                )  # fmt: skip
        elif entry.name == "LOOP":
            loop = parse_loop(entry)
            if loop is not None:
                cues.append(loop)
    return cues, read_grid(path)


# ---- crates ----


def _crate_tree(
    folder: Path, root: PurePath, warnings: list[ImportWarning]
) -> list[ImportedPlaylist]:
    sub = folder / "Subcrates"
    files = {p.name[: -len(crates.CRATE_SUFFIX)]: p for p in sub.glob(f"*{crates.CRATE_SUFFIX}")}
    order_file = folder / crates.ORDER_FILE
    order: list[str] = []
    if order_file.is_file():
        for line in order_file.read_bytes().decode("utf-16-be", "replace").splitlines():
            if line.startswith("[crate]"):
                order.append(line[7:])
    names = [n for n in order if n in files] + sorted(n for n in files if n not in order)
    nodes: dict[str, ImportedPlaylist] = {}
    tops: list[ImportedPlaylist] = []
    skipped = False
    for full in sorted(names, key=lambda n: n.count(crates.SEPARATOR)):
        parts = full.split(crates.SEPARATOR)
        if parts[0] == OWN_FOLDER:
            skipped = True
            continue
        paths = [_absolute(p, root) for p in crates.read_crate(files[full].read_bytes())]
        node = ImportedPlaylist(parts[-1], False, paths)
        nodes[full] = node
        parent = crates.SEPARATOR.join(parts[:-1])
        if parent and parent in nodes:
            nodes[parent].children.append(node)
        else:
            tops.append(node)
    # A crate with subcrates is a folder that may also hold tracks of its own.
    for node in nodes.values():
        node.is_folder = bool(node.children) and not node.paths
    if skipped:
        warnings.append(ImportWarning(code="own_folder_skipped"))
    position = {n: i for i, n in enumerate(names)}
    tops.sort(key=lambda n: position.get(n.name, 0))
    return tops


def read(
    folder: Path,
    wanted: Callable[[str], bool] = lambda _: True,
    progress: Callable[[float], None] = lambda _: None,
) -> ImportedCollection:
    """``wanted`` says which files to open for their cues and grid (the ones Tonalia
    matched: opening 20 000 files nobody asked for would take minutes)."""
    out = ImportedCollection("serato", folder)
    root = drive_root(folder)
    db_file = folder / DATABASE
    out.tracks = database_tracks(db_file.read_bytes(), root) if db_file.is_file() else []
    out.playlists = _crate_tree(folder, root, out.warnings)
    known = {t.path for t in out.tracks}
    for path in (p for pl in _flatten(out.playlists) for p in pl.paths):
        if path not in known:
            known.add(path)
            out.tracks.append(ImportedTrack(path=path))

    todo = [t for t in out.tracks if wanted(t.path) and Path(t.path).is_file()]

    def load(
        track: ImportedTrack,
    ) -> tuple[ImportedTrack, list[ImportedCue], GridSpec | None, bool]:
        try:
            cues, grid = read_file(Path(track.path))
            return track, cues, grid, True
        except (OSError, ValueError, struct.error, mutagen.MutagenError, binascii.Error):
            return track, [], None, False

    with ThreadPoolExecutor(max_workers=8) as pool:
        for i, (track, cues, grid, ok) in enumerate(pool.map(load, todo), 1):
            track.cues, track.grid = cues, grid
            if not ok:
                out.warnings.append(ImportWarning(code="unreadable_file", path=track.path))
            if i % 200 == 0:
                progress(i / len(todo))
    return out


def _flatten(nodes: list[ImportedPlaylist]) -> list[ImportedPlaylist]:
    out: list[ImportedPlaylist] = []
    for n in nodes:
        out.append(n)
        out += _flatten(n.children)
    return out
