"""Read VirtualDJ's ``database.xml`` and My Lists (SPEC 13.1), as ``export/virtualdj.py``
writes them.

- ``Song FilePath``; ``Tags`` (``Title``, ``Author``, ``Stars`` 0-5), ``Infos PlayCount``,
  ``Comment``; ``Scan Bpm`` is the seconds between two beats and ``Key`` the key text;
- ``Poi``: ``Type="beatgrid"`` marks a downbeat; ``Type="cue"`` with ``Num`` 1-8 is a hot
  cue (pad ``Num``), any other cue is kept without a pad; ``Type="loop"`` has its length
  in ``Size`` (beats). Their colours are not documented, so none are read;
- lists: ``MyLists/<name>.vdjfolder`` with one ``<song path=…>`` per track; a folder is an
  empty ``.vdjfolder`` with a ``<name>.subfolders`` folder beside it, ordered by ``order``.
"""

from __future__ import annotations

from pathlib import Path

import defusedxml.ElementTree as SafeET

from ..export.virtualdj import (
    LIST_SUFFIX,
    LISTS_DIR,
    ORDER_FILE,
    SUBFOLDERS_SUFFIX,
    read_database,
)
from ..keys import parse_key
from ..rpc_schema import ImportWarning
from .model import (
    OWN_FOLDER,
    ImportedCollection,
    ImportedCue,
    ImportedPlaylist,
    ImportedTrack,
    constant_grid,
)
from .rekordbox import _float, _int


def _list_paths(file: Path) -> list[str]:
    try:
        root = SafeET.fromstring(file.read_bytes())
    except (OSError, SafeET.ParseError):
        return []
    return [s.get("path", "") for s in root.iter("song") if s.get("path")]


def _lists(folder: Path, top: bool, warnings: list[ImportWarning]) -> list[ImportedPlaylist]:
    names = [p.name[: -len(LIST_SUFFIX)] for p in folder.glob(f"*{LIST_SUFFIX}")]
    order_file = folder / ORDER_FILE
    order = (
        order_file.read_bytes().decode("utf-8", "replace").splitlines()
        if order_file.is_file()
        else []
    )
    names = [n for n in order if n in names] + sorted(
        (n for n in names if n not in order), key=str.casefold
    )
    out: list[ImportedPlaylist] = []
    for name in names:
        sub = folder / f"{name}{SUBFOLDERS_SUFFIX}"
        if top and name == OWN_FOLDER:
            warnings.append(ImportWarning(code="own_folder_skipped"))
            continue
        if sub.is_dir():
            out.append(ImportedPlaylist(name, True, children=_lists(sub, False, warnings)))
        else:
            out.append(ImportedPlaylist(name, False, _list_paths(folder / f"{name}{LIST_SUFFIX}")))
    return out


def read(path: Path) -> ImportedCollection:
    root = read_database(path)
    out = ImportedCollection("virtualdj", path)
    for song in root.findall("Song"):
        file_path = song.get("FilePath")
        if not file_path:
            continue
        tags = song.find("Tags")
        infos = song.find("Infos")
        scan = song.find("Scan")
        comment = song.find("Comment")
        spb = _float(scan.get("Bpm")) if scan is not None else None
        bpm = 60.0 / spb if spb and spb > 0 else None
        cues: list[ImportedCue] = []
        downbeat: float | None = None
        for poi in song.findall("Poi"):
            pos = _float(poi.get("Pos"))
            if pos is None or pos < 0:
                continue
            kind = poi.get("Type") or "cue"
            name = poi.get("Name") or None
            num = _int(poi.get("Num"))
            if kind == "beatgrid":
                downbeat = pos if downbeat is None else min(downbeat, pos)
            elif kind == "cue":
                if num is not None and 1 <= num <= 8:
                    cues.append(ImportedCue("hot", pos, slot=num - 1, name=name))
                else:
                    cues.append(ImportedCue("memory", pos, name=name))
            elif kind == "loop" and bpm:
                beats = _float(poi.get("Size"))
                if beats and beats > 0:
                    cues.append(ImportedCue("loop", pos, length=beats * 60.0 / bpm, name=name))
        out.tracks.append(
            ImportedTrack(
                path=file_path,
                title=(tags.get("Title") or None) if tags is not None else None,
                artist=(tags.get("Author") or None) if tags is not None else None,
                size=_int(song.get("FileSize")) or None,
                key=parse_key(scan.get("Key", "")) if scan is not None else None,
                bpm=round(bpm, 4) if bpm else None,
                grid=constant_grid(bpm, downbeat) if bpm and downbeat is not None else None,
                rating=(_int(tags.get("Stars")) or None) if tags is not None else None,
                play_count=(_int(infos.get("PlayCount")) or None) if infos is not None else None,
                comment=(comment.text or "").strip() or None if comment is not None else None,
                cues=cues,
            )
        )
    lists = path.parent / LISTS_DIR
    if lists.is_dir():
        out.playlists = _lists(lists, True, out.warnings)
    return out
