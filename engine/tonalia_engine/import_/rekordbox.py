"""Read a ``rekordbox.xml`` (File → Export Collection in xml format) — SPEC 13.1.

The same public ``DJ_PLAYLISTS`` format Tonalia exports (``export/rekordbox_xml.py``):

- ``TRACK``: ``Location`` (``file://localhost/`` URL), ``Tonality``, ``AverageBpm``,
  ``Rating`` (0, 51, 102, 153, 204, 255), ``PlayCount``, ``Comments``;
- ``TEMPO`` (``Inizio`` seconds, ``Bpm``, ``Battito`` = beat of the bar at that point): one
  entry for a steady tempo, several when it changes;
- ``POSITION_MARK``: ``Num`` 0-7 hot cue, -1 memory cue; ``Type`` 0 cue, 4 loop (``End``);
  colour in ``Red``/``Green``/``Blue``. A hot loop keeps its pad as a hot cue and is also
  imported as a loop;
- ``PLAYLISTS``: ``NODE Type="0"`` folder, ``Type="1"`` playlist whose ``TRACK`` children
  point at a ``TrackID`` (``KeyType`` 0) or a ``Location`` (``KeyType`` 1).
"""

from __future__ import annotations

import math
import xml.etree.ElementTree as ET
from itertools import pairwise
from pathlib import Path, PureWindowsPath
from urllib.parse import unquote, urlparse

import defusedxml.ElementTree as SafeET

from ..keys import parse_key
from ..rpc_schema import GridSpec, ImportWarning
from .model import (
    OWN_FOLDER,
    ImportedCollection,
    ImportedCue,
    ImportedPlaylist,
    ImportedTrack,
    anchored_grid,
    stars,
)


def local_path(location: str) -> str:
    """The file path of a ``Location`` URL (Windows paths keep their drive letter)."""
    parsed = urlparse(location)
    raw = unquote(parsed.path if parsed.scheme else location)
    if len(raw) > 2 and raw[0] == "/" and raw[2] == ":":  # /C:/Music/…
        return str(PureWindowsPath(raw[1:]))
    return raw


def _float(value: str | None) -> float | None:
    try:
        out = float(value) if value not in (None, "") else None
    except ValueError:
        return None
    return out if out is not None and math.isfinite(out) else None


def _int(value: str | None) -> int | None:
    number = _float(value)
    return int(number) if number is not None else None


def grid(entries: list[ET.Element]) -> GridSpec | None:
    """The beatgrid of a track's ``TEMPO`` entries."""
    points: list[tuple[float, float, int]] = []
    for e in entries:
        start, bpm = _float(e.get("Inizio")), _float(e.get("Bpm"))
        if start is None or not bpm or bpm <= 0:
            continue
        points.append((start, bpm, _int(e.get("Battito")) or 1))
    if not points:
        return None
    points.sort()
    start, bpm, beat_in_bar = points[0]
    # The first downbeat at or after the first entry; beats counted from it.
    to_downbeat = (5 - beat_in_bar) % 4
    downbeat = start + to_downbeat * 60.0 / bpm
    pins: list[tuple[int, float]] = [(0, downbeat)]
    beat = -to_downbeat
    for (t0, b0, _), (t1, _, _) in pairwise(points):
        beat += max(1, round((t1 - t0) * b0 / 60.0))
        if beat > 0 and t1 > pins[-1][1]:
            pins.append((beat, t1))
    return anchored_grid(pins, points[-1][1])


def _color(mark: ET.Element) -> str | None:
    rgb = [_int(mark.get(c)) for c in ("Red", "Green", "Blue")]
    if any(c is None for c in rgb):
        return None
    return "#" + "".join(f"{max(0, min(255, c or 0)):02X}" for c in rgb)


def cues(marks: list[ET.Element]) -> list[ImportedCue]:
    out: list[ImportedCue] = []
    for mark in marks:
        start = _float(mark.get("Start"))
        if start is None or start < 0:
            continue
        num = _int(mark.get("Num"))
        name = mark.get("Name") or None
        color = _color(mark)
        end = _float(mark.get("End"))
        if mark.get("Type") == "4" and end is not None and end > start:
            out.append(ImportedCue("loop", start, length=end - start, name=name, color=color))
        if num is not None and 0 <= num <= 7:
            out.append(ImportedCue("hot", start, slot=num, name=name, color=color))
        elif mark.get("Type") != "4":
            out.append(ImportedCue("memory", start, name=name, color=color))
    return out


def _playlists(
    node: ET.Element, by_id: dict[str, str], top: bool, warnings: list[ImportWarning]
) -> list[ImportedPlaylist]:
    out: list[ImportedPlaylist] = []
    for child in node.findall("NODE"):
        name = child.get("Name") or ""
        if child.get("Type") == "0":
            if top and name == OWN_FOLDER:
                warnings.append(ImportWarning(code="own_folder_skipped"))
                continue
            out.append(
                ImportedPlaylist(name, True, children=_playlists(child, by_id, False, warnings))
            )
            continue
        paths: list[str] = []
        by_location = child.get("KeyType") == "1"
        for item in child.findall("TRACK"):
            key = item.get("Key") or ""
            path = local_path(key) if by_location else by_id.get(key)
            if path:
                paths.append(path)
        out.append(ImportedPlaylist(name, False, paths))
    return out


def read(path: Path) -> ImportedCollection:
    root = SafeET.fromstring(path.read_bytes())
    out = ImportedCollection("rekordbox", path)
    by_id: dict[str, str] = {}
    collection = root.find("COLLECTION")
    for el in collection.findall("TRACK") if collection is not None else []:
        location = el.get("Location")
        if not location:
            continue
        file_path = local_path(location)
        by_id[el.get("TrackID", "")] = file_path
        bpm = _float(el.get("AverageBpm"))
        out.tracks.append(
            ImportedTrack(
                path=file_path,
                title=el.get("Name") or None,
                artist=el.get("Artist") or None,
                size=_int(el.get("Size")) or None,
                key=parse_key(el.get("Tonality") or ""),
                bpm=bpm if bpm and bpm > 0 else None,
                grid=grid(el.findall("TEMPO")),
                rating=stars(_float(el.get("Rating")) or 0, 255),
                play_count=_int(el.get("PlayCount")) or None,
                comment=el.get("Comments") or None,
                cues=cues(el.findall("POSITION_MARK")),
            )
        )
    lists = root.find("PLAYLISTS")
    top = lists.find("NODE") if lists is not None else None
    if top is not None:
        out.playlists = _playlists(top, by_id, True, out.warnings)
    return out
