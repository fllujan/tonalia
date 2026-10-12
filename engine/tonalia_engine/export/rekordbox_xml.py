"""rekordbox.xml export (SPEC 2.12) in the public ``DJ_PLAYLISTS`` format.

The user imports it from Rekordbox's preferences (Advanced → Database → rekordbox xml)
and drags tracks or playlists from the "rekordbox xml" tree into the collection. Each
track carries:

- ``TEMPO`` beatgrid entries: one for a constant tempo (first downbeat, ``Battito`` 1),
  or one per bar for a variable tempo;
- ``POSITION_MARK`` hot cues (``Num`` 0-7) with name and colour, optionally repeated as
  memory cues (``Num`` -1);
- ``Tonality`` in the chosen notation (classical by default, what Rekordbox writes).

Playlists keep their folders; smart playlists are written with their current matches.
OGG Vorbis is left out: Rekordbox cannot play it.
"""

from __future__ import annotations

import xml.etree.ElementTree as ET
from collections.abc import Callable
from pathlib import Path, PurePath, PureWindowsPath
from urllib.parse import quote

from .. import __version__
from ..analysis.structure import downbeats
from ..analysis.tempo import BeatGrid
from ..db import Database
from ..keys import format_key
from ..rpc_schema import ExportItem, ExportOptions, ExportResult, ExportWarning
from .common import (
    ExportPlaylist,
    ExportTrack,
    add_item,
    count_playlists,
    load_playlists,
    load_tracks,
    playlist_track_ids,
    rgb,
    write_with_backup,
)

KINDS = {
    "mp3": "MP3 File",
    "wav": "WAV File",
    "wave": "WAV File",
    "aif": "AIFF File",
    "aiff": "AIFF File",
    "m4a": "M4A File",
    "mp4": "M4A File",
    "aac": "AAC File",
    "flac": "FLAC File",
}
UNSUPPORTED = frozenset({"ogg", "oga"})


def location(path: PurePath) -> str:
    """``file://localhost/...`` URL with the path percent-encoded as UTF-8."""
    posix = path.as_posix()
    if isinstance(path, PureWindowsPath) or not posix.startswith("/"):
        posix = "/" + posix
    return "file://localhost" + quote(posix, safe="/:")


def _fmt(value: float, decimals: int) -> str:
    return f"{value:.{decimals}f}"


def tempo_entries(grid: BeatGrid, duration: float) -> list[tuple[float, float]]:
    """(start, bpm) per TEMPO entry: one for a constant grid, one per bar otherwise."""
    if grid.kind != "variable" or not grid.beats:
        return [(max(0.0, grid.first_downbeat), grid.bpm)]
    beats = sorted(grid.beats)
    bars = [float(b) for b in downbeats(grid, duration)]
    out: list[tuple[float, float]] = []
    for i, start in enumerate(bars):
        end = bars[i + 1] if i + 1 < len(bars) else None
        inside = [b for b in beats if b >= start - 1e-6 and (end is None or b < end - 1e-6)]
        if end is not None and inside:
            interval = (end - start) / len(inside)
        elif len(inside) >= 2:
            interval = (inside[-1] - inside[0]) / (len(inside) - 1)
        else:
            interval = 60.0 / grid.bpm
        out.append((start, 60.0 / interval))
    return out


def _track_element(
    track: ExportTrack, options: ExportOptions, warnings: list[ExportWarning]
) -> tuple[ET.Element, int]:
    attrs = {
        "TrackID": str(track.id),
        "Name": track.display_title,
        "Artist": track.artist or "",
        "Album": track.album or "",
        "Genre": track.genre or "",
        "Kind": KINDS.get((track.format or track.path.suffix.lstrip(".")).lower(), "Audio File"),
        "Size": str(track.size or 0),
        "TotalTime": str(int(track.duration or 0)),
        "Year": str(track.year or ""),
        "AverageBpm": _fmt(track.bpm, 2) if track.bpm else "0.00",
        "DateAdded": track.added_at[:10],
        "BitRate": str(track.bitrate or 0),
        "SampleRate": str(track.sample_rate or 0),
        "Comments": track.comment or "",
        "Label": track.label or "",
        "Location": location(track.path),
    }
    if options.key and track.key is not None:
        attrs["Tonality"] = format_key(track.key, options.notation)
    el = ET.Element("TRACK", attrs)
    if options.beatgrid and track.grid is not None:
        for start, bpm in tempo_entries(track.grid, track.duration or 0.0):
            ET.SubElement(
                el,
                "TEMPO",
                {"Inizio": _fmt(start, 3), "Bpm": _fmt(bpm, 2), "Metro": "4/4", "Battito": "1"},
            )
    elif track.status == "ready" and track.grid is None:
        warnings.append(ExportWarning(code="no_beatgrid", track_id=track.id))
    cues = 0
    if options.cues:
        marks: list[dict[str, str]] = []
        for cue in track.cues:
            mark = {"Name": cue.name, "Type": "0", "Start": _fmt(cue.position, 3)}
            hot = {**mark, "Num": str(cue.slot)}
            if options.colors and cue.color:
                red, green, blue = rgb(cue.color)
                hot |= {"Red": str(red), "Green": str(green), "Blue": str(blue)}
            marks.append(hot)
            cues += 1
        if options.memory_cues:
            marks += [{"Name": c.name, "Type": "0", "Start": _fmt(c.position, 3), "Num": "-1"}
                      for c in track.cues]  # fmt: skip
        for mark in marks:
            ET.SubElement(el, "POSITION_MARK", mark)
    return el, cues


def _playlist_nodes(parent: ET.Element, playlists: list[ExportPlaylist], keep: set[int]) -> None:
    for p in playlists:
        if p.is_folder:
            node = ET.SubElement(parent, "NODE", {"Name": p.name, "Type": "0"})
            _playlist_nodes(node, p.children, keep)
            node.set("Count", str(len(node)))
        else:
            ids = [tid for tid in p.track_ids if tid in keep]
            node = ET.SubElement(
                parent,
                "NODE",
                {"Name": p.name, "Type": "1", "KeyType": "0", "Entries": str(len(ids))},
            )
            for tid in ids:
                ET.SubElement(node, "TRACK", {"Key": str(tid)})


def export_rekordbox(
    db: Database,
    options: ExportOptions,
    default_path: Path,
    backup_dir: Path,
    check_cancelled: Callable[[], None] = lambda: None,
) -> ExportResult:
    target = Path(options.path) if options.path else default_path
    playlists = load_playlists(db, options.playlist_ids) if options.include_playlists else []
    if options.track_ids is None:
        selection: list[int] | None = None
    else:
        selection = list(dict.fromkeys([*options.track_ids, *playlist_track_ids(playlists)]))
    tracks = load_tracks(db, selection, options.language)

    warnings: list[ExportWarning] = []
    root = ET.Element("DJ_PLAYLISTS", {"Version": "1.0.0"})
    ET.SubElement(
        root, "PRODUCT", {"Name": "Tonalia", "Version": __version__, "Company": "Tonalia"}
    )
    collection = ET.SubElement(root, "COLLECTION")
    kept: set[int] = set()
    items: list[ExportItem] = []
    skipped = cue_total = 0
    for i, track in enumerate(tracks):
        if i % 500 == 0:
            check_cancelled()
        fmt = (track.format or track.path.suffix.lstrip(".")).lower()
        if fmt in UNSUPPORTED:
            warnings.append(
                ExportWarning(code="unsupported_format", track_id=track.id, path=str(track.path))
            )
            skipped += 1
            continue
        if not track.path.exists():
            warnings.append(
                ExportWarning(code="missing_file", track_id=track.id, path=str(track.path))
            )
        if track.status != "ready":
            warnings.append(ExportWarning(code="not_analyzed", track_id=track.id))
        element, cues = _track_element(track, options, warnings)
        collection.append(element)
        kept.add(track.id)
        cue_total += cues
        add_item(items, track, "exported", cues)
    collection.set("Entries", str(len(kept)))
    lists = ET.SubElement(root, "PLAYLISTS")
    top = ET.SubElement(lists, "NODE", {"Type": "0", "Name": "ROOT"})
    _playlist_nodes(top, playlists, kept)
    top.set("Count", str(len(top)))

    backup: Path | None = None
    if not options.simulate:
        if options.path is None:
            target.parent.mkdir(parents=True, exist_ok=True)
        elif not target.parent.is_dir():
            raise ValueError(f"the folder {target.parent} does not exist")
        ET.indent(root)
        data = b'<?xml version="1.0" encoding="UTF-8"?>\n' + ET.tostring(
            root, encoding="unicode"
        ).encode("utf-8")
        backup = write_with_backup(target, data, backup_dir)
    return ExportResult(
        target="rekordbox",
        simulated=options.simulate,
        path=str(target),
        tracks=len(kept),
        cues=cue_total,
        playlists=count_playlists(playlists),
        skipped=skipped,
        warnings=warnings,
        backup_path=str(backup) if backup is not None else None,
        items=items,
    )
