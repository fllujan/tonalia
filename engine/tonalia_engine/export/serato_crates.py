"""Serato crates (SPEC 2.12): Tonalia's playlists as a "Tonalia" crate.

Written the way Serato DJ 4 writes its own (checked against a Serato DJ Lite 4 library):

- a crate is ``_Serato_/Subcrates/<name>.crate``, a list of records (4-byte ASCII tag,
  big-endian ``uint32`` length, data; text is UTF-16BE): ``vrsn`` "1.0/Serato ScratchLive
  Crate", one ``ovct`` per visible column (``tvcn`` name and ``tvcw`` width), then one
  ``otrk`` per track holding a ``ptrk`` with the file's path relative to the root of its
  drive (no leading slash);
- a subcrate's file name is its parents' names and its own joined by ``%%``
  (``Tonalia%%Bolos%%Warm-up.crate``), and the parent has a crate of its own;
- ``_Serato_/neworder.pref`` (UTF-16BE, LF) lists the crates in the order of the sidebar
  between ``[begin record]`` and ``[end record]``, one ``[crate]<file name>`` per line.

Like the "Tonalia" folder of the Traktor and VirtualDJ exports, the "Tonalia" crates are
replaced on every export after a copy into the backups folder; the DJ's crates are left
alone. Serato rewrites its crates when it quits, so they are only written while it is
closed (the hot cues, which live in the files, are written either way). The crates live in
the ``_Serato_`` folder of the user's music; tracks on another drive belong to that drive's
own ``_Serato_`` and are left out of them.
"""

from __future__ import annotations

import os
import re
import shutil
import struct
import time
import unicodedata
from collections.abc import Sequence
from pathlib import Path, PurePath

from ..fsutil import write_atomic
from .common import ExportPlaylist, ExportTrack, process_running

ROOT_CRATE = "Tonalia"
SEPARATOR = "%%"
CRATE_SUFFIX = ".crate"
ORDER_FILE = "neworder.pref"
BEGIN = "[begin record]"
END = "[end record]"
VERSION = "1.0/Serato ScratchLive Crate"
COLUMNS = [
    ("song", "250"),
    ("artist", "250"),
    ("bpm", "30"),
    ("key", "30"),
    ("album", "250"),
    ("length", "250"),
    ("comment", "250"),
]
UNSAFE_NAME = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


def serato_running() -> bool:
    return process_running("Serato DJ.*\\.app/Contents/MacOS", "serato")


def find_serato_folder() -> Path:
    """Serato's library folder (``Music/_Serato_`` on Mac and Windows)."""
    override = os.environ.get("TONALIA_SERATO_DIR")
    return Path(override) if override else Path.home() / "Music" / "_Serato_"


def _record(tag: bytes, data: bytes) -> bytes:
    return tag + struct.pack(">I", len(data)) + data


def _text(value: str) -> bytes:
    return value.encode("utf-16-be")


HEADER = _record(b"vrsn", _text(VERSION)) + b"".join(
    _record(b"ovct", _record(b"tvcn", _text(name)) + _record(b"tvcw", _text(width)))
    for name, width in COLUMNS
)


def crate_bytes(paths: Sequence[str]) -> bytes:
    """A crate with these files (absolute paths or already relative to their drive)."""
    body = b"".join(
        _record(b"otrk", _record(b"ptrk", _text(p.replace("\\", "/").lstrip("/")))) for p in paths
    )
    return HEADER + body


def _records(data: bytes) -> list[tuple[bytes, bytes]]:
    out: list[tuple[bytes, bytes]] = []
    i = 0
    while i + 8 <= len(data):
        (n,) = struct.unpack(">I", data[i + 4 : i + 8])
        out.append((data[i : i + 4], data[i + 8 : i + 8 + n]))
        i += 8 + n
    return out


def read_crate(data: bytes) -> list[str]:
    """The track paths of a crate, as Serato stores them."""
    return [
        value.decode("utf-16-be")
        for tag, body in _records(data)
        if tag == b"otrk"
        for inner, value in _records(body)
        if inner == b"ptrk"
    ]


def crate_names(names: list[str]) -> list[str]:
    """Names for the crates of one level: safe in a file name, without Serato's ``%%``
    separator and unique regardless of case."""
    taken: set[str] = set()
    out: list[str] = []
    for name in names:
        base = UNSAFE_NAME.sub("_", unicodedata.normalize("NFC", name))
        while SEPARATOR in base:
            base = base.replace(SEPARATOR, "%")
        base = base.strip().rstrip(".").strip() or "Playlist"
        candidate, n = base, 1
        while candidate.casefold() in taken:
            n += 1
            candidate = f"{base} ({n})"
        taken.add(candidate.casefold())
        out.append(candidate)
    return out


def _drive(path: PurePath) -> str:
    """Which drive a file lives on: its anchor on Windows, ``/Volumes/<name>`` on Mac."""
    if path.drive:
        return path.drive.lower()
    parts = path.parts
    if len(parts) > 2 and parts[1] == "Volumes":
        return "/".join(parts[:3])
    return "/"


def _relative(path: Path) -> str:
    """The path Serato stores: relative to the root of the drive, with forward slashes."""
    return PurePath(*path.parts[1:]).as_posix() if path.parts else ""


def plan_crates(
    playlists: list[ExportPlaylist], tracks: dict[int, ExportTrack], home_drive: str
) -> list[tuple[str, bytes]]:
    """``(file name without suffix, crate bytes)`` for the Tonalia crate and below it,
    parents before their children, in Tonalia's order."""
    out: list[tuple[str, bytes]] = [(ROOT_CRATE, crate_bytes([]))]

    def walk(prefix: str, nodes: list[ExportPlaylist]) -> None:
        for node, name in zip(nodes, crate_names([n.name for n in nodes]), strict=True):
            full = f"{prefix}{SEPARATOR}{name}"
            paths = [
                _relative(tracks[tid].path)
                for tid in node.track_ids
                if tid in tracks and _drive(tracks[tid].path) == home_drive
            ]
            out.append((full, crate_bytes(paths)))
            walk(full, node.children)

    walk(ROOT_CRATE, playlists)
    return out


def _ours(name: str) -> bool:
    return name == ROOT_CRATE or name.startswith(ROOT_CRATE + SEPARATOR)


def _order(folder: Path, names: list[str]) -> bytes:
    """Serato's sidebar order with the DJ's crates kept and Tonalia's at the end."""
    path = folder / ORDER_FILE
    lines = path.read_bytes().decode("utf-16-be").splitlines() if path.is_file() else []
    body = [
        line
        for line in lines
        if line not in (BEGIN, END) and not (line.startswith("[crate]") and _ours(line[7:]))
    ]
    out = [BEGIN, *body, *(f"[crate]{n}" for n in names), END]
    return "".join(f"{line}\n" for line in out).encode("utf-16-be")


def write_crates(
    folder: Path,
    playlists: list[ExportPlaylist],
    tracks: dict[int, ExportTrack],
    backup_dir: Path,
) -> None:
    """Replace the Tonalia crates in Serato's ``folder``, keeping a copy of the old ones."""
    subcrates = folder / "Subcrates"
    planned = plan_crates(playlists, tracks, _drive(folder))
    old = [p for p in subcrates.glob(f"*{CRATE_SUFFIX}") if _ours(p.name[: -len(CRATE_SUFFIX)])]
    order = folder / ORDER_FILE
    if old or order.is_file():
        stamp = time.strftime("%Y%m%d-%H%M%S")
        backup = backup_dir / f"{stamp}-Subcrates-{ROOT_CRATE}"
        n = 1
        while backup.exists():
            backup = backup_dir / f"{stamp}-{n}-Subcrates-{ROOT_CRATE}"
            n += 1
        backup.mkdir(parents=True)
        for path in old:
            shutil.copy2(path, backup / path.name)
        if order.is_file():
            shutil.copy2(order, backup / ORDER_FILE)
    subcrates.mkdir(parents=True, exist_ok=True)
    keep = {f"{name}{CRATE_SUFFIX}" for name, _ in planned}
    for name, data in planned:
        path = subcrates / f"{name}{CRATE_SUFFIX}"
        write_atomic(path, data, keep_mode_of=path, mode=0o644)
    for path in old:
        if path.name not in keep:
            path.unlink()
    write_atomic(
        order, _order(folder, [name for name, _ in planned]), keep_mode_of=order, mode=0o644
    )
