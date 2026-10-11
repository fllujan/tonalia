"""VirtualDJ ``database.xml`` export (SPEC 2.12).

Same precautions as for Traktor: VirtualDJ must be closed (it rewrites its database on
exit), the user's database is parsed with ``defusedxml`` and everything else is kept.
For each exported track Tonalia sets the ``Scan`` tempo (VirtualDJ stores the seconds
between two beats) and key, one ``Poi Type="beatgrid"`` at the first downbeat and the
hot cues of the exported slots (``Poi Type="cue"``, ``Num`` = slot + 1, seconds).
Missing tracks are added as new ``Song`` entries. VirtualDJ's cue colour encoding is not
documented, so colours are not written.
"""

from __future__ import annotations

import os
import unicodedata
import xml.etree.ElementTree as ET
from collections.abc import Callable
from pathlib import Path

import defusedxml.ElementTree as SafeET

from ..db import Database
from ..keys import format_key
from ..rpc_schema import ExportOptions, ExportResult, ExportWarning
from .common import ExportTrack, load_tracks, process_running, write_with_backup

DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>\n'


class VirtualDJRunningError(RuntimeError):
    pass


def virtualdj_running() -> bool:
    return process_running("VirtualDJ.*\\.app/Contents/MacOS", "virtualdj")


def find_database(home: Path | None = None) -> Path | None:
    """VirtualDJ's main database (newer versions keep it in Application Support on Mac)."""
    base = home or Path.home()
    for candidate in (
        base / "Library" / "Application Support" / "VirtualDJ" / "database.xml",
        base / "AppData" / "Local" / "VirtualDJ" / "database.xml",
        base / "Documents" / "VirtualDJ" / "database.xml",
    ):
        if candidate.is_file():
            return candidate
    return None


def _key(path: str) -> str:
    text = unicodedata.normalize("NFC", path)
    return text.lower() if os.name == "nt" else text


def _secs(value: float) -> str:
    return f"{value:.6f}"


def _new_song(track: ExportTrack) -> ET.Element:
    song = ET.Element("Song", {"FilePath": str(track.path), "FileSize": str(track.size or 0)})
    tags = {"Author": track.artist or "", "Title": track.display_title}
    if track.genre:
        tags["Genre"] = track.genre
    if track.album:
        tags["Album"] = track.album
    if track.year:
        tags["Year"] = str(track.year)
    ET.SubElement(song, "Tags", tags)
    infos = {"SongLength": f"{track.duration:.6f}"} if track.duration else {}
    if track.bitrate:
        infos["Bitrate"] = str(track.bitrate)
    ET.SubElement(song, "Infos", infos)
    return song


def _child(song: ET.Element, tag: str) -> ET.Element:
    found = song.find(tag)
    if found is not None:
        return found
    element = ET.Element(tag)
    pois = [i for i, c in enumerate(song) if c.tag == "Poi"]
    song.insert(pois[0] if pois else len(song), element)
    return element


def _update_song(song: ET.Element, track: ExportTrack, options: ExportOptions) -> int:
    if options.beatgrid and track.grid is not None and track.bpm:
        _child(song, "Scan").set("Bpm", _secs(60.0 / track.grid.bpm))
        for old in [p for p in song.findall("Poi") if p.get("Type") == "beatgrid"]:
            song.remove(old)
        ET.SubElement(
            song, "Poi", {"Pos": _secs(max(0.0, track.grid.first_downbeat)), "Type": "beatgrid"}
        )
    if options.key and track.key is not None:
        _child(song, "Scan").set("Key", format_key(track.key, options.notation))
    if not options.cues:
        return 0
    nums = {str(c.slot + 1) for c in track.cues}
    for old in [p for p in song.findall("Poi") if p.get("Type") == "cue" and p.get("Num") in nums]:
        song.remove(old)
    for cue in track.cues:
        ET.SubElement(
            song,
            "Poi",
            {"Name": cue.name, "Pos": _secs(cue.position), "Num": str(cue.slot + 1), "Type": "cue"},
        )
    return len(track.cues)


def export_virtualdj(
    db: Database,
    options: ExportOptions,
    backup_dir: Path,
    check_cancelled: Callable[[], None] = lambda: None,
) -> ExportResult:
    target = Path(options.path) if options.path else find_database()
    if target is None or not target.is_file():
        raise FileNotFoundError(
            f"VirtualDJ database not found: {target}" if target else "VirtualDJ database not found"
        )
    running = virtualdj_running()
    if running and not options.simulate:
        raise VirtualDJRunningError("VirtualDJ is open: close it before exporting")

    root = SafeET.parse(target).getroot()
    index = {_key(s.get("FilePath", "")): s for s in root.findall("Song")}
    tracks = load_tracks(db, options.track_ids, options.language)
    warnings: list[ExportWarning] = [ExportWarning(code="app_running")] if running else []
    cue_total = exported = 0
    for i, track in enumerate(tracks):
        if i % 500 == 0:
            check_cancelled()
        if not track.path.exists():
            warnings.append(
                ExportWarning(code="missing_file", track_id=track.id, path=str(track.path))
            )
        if track.status != "ready":
            warnings.append(ExportWarning(code="not_analyzed", track_id=track.id))
        song = index.get(_key(str(track.path)))
        if song is None:
            song = _new_song(track)
            root.append(song)
            index[_key(str(track.path))] = song
        cue_total += _update_song(song, track, options)
        exported += 1

    backup: Path | None = None
    if not options.simulate:
        data = (DECLARATION + ET.tostring(root, encoding="unicode")).encode("utf-8")
        backup = write_with_backup(target, data, backup_dir)
    return ExportResult(
        target="virtualdj",
        simulated=options.simulate,
        path=str(target),
        tracks=exported,
        cues=cue_total,
        playlists=0,
        skipped=0,
        warnings=warnings,
        backup_path=str(backup) if backup is not None else None,
    )


def database_status() -> tuple[Path | None, bool]:
    return find_database(), virtualdj_running()
