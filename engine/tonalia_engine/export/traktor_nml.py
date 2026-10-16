"""Traktor ``collection.nml`` export (SPEC 2.12).

Unlike the other exports, this one edits a file Traktor owns, so it is conservative:

- it only runs with Traktor closed (Traktor rewrites the collection when it quits);
- the user's collection is parsed with ``defusedxml`` and everything Tonalia does not
  manage is kept (play counts, loudness, loops, cues in other slots, other playlists);
- for each exported track it sets the tempo, the key (``MUSICAL_KEY`` 0-11 major from C,
  12-23 minor from C, plus the ``INFO KEY`` text), one ``AutoGrid`` marker at the first
  downbeat and the hot cues of the slots Tonalia exports (``CUE_V2`` TYPE 0, times in
  milliseconds). Tracks missing from the collection are added;
- playlists go into a "Tonalia" folder at the top, replaced on every export;
- the previous file is copied to the backups folder and the new one written atomically.

Traktor has no cue colours in the NML (it colours cues by type), so colours are ignored.

With the ``gain`` option (SPEC 13.6) the ``LOUDNESS`` element gets Tonalia's measurement:
``PERCEIVED_DB`` and ``ANALYZED_DB`` hold the gain Traktor's auto gain applies and
``PEAK_DB`` the true peak. NI does not document them; this is how Traktor's own values and
the open-source tools that write them behave. The gain aims at -14 LUFS rather than
ReplayGain's -18 so the level in Traktor stays close to its own analysis (a quieter
reference would take 4 dB of every track and the DJ would have to make it up on the mixer).
"""

from __future__ import annotations

import re
import unicodedata
import uuid
import xml.etree.ElementTree as ET
from collections.abc import Callable
from pathlib import Path, PurePath, PureWindowsPath

import defusedxml.ElementTree as SafeET

from ..db import Database
from ..errors import CollectionNotFoundError, TonaliaError
from ..keys import format_key
from ..rpc_schema import ExportAction, ExportItem, ExportOptions, ExportResult, ExportWarning
from .common import (
    ExportPlaylist,
    ExportTrack,
    add_item,
    count_playlists,
    load_playlists,
    load_tracks,
    playlist_track_ids,
    process_running,
    write_with_backup,
)

FOLDER_NAME = "Tonalia"
DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="no" ?>\n'
TRAKTOR_REFERENCE_LUFS = -14.0
_VERSION = re.compile(r"Traktor(?: Pro)? (\d+(?:\.\d+)*)$", re.IGNORECASE)


class TraktorRunningError(TonaliaError, RuntimeError):
    reason = "program_running"


def traktor_running() -> bool:
    """Whether a Traktor process is running (checked before writing)."""
    return process_running("Traktor.*\\.app/Contents/MacOS", "traktor")


def root_volume_name() -> str:
    """Name Traktor gives the startup disk on macOS (e.g. "Macintosh HD")."""
    volumes = Path("/Volumes")
    try:
        for entry in volumes.iterdir():
            if entry.is_symlink() and entry.resolve() == Path("/"):
                return entry.name
    except OSError:
        pass
    return "Macintosh HD"


def find_collection(home: Path | None = None) -> Path | None:
    """Collection of the newest Traktor version under Documents/Native Instruments."""
    base = (home or Path.home()) / "Documents" / "Native Instruments"
    best: tuple[tuple[int, ...], Path] | None = None
    try:
        folders = list(base.iterdir())
    except OSError:
        return None
    for folder in folders:
        match = _VERSION.match(folder.name)
        candidate = folder / "collection.nml"
        if match and candidate.is_file():
            version = tuple(int(x) for x in match.group(1).split("."))
            if best is None or version > best[0]:
                best = (version, candidate)
    return best[1] if best else None


def _nfc(text: str) -> str:
    return unicodedata.normalize("NFC", text)


def nml_location(path: PurePath, root_volume: str) -> tuple[str, str, str]:
    """(VOLUME, DIR, FILE) as Traktor writes them: DIR uses "/:" as separator."""
    if isinstance(path, PureWindowsPath):
        volume, folders = path.drive, list(path.parts[1:-1])
    elif len(path.parts) > 3 and path.parts[1] == "Volumes":
        volume, folders = path.parts[2], list(path.parts[3:-1])
    else:
        volume, folders = root_volume, list(path.parts[1:-1])
    directory = "/:" + "".join(f"{part}/:" for part in folders)
    return _nfc(volume), _nfc(directory), _nfc(path.name)


def primary_key(path: PurePath, root_volume: str) -> str:
    volume, directory, name = nml_location(path, root_volume)
    return f"{volume}{directory}{name}"


def _ms(seconds: float) -> str:
    return f"{seconds * 1000:.6f}"


def _cue(name: str, cue_type: int, start: float, hotcue: int) -> ET.Element:
    return ET.Element(
        "CUE_V2",
        {
            "NAME": name,
            "DISPL_ORDER": "0",
            "TYPE": str(cue_type),
            "START": _ms(start),
            "LEN": "0.000000",
            "REPEATS": "-1",
            "HOTCUE": str(hotcue),
        },
    )


def _child(entry: ET.Element, tag: str, before: tuple[str, ...] = ("CUE_V2",)) -> ET.Element:
    """The entry's ``tag`` element, created before the first of ``before`` if missing."""
    found = entry.find(tag)
    if found is not None:
        return found
    element = ET.Element(tag)
    for i, child in enumerate(list(entry)):
        if child.tag in before:
            entry.insert(i, element)
            return element
    entry.append(element)
    return element


def _new_entry(track: ExportTrack, root_volume: str) -> ET.Element:
    entry = ET.Element("ENTRY", {"TITLE": track.display_title, "ARTIST": track.artist or ""})
    volume, directory, name = nml_location(track.path, root_volume)
    ET.SubElement(
        entry,
        "LOCATION",
        {"DIR": directory, "FILE": name, "VOLUME": volume, "VOLUMEID": volume},
    )
    if track.album:
        ET.SubElement(entry, "ALBUM", {"TITLE": track.album})
    info = {"BITRATE": str((track.bitrate or 0) * 1000)}
    if track.genre:
        info["GENRE"] = track.genre
    if track.duration:
        info |= {"PLAYTIME": str(int(track.duration)), "PLAYTIME_FLOAT": f"{track.duration:.6f}"}
    ET.SubElement(entry, "INFO", info)
    return entry


def _update_entry(entry: ET.Element, track: ExportTrack, options: ExportOptions) -> int:
    if options.key and track.key is not None:
        _child(entry, "INFO", ("TEMPO", "LOUDNESS", "MUSICAL_KEY", "CUE_V2")).set(
            "KEY", format_key(track.key, options.notation)
        )
        value = track.key.root + (12 if track.key.mode == "minor" else 0)
        _child(entry, "MUSICAL_KEY").set("VALUE", str(value))
    if options.beatgrid and track.grid is not None and track.bpm:
        tempo = _child(entry, "TEMPO", ("LOUDNESS", "MUSICAL_KEY", "CUE_V2"))
        tempo.set("BPM", f"{track.grid.bpm:.6f}")
        tempo.set("BPM_QUALITY", "100.000000")
        for old in [c for c in entry.findall("CUE_V2") if c.get("TYPE") == "4"]:
            entry.remove(old)
        entry.append(_cue("AutoGrid", 4, max(0.0, track.grid.first_downbeat), -1))
    if options.gain and track.loudness_lufs is not None and track.loudness_lufs > -70:
        gain = f"{TRAKTOR_REFERENCE_LUFS - track.loudness_lufs:.6f}"
        loudness = _child(entry, "LOUDNESS", ("MUSICAL_KEY", "CUE_V2"))
        loudness.set("PEAK_DB", f"{track.peak_db or 0.0:.6f}")
        loudness.set("PERCEIVED_DB", gain)
        loudness.set("ANALYZED_DB", gain)
    if not options.cues:
        return 0
    slots = {str(c.slot) for c in track.cues}
    for old in [c for c in entry.findall("CUE_V2") if c.get("HOTCUE") in slots]:
        entry.remove(old)
    for cue in track.cues:
        entry.append(_cue(cue.name, 0, cue.position, cue.slot))
    return len(track.cues)


def _playlist_node(playlist: ExportPlaylist, keys: dict[int, str]) -> ET.Element:
    if playlist.is_folder:
        node = ET.Element("NODE", {"TYPE": "FOLDER", "NAME": playlist.name})
        sub = ET.SubElement(node, "SUBNODES")
        for child in playlist.children:
            sub.append(_playlist_node(child, keys))
        sub.set("COUNT", str(len(sub)))
        return node
    node = ET.Element("NODE", {"TYPE": "PLAYLIST", "NAME": playlist.name})
    ids = [tid for tid in playlist.track_ids if tid in keys]
    body = ET.SubElement(
        node,
        "PLAYLIST",
        {"ENTRIES": str(len(ids)), "TYPE": "LIST", "UUID": uuid.uuid4().hex},
    )
    for tid in ids:
        item = ET.SubElement(body, "ENTRY")
        ET.SubElement(item, "PRIMARYKEY", {"TYPE": "TRACK", "KEY": keys[tid]})
    return node


def _write_playlists(
    root: ET.Element, playlists: list[ExportPlaylist], keys: dict[int, str]
) -> None:
    lists = root.find("PLAYLISTS")
    if lists is None:
        lists = ET.SubElement(root, "PLAYLISTS")
    top = next((n for n in lists.findall("NODE") if n.get("NAME") == "$ROOT"), None)
    if top is None:
        top = ET.SubElement(lists, "NODE", {"TYPE": "FOLDER", "NAME": "$ROOT"})
    sub = top.find("SUBNODES")
    if sub is None:
        sub = ET.SubElement(top, "SUBNODES")
    for old in [
        n for n in sub.findall("NODE") if n.get("TYPE") == "FOLDER" and n.get("NAME") == FOLDER_NAME
    ]:
        sub.remove(old)
    folder = ExportPlaylist(-1, FOLDER_NAME, True, [], playlists)
    sub.append(_playlist_node(folder, keys))
    sub.set("COUNT", str(len(sub.findall("NODE"))))


def export_traktor(
    db: Database,
    options: ExportOptions,
    backup_dir: Path,
    check_cancelled: Callable[[], None] = lambda: None,
) -> ExportResult:
    target = Path(options.path) if options.path else find_collection()
    if target is None or not target.is_file():
        raise CollectionNotFoundError(
            f"Traktor collection not found: {target}" if target else "Traktor collection not found",
            program="Traktor",
        )
    running = traktor_running()
    if running and not options.simulate:
        raise TraktorRunningError("Traktor is open: close it before exporting", program="Traktor")

    tree = SafeET.parse(target)
    root = tree.getroot()
    collection = root.find("COLLECTION")
    if collection is None:
        collection = ET.SubElement(root, "COLLECTION")
    index: dict[tuple[str, str], ET.Element] = {}
    for entry in collection.findall("ENTRY"):
        loc = entry.find("LOCATION")
        if loc is not None:
            index[(_nfc(loc.get("DIR", "")), _nfc(loc.get("FILE", "")))] = entry

    playlists = load_playlists(db, options.playlist_ids) if options.include_playlists else []
    if options.track_ids is None:
        selection: list[int] | None = None
    else:
        selection = list(dict.fromkeys([*options.track_ids, *playlist_track_ids(playlists)]))
    tracks = load_tracks(db, selection, options.language)
    volume = root_volume_name()

    warnings: list[ExportWarning] = []
    if running:
        warnings.append(ExportWarning(code="app_running"))
    keys: dict[int, str] = {}
    items: list[ExportItem] = []
    cue_total = 0
    for i, track in enumerate(tracks):
        if i % 500 == 0:
            check_cancelled()
        if not track.path.exists():
            warnings.append(
                ExportWarning(code="missing_file", track_id=track.id, path=str(track.path))
            )
        if track.status != "ready":
            warnings.append(ExportWarning(code="not_analyzed", track_id=track.id))
        _, directory, name = nml_location(track.path, volume)
        entry = index.get((directory, name))
        action: ExportAction = "updated" if entry is not None else "added"
        if entry is None:
            entry = _new_entry(track, volume)
            collection.append(entry)
            index[(directory, name)] = entry
        cues = _update_entry(entry, track, options)
        cue_total += cues
        add_item(items, track, action, cues)
        keys[track.id] = primary_key(track.path, volume)
    collection.set("ENTRIES", str(len(collection.findall("ENTRY"))))
    if options.include_playlists:
        _write_playlists(root, playlists, keys)

    backup: Path | None = None
    if not options.simulate:
        data = (DECLARATION + ET.tostring(root, encoding="unicode")).encode("utf-8")
        backup = write_with_backup(target, data, backup_dir)
    return ExportResult(
        target="traktor",
        simulated=options.simulate,
        path=str(target),
        tracks=len(keys),
        cues=cue_total,
        playlists=count_playlists(playlists),
        skipped=0,
        warnings=warnings,
        backup_path=str(backup) if backup is not None else None,
        items=items,
    )


def collection_status() -> tuple[Path | None, bool]:
    return find_collection(), traktor_running()
