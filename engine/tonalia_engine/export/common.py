"""Shared pieces of the DJ-software exports (SPEC 2.12).

Every export reads the same view of the library (:func:`load_tracks`), names cues the
same way and writes its destination through :func:`write_with_backup`: an existing file
is copied to the backups folder first, then the new content replaces it atomically.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import time
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from ..analysis.tempo import BeatGrid
from ..db import Database
from ..filters import filter_sql
from ..fsutil import write_atomic
from ..keys import Key
from ..rpc_schema import (
    EXPORT_ITEMS_MAX,
    ExportAction,
    ExportItem,
    ExportLanguage,
    ExportOptions,
    TrackFilter,
)

# Auto-cue labels are section keys; exports write readable names.
SECTION_NAMES: dict[str, dict[str, str]] = {
    "en": {
        "intro": "Intro", "verse": "Verse", "chorus": "Chorus", "build": "Build",
        "build2": "Build 2", "drop": "Drop", "drop2": "Drop 2", "breakdown": "Breakdown",
        "outro": "Outro",
    },
    "es": {
        "intro": "Intro", "verse": "Verso", "chorus": "Estribillo", "build": "Build",
        "build2": "2.º build", "drop": "Drop", "drop2": "Drop 2", "breakdown": "Breakdown",
        "outro": "Outro",
    },
}  # fmt: skip


@dataclass(frozen=True)
class ExportCue:
    slot: int
    position: float
    name: str
    color: str | None  # "#RRGGBB"


@dataclass
class ExportTrack:
    id: int
    path: Path
    title: str | None
    artist: str | None
    album: str | None
    genre: str | None
    year: int | None
    label: str | None
    comment: str | None
    duration: float | None
    bitrate: int | None
    sample_rate: int | None
    size: int | None
    format: str | None
    added_at: str
    status: str
    key: Key | None
    bpm: float | None
    energy: int | None
    grid: BeatGrid | None
    cues: list[ExportCue] = field(default_factory=list)

    @property
    def display_title(self) -> str:
        return self.title or self.path.stem


def cue_name(label: str | None, source: str, language: ExportLanguage, occurrence: int = 1) -> str:
    """Readable cue name; the third and later auto drops/builds are numbered."""
    if label and source == "auto":
        base = label.rstrip("2")
        if base in ("drop", "build") and occurrence >= 3:
            if language == "es" and base == "build":
                return f"{occurrence}.º build"
            return f"{SECTION_NAMES[language][base]} {occurrence}"
        return SECTION_NAMES[language].get(label, label)
    return label or ""


def rgb(color: str) -> tuple[int, int, int]:
    value = color.lstrip("#")
    return int(value[0:2], 16), int(value[2:4], 16), int(value[4:6], 16)


_TRACK_SQL = """
SELECT t.id, t.path, t.title, t.artist, t.album, t.genre, t.year, t.label, t.comment,
       t.duration, t.bitrate, t.sample_rate, t.size, t.format, t.added_at, t.status,
       a.key_root, a.key_mode, a.bpm, a.energy, a.beat_grid
FROM tracks t LEFT JOIN analysis a ON a.track_id = t.id
"""


def _grid(raw: str | None) -> BeatGrid | None:
    if not raw:
        return None
    data: dict[str, Any] = json.loads(raw)
    return BeatGrid(data["kind"], data["bpm"], data["first_downbeat"], data.get("beats"))


def load_tracks(
    db: Database, track_ids: Sequence[int] | None, language: ExportLanguage
) -> list[ExportTrack]:
    """Tracks (all when ``track_ids`` is None) with analysis and cues, by id."""
    conn = db.conn
    if track_ids is None:
        rows = conn.execute(_TRACK_SQL + " ORDER BY t.id").fetchall()
    else:
        rows = []
        ids = list(dict.fromkeys(track_ids))
        for start in range(0, len(ids), 500):
            chunk = ids[start : start + 500]
            marks = ", ".join("?" for _ in chunk)
            rows += conn.execute(_TRACK_SQL + f" WHERE t.id IN ({marks})", chunk).fetchall()
        rows.sort(key=lambda r: r["id"])
    tracks: dict[int, ExportTrack] = {}
    for r in rows:
        key = Key(r["key_root"], r["key_mode"]) if r["key_root"] is not None else None
        tracks[r["id"]] = ExportTrack(
            id=r["id"], path=Path(r["path"]), title=r["title"], artist=r["artist"],
            album=r["album"], genre=r["genre"], year=r["year"], label=r["label"],
            comment=r["comment"], duration=r["duration"], bitrate=r["bitrate"],
            sample_rate=r["sample_rate"], size=r["size"], format=r["format"],
            added_at=r["added_at"], status=r["status"], key=key, bpm=r["bpm"],
            energy=r["energy"], grid=_grid(r["beat_grid"]),
        )  # fmt: skip
    if tracks:
        seen: dict[tuple[int, str], int] = {}
        for c in conn.execute(
            "SELECT track_id, slot, position_sec, label, color, source FROM cues "
            "ORDER BY track_id, position_sec"
        ):
            track = tracks.get(c["track_id"])
            if track is None:
                continue
            base = (c["label"] or "").rstrip("2")
            seen[(track.id, base)] = occurrence = seen.get((track.id, base), 0) + 1
            name = cue_name(c["label"], c["source"], language, occurrence)
            track.cues.append(ExportCue(c["slot"], c["position_sec"], name, c["color"]))
        for track in tracks.values():
            track.cues.sort(key=lambda cue: cue.slot)
    return list(tracks.values())


@dataclass
class ExportPlaylist:
    id: int
    name: str
    is_folder: bool
    track_ids: list[int]
    children: list[ExportPlaylist] = field(default_factory=list)


def load_playlists(db: Database, only: Sequence[int] | None = None) -> list[ExportPlaylist]:
    """Playlist tree with each playlist's tracks resolved (smart ones by their query).

    With ``only``, just those nodes (with what is inside them) become the roots; a node
    inside another chosen one is not repeated.
    """
    conn = db.conn
    rows = conn.execute(
        "SELECT id, parent_id, name, emoji, is_folder, smart_query FROM playlists "
        "ORDER BY sort_order, id"
    ).fetchall()
    nodes: dict[int, ExportPlaylist] = {}
    parents: dict[int, int | None] = {}
    for r in rows:
        if r["is_folder"]:
            ids: list[int] = []
        elif r["smart_query"] is not None:
            where, args = filter_sql(TrackFilter.model_validate_json(r["smart_query"]))
            clause = f"WHERE {' AND '.join(where)}" if where else ""
            ids = [
                x[0]
                for x in conn.execute(
                    "SELECT t.id FROM tracks t LEFT JOIN analysis a ON a.track_id = t.id "
                    f"{clause} ORDER BY t.display_title COLLATE NOCASE, t.id",
                    args,
                )
            ]
        else:
            ids = [
                x[0]
                for x in conn.execute(
                    "SELECT track_id FROM playlist_tracks WHERE playlist_id = ? ORDER BY position",
                    (r["id"],),
                )
            ]
        name = f"{r['emoji']} {r['name']}" if r["emoji"] else r["name"]
        nodes[r["id"]] = ExportPlaylist(r["id"], name, bool(r["is_folder"]), ids)
        parents[r["id"]] = r["parent_id"]
    roots: list[ExportPlaylist] = []
    for pid, node in nodes.items():
        parent = parents[pid]
        (nodes[parent].children if parent in nodes else roots).append(node)
    if only is None:
        return roots
    chosen = set(only)

    def inside_chosen(pid: int) -> bool:
        parent = parents.get(pid)
        while parent is not None:
            if parent in chosen:
                return True
            parent = parents.get(parent)
        return False

    return [nodes[i] for i in dict.fromkeys(only) if i in nodes and not inside_chosen(i)]


def scoped(db: Database, options: ExportOptions) -> ExportOptions:
    """Options with ``track_ids`` set to the chosen playlists' tracks, when there are any."""
    if options.playlist_ids is None:
        return options
    ids = playlist_track_ids(load_playlists(db, options.playlist_ids))
    return options.model_copy(update={"track_ids": ids})


def playlist_track_ids(playlists: Iterable[ExportPlaylist]) -> list[int]:
    out: list[int] = []
    for p in playlists:
        out += p.track_ids
        out += playlist_track_ids(p.children)
    return list(dict.fromkeys(out))


def count_playlists(playlists: Iterable[ExportPlaylist]) -> int:
    return sum((0 if p.is_folder else 1) + count_playlists(p.children) for p in playlists)


def backup_copy(target: Path, backup_dir: Path) -> Path | None:
    """Copy an existing ``target`` into ``backup_dir`` (timestamped); None if absent."""
    if not target.exists():
        return None
    backup_dir.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    backup = backup_dir / f"{stamp}-{target.name}"
    n = 1
    while backup.exists():
        backup = backup_dir / f"{stamp}-{n}-{target.name}"
        n += 1
    shutil.copy2(target, backup)
    return backup


def write_with_backup(target: Path, data: bytes, backup_dir: Path) -> Path | None:
    """Back up the current file (if any), then replace it atomically."""
    backup = backup_copy(target, backup_dir)
    write_atomic(target, data, keep_mode_of=target)
    return backup


def add_item(items: list[ExportItem], track: ExportTrack, action: ExportAction, cues: int) -> None:
    if len(items) < EXPORT_ITEMS_MAX:
        items.append(
            ExportItem(track_id=track.id, title=track.display_title, action=action, cues=cues)
        )


def process_running(mac_pattern: str, windows_image_prefix: str) -> bool:
    """Whether a process of a DJ application runs (pgrep on macOS, tasklist on Windows)."""
    try:
        if sys.platform == "win32":
            out = subprocess.run(
                ["tasklist", "/FO", "CSV", "/NH"], capture_output=True, text=True, timeout=10
            ).stdout
            prefix = '"' + windows_image_prefix.lower()
            return any(line.lower().startswith(prefix) for line in out.splitlines())
        out = subprocess.run(
            ["pgrep", "-if", mac_pattern], capture_output=True, text=True, timeout=10
        ).stdout
        return bool(out.strip())
    except (OSError, subprocess.SubprocessError):
        return False
