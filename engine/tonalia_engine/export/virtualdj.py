"""VirtualDJ ``database.xml`` export (SPEC 2.12).

Same precautions as for Traktor: VirtualDJ must be closed (it rewrites its database on
exit), the user's database is parsed with ``defusedxml`` and everything else is kept.
For each exported track Tonalia sets the ``Scan`` tempo (VirtualDJ stores the seconds
between two beats) and key, one ``Poi Type="beatgrid"`` at the first downbeat and the
hot cues of the exported slots (``Poi Type="cue"``, ``Num`` = slot + 1, seconds).
Missing tracks are added as new ``Song`` entries. VirtualDJ's cue colour encoding is not
documented, so colours are not written.

Playlists become VirtualDJ lists (``.vdjfolder``, one ``<song>`` per track with its absolute
path and size, VirtualDJ's wiki "Lists") in a "Tonalia" folder of ``MyLists``, next to the
database; Tonalia's folders become subfolders. Like the "Tonalia" folder of the Traktor
export, it is replaced on every export, after a copy into the backups folder; the DJ's own
lists are not touched.

The file is written back the way VirtualDJ writes it (``serialize``): one element per line,
one space of indent per level, CRLF and ``&apos;``/``&quot;`` in attributes. VirtualDJ reads
its database line by line: a valid XML file laid out differently (``ElementTree`` puts new
songs on one line) is reported as corrupt and reset to an empty database.
"""

from __future__ import annotations

import os
import re
import shutil
import time
import unicodedata
import xml.etree.ElementTree as ET
from collections.abc import Callable
from pathlib import Path

import defusedxml.ElementTree as SafeET

from ..db import Database
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

DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>'
NEWLINE = "\r\n"
CLOSING_TAG = b"</VirtualDJ_Database>"
LISTS_DIR = "MyLists"
LISTS_FOLDER = "Tonalia"
LIST_SUFFIX = ".vdjfolder"
# Characters Windows and macOS do not allow in file names, plus control characters.
UNSAFE_NAME = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


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


def read_database(path: Path) -> ET.Element:
    """Parse VirtualDJ's database, ignoring what VirtualDJ leaves after it.

    VirtualDJ saves in place without truncating the file: when the new database is shorter,
    a NUL and the tail of the old one follow the closing tag (VirtualDJ reads it fine, an XML
    parser does not). Everything past the first closing tag is dropped.
    """
    raw = path.read_bytes()
    end = raw.find(CLOSING_TAG)
    if end != -1:
        raw = raw[: end + len(CLOSING_TAG)]
    root: ET.Element = SafeET.fromstring(raw)
    return root


def _escape(value: str, quote: bool) -> str:
    text = value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    if quote:
        text = text.replace('"', "&quot;").replace("'", "&apos;")
        text = text.replace("\r", "&#13;").replace("\n", "&#10;").replace("\t", "&#9;")
    return text


def _lines(element: ET.Element, depth: int) -> list[str]:
    indent = " " * depth
    attrs = "".join(f' {k}="{_escape(v, True)}"' for k, v in element.attrib.items())
    children = list(element)
    text = (element.text or "").strip()
    if not children and not text:
        return [f"{indent}<{element.tag}{attrs} />"]
    if not children:
        return [f"{indent}<{element.tag}{attrs}>{_escape(text, False)}</{element.tag}>"]
    lines = [f"{indent}<{element.tag}{attrs}>"]
    for child in children:
        lines.extend(_lines(child, depth + 1))
    lines.append(f"{indent}</{element.tag}>")
    return lines


def serialize(root: ET.Element) -> str:
    """The database in VirtualDJ's own layout (see the module docstring)."""
    attrs = "".join(f' {k}="{_escape(v, True)}"' for k, v in root.attrib.items())
    lines = [DECLARATION, f"<{root.tag}{attrs}>"]
    for child in root:
        lines.extend(_lines(child, 1))
    lines.append(f"</{root.tag}>")
    return NEWLINE.join(lines) + NEWLINE


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


def list_file_names(names: list[str]) -> list[str]:
    """File names (without suffix) for lists in one folder: safe on every system and unique
    regardless of case (macOS and Windows file systems ignore it)."""
    taken: set[str] = set()
    out: list[str] = []
    for name in names:
        base = UNSAFE_NAME.sub("_", unicodedata.normalize("NFC", name)).strip().rstrip(".")
        base = base.strip() or "Playlist"
        candidate, n = base, 1
        while candidate.casefold() in taken:
            n += 1
            candidate = f"{base} ({n})"
        taken.add(candidate.casefold())
        out.append(candidate)
    return out


def _bpm(value: float) -> str:
    return f"{value:.3f}".rstrip("0").rstrip(".")


def _list_xml(track_ids: list[int], tracks: dict[int, ExportTrack], options: ExportOptions) -> str:
    lines = [DECLARATION, '<VirtualFolder noDuplicates="no" ordered="yes">']
    for idx, tid in enumerate(t for t in track_ids if t in tracks):
        track = tracks[tid]
        size = track.size
        if track.path.is_file():
            size = track.path.stat().st_size
        attrs = {"path": str(track.path)}
        if size:
            attrs["size"] = str(size)
        if track.duration:
            attrs["songlength"] = f"{track.duration:.1f}"
        if track.bpm:
            attrs["bpm"] = _bpm(track.bpm)
        if options.key and track.key is not None:
            attrs["key"] = format_key(track.key, options.notation)
        if track.artist:
            attrs["artist"] = track.artist
        attrs["title"] = track.display_title
        attrs["idx"] = str(idx)
        text = "".join(f' {k}="{_escape(v, True)}"' for k, v in attrs.items())
        lines.append(f"\t<song{text} />")
    lines.append("</VirtualFolder>")
    return NEWLINE.join(lines) + NEWLINE


def _write_list_tree(
    folder: Path,
    playlists: list[ExportPlaylist],
    tracks: dict[int, ExportTrack],
    options: ExportOptions,
) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    folders = [p for p in playlists if p.is_folder]
    lists = [p for p in playlists if not p.is_folder]
    for playlist, name in zip(folders, list_file_names([p.name for p in folders]), strict=True):
        _write_list_tree(folder / name, playlist.children, tracks, options)
    # A list and a folder of the same name can live side by side (the list has a suffix).
    for playlist, name in zip(lists, list_file_names([p.name for p in lists]), strict=True):
        data = _list_xml(playlist.track_ids, tracks, options).encode("utf-8")
        (folder / f"{name}{LIST_SUFFIX}").write_bytes(data)


def write_lists(
    lists_dir: Path,
    playlists: list[ExportPlaylist],
    tracks: dict[int, ExportTrack],
    options: ExportOptions,
    backup_dir: Path,
) -> None:
    """Replace ``lists_dir/Tonalia`` with the playlists, keeping a copy of the old one.

    The new folder is built beside it and swapped in, so VirtualDJ never sees half of it.
    """
    target = lists_dir / LISTS_FOLDER
    staging = lists_dir / f".{LISTS_FOLDER}-{os.getpid()}-new"
    old = lists_dir / f".{LISTS_FOLDER}-{os.getpid()}-old"
    for leftover in (staging, old):
        shutil.rmtree(leftover, ignore_errors=True)
    try:
        _write_list_tree(staging, playlists, tracks, options)
        if target.exists():
            backup_dir.mkdir(parents=True, exist_ok=True)
            stamp = time.strftime("%Y%m%d-%H%M%S")
            backup = backup_dir / f"{stamp}-{LISTS_DIR}-{LISTS_FOLDER}"
            n = 1
            while backup.exists():
                backup = backup_dir / f"{stamp}-{n}-{LISTS_DIR}-{LISTS_FOLDER}"
                n += 1
            shutil.copytree(target, backup)
            target.rename(old)
        staging.rename(target)
    finally:
        shutil.rmtree(staging, ignore_errors=True)
    shutil.rmtree(old, ignore_errors=True)


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

    root = read_database(target)
    index = {_key(s.get("FilePath", "")): s for s in root.findall("Song")}
    playlists = load_playlists(db, options.playlist_ids) if options.include_playlists else []
    if options.track_ids is None:
        selection: list[int] | None = None
    else:
        selection = list(dict.fromkeys([*options.track_ids, *playlist_track_ids(playlists)]))
    tracks = load_tracks(db, selection, options.language)
    warnings: list[ExportWarning] = [ExportWarning(code="app_running")] if running else []
    cue_total = exported = 0
    items: list[ExportItem] = []
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
        action: ExportAction = "updated" if song is not None else "added"
        if song is None:
            song = _new_song(track)
            root.append(song)
            index[_key(str(track.path))] = song
        cues = _update_song(song, track, options)
        cue_total += cues
        add_item(items, track, action, cues)
        exported += 1

    backup: Path | None = None
    if not options.simulate:
        data = serialize(root).encode("utf-8")
        backup = write_with_backup(target, data, backup_dir)
        if options.include_playlists:
            by_id = {t.id: t for t in tracks}
            write_lists(target.parent / LISTS_DIR, playlists, by_id, options, backup_dir)
    return ExportResult(
        target="virtualdj",
        simulated=options.simulate,
        path=str(target),
        tracks=exported,
        cues=cue_total,
        playlists=count_playlists(playlists),
        skipped=0,
        warnings=warnings,
        backup_path=str(backup) if backup is not None else None,
        items=items,
    )


def database_status() -> tuple[Path | None, bool]:
    return find_database(), virtualdj_running()
