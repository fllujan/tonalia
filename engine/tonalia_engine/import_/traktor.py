"""Read Traktor's ``collection.nml`` (SPEC 13.1), the file ``export/traktor_nml.py`` edits.

- ``LOCATION`` (``VOLUME``, ``DIR`` with ``/:`` separators, ``FILE``) → a path: a drive
  letter on Windows, the startup disk or ``/Volumes/<name>`` on macOS;
- ``INFO``: ``RANKING`` (0-255), ``PLAYCOUNT``, ``COMMENT``, ``KEY``; ``MUSICAL_KEY`` (0-11
  major from C, 12-23 minor) wins over the text; ``TEMPO BPM``;
- ``CUE_V2`` (``START``/``LEN`` in milliseconds): ``TYPE`` 4 is the grid marker (a
  downbeat), 5 a loop, the rest cues; ``HOTCUE`` 0-7 is the pad, -1 a cue without pad;
- ``PLAYLISTS``: folders and playlists under ``$ROOT``, entries by ``PRIMARYKEY``
  (``VOLUME/:DIR…/:FILE``). Smart playlists are left out.

Traktor writes no cue colours (it colours cues by type).
"""

from __future__ import annotations

import re
import unicodedata
import xml.etree.ElementTree as ET
from pathlib import Path, PureWindowsPath

import defusedxml.ElementTree as SafeET

from ..export.traktor_nml import root_volume_name
from ..keys import Key, parse_key
from ..rpc_schema import ImportWarning
from .model import (
    OWN_FOLDER,
    ImportedCollection,
    ImportedCue,
    ImportedPlaylist,
    ImportedTrack,
    anchored_grid,
    constant_grid,
    stars,
)
from .rekordbox import _float, _int

_DRIVE = re.compile(r"^[A-Za-z]:$")


def location_path(volume: str, directory: str, name: str, root_volume: str) -> str:
    folders = [unicodedata.normalize("NFC", p) for p in directory.split("/:") if p]
    name = unicodedata.normalize("NFC", name)
    if _DRIVE.match(volume):
        return str(PureWindowsPath(volume + "\\", *folders, name))
    if volume == root_volume or not volume:
        return "/" + "/".join([*folders, name])
    return "/" + "/".join(["Volumes", volume, *folders, name])


def primary_key_path(key: str, root_volume: str) -> str | None:
    """The path of a playlist entry's ``PRIMARYKEY`` (``Macintosh HD/:Users/:a.mp3``)."""
    parts = key.split("/:")
    if len(parts) < 2:
        return None
    return location_path(parts[0], "/:".join(["", *parts[1:-1], ""]), parts[-1], root_volume)


def _key(entry: ET.Element, info: ET.Element | None) -> Key | None:
    musical = entry.find("MUSICAL_KEY")
    value = _int(musical.get("VALUE")) if musical is not None else None
    if value is not None and 0 <= value <= 23:
        return Key(value % 12, "minor" if value >= 12 else "major")
    return parse_key(info.get("KEY", "")) if info is not None else None


def _cues_and_grid(entry: ET.Element) -> tuple[list[ImportedCue], list[float]]:
    out: list[ImportedCue] = []
    grid_marks: list[float] = []
    for cue in entry.findall("CUE_V2"):
        start = _float(cue.get("START"))
        if start is None or start < 0:
            continue
        seconds = start / 1000.0
        kind = cue.get("TYPE")
        hotcue = _int(cue.get("HOTCUE"))
        name = cue.get("NAME") or None
        if name in ("n.n.", "AutoGrid"):  # Traktor's placeholder names
            name = None
        if kind == "4":
            grid_marks.append(seconds)
            continue
        length = (_float(cue.get("LEN")) or 0.0) / 1000.0
        if kind == "5" and length > 0:
            out.append(ImportedCue("loop", seconds, length=length, name=name))
        if hotcue is not None and 0 <= hotcue <= 7:
            out.append(ImportedCue("hot", seconds, slot=hotcue, name=name))
        elif kind != "5":
            out.append(ImportedCue("memory", seconds, name=name))
    return out, sorted(grid_marks)


def _playlists(
    nodes: ET.Element | None, root_volume: str, top: bool, warnings: list[ImportWarning]
) -> list[ImportedPlaylist]:
    out: list[ImportedPlaylist] = []
    for node in nodes.findall("NODE") if nodes is not None else []:
        name = node.get("NAME") or ""
        if node.get("TYPE") == "FOLDER":
            if top and name == OWN_FOLDER:
                warnings.append(ImportWarning(code="own_folder_skipped"))
                continue
            children = _playlists(node.find("SUBNODES"), root_volume, False, warnings)
            out.append(ImportedPlaylist(name, True, children=children))
        elif node.get("TYPE") == "PLAYLIST":
            body = node.find("PLAYLIST")
            paths = []
            for item in body.findall("ENTRY") if body is not None else []:
                key = item.find("PRIMARYKEY")
                path = (
                    primary_key_path(key.get("KEY", ""), root_volume) if key is not None else None
                )
                if path:
                    paths.append(path)
            out.append(ImportedPlaylist(name, False, paths))
    return out


def read(path: Path, root_volume: str | None = None) -> ImportedCollection:
    volume = root_volume or root_volume_name()
    root = SafeET.fromstring(path.read_bytes())
    out = ImportedCollection("traktor", path)
    collection = root.find("COLLECTION")
    for entry in collection.findall("ENTRY") if collection is not None else []:
        loc = entry.find("LOCATION")
        if loc is None or not loc.get("FILE"):
            continue
        info = entry.find("INFO")
        tempo = entry.find("TEMPO")
        bpm = _float(tempo.get("BPM")) if tempo is not None else None
        bpm = bpm if bpm and bpm > 0 else None
        cues, marks = _cues_and_grid(entry)
        grid = None
        if bpm and len(marks) == 1:
            grid = constant_grid(bpm, marks[0])
        elif bpm and marks:
            # Traktor keeps one tempo; further grid markers pin the beat where they are.
            pins = [(0, marks[0])]
            for t in marks[1:]:
                beat = round((t - marks[0]) * bpm / 60.0)
                if beat > pins[-1][0]:
                    pins.append((beat, t))
            grid = anchored_grid(pins, bpm)
        out.tracks.append(
            ImportedTrack(
                path=location_path(
                    loc.get("VOLUME", ""), loc.get("DIR", ""), loc.get("FILE", ""), volume
                ),
                title=entry.get("TITLE") or None,
                artist=entry.get("ARTIST") or None,
                key=_key(entry, info),
                bpm=bpm,
                grid=grid,
                rating=stars(_float(info.get("RANKING")) or 0, 255) if info is not None else None,
                play_count=(_int(info.get("PLAYCOUNT")) or None) if info is not None else None,
                comment=(info.get("COMMENT") or None) if info is not None else None,
                cues=cues,
            )
        )
    lists = root.find("PLAYLISTS")
    top = (
        next((n for n in lists.findall("NODE") if n.get("NAME") == "$ROOT"), None)
        if lists is not None
        else None
    )
    if top is not None:
        out.playlists = _playlists(top.find("SUBNODES"), volume, True, out.warnings)
    return out
