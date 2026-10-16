"""Read an Engine DJ library (``Database2/m.db``) — SPEC 13.1.

The layout and blobs are the ones ``export/engine_dj.py`` writes (schema families 2.x and
3.x). Engine keeps the paths relative to the Engine Library folder, the rating as 0-100,
its key as a number around the wheel, the eight pads in ``quickCues`` (sample offsets;
an empty pad is at -1) and the beat grid in ``beatData`` (the adjusted grid: markers with
a sample offset and a beat number, beat 0 being a downbeat). Loops are not read: their
blob is not documented well enough to trust. Playlists are linked lists (``nextListId``
for the lists of a folder, ``nextEntityId`` for the tracks of a list).

The database is copied first (with its ``-wal``), and only the copy is opened.
"""

from __future__ import annotations

import os
import sqlite3
from itertools import pairwise
from pathlib import Path

from ..export.engine_dj import BeatData, QuickCues, TrackData, _absolute, _layout
from ..keys import Key, from_wheel
from ..rpc_schema import GridSpec, ImportWarning
from .model import (
    OWN_FOLDER,
    ImportedCollection,
    ImportedCue,
    ImportedPlaylist,
    ImportedTrack,
    anchored_grid,
    snapshot,
    stars,
)


def engine_key(number: int | None) -> Key | None:
    """Inverse of the export's ``engine_key``: 0 = 8B, 1 = 8A, 2 = 9B…"""
    if number is None or not 0 <= number <= 23:
        return None
    return from_wheel((number // 2 + 7) % 12 + 1, "A" if number % 2 else "B")


def grid(beat_data: BeatData | None, rate: float) -> GridSpec | None:
    if beat_data is None or rate <= 0:
        return None
    marks = sorted(beat_data.adjusted or beat_data.default, key=lambda m: m.sample_offset)
    if len(marks) < 2:
        return None
    points = [(m.beat_number, m.sample_offset / rate) for m in marks]

    def time_of(beat: float) -> float:
        for (b0, t0), (b1, t1) in pairwise(points):
            if b0 <= beat <= b1 and b1 > b0:
                return t0 + (beat - b0) * (t1 - t0) / (b1 - b0)
        (b0, t0), (b1, t1) = points[-2], points[-1]
        return t1 + (beat - b1) * (t1 - t0) / (b1 - b0)

    first = points[0][0]
    zero = first + (-first) % 4
    while time_of(zero) < 0:
        zero += 4
    pins = [(0, time_of(zero))] + [(b - zero, t) for b, t in points if b > zero]
    (b0, t0), (b1, t1) = points[-2], points[-1]
    end_bpm = 60.0 * (b1 - b0) / (t1 - t0) if t1 > t0 else 0.0
    return anchored_grid(pins, end_bpm) if end_bpm > 0 else None


Linked = tuple[int, int, int]  # (id, value, next id)


def _ordered(items: list[Linked]) -> list[Linked]:
    """Follow a linked list from the item nothing points to (leftovers at the end)."""
    by_id = {i[0]: i for i in items}
    pointed = {i[2] for i in items}
    head = next((i for i in items if i[0] not in pointed), None)
    out: list[Linked] = []
    seen: set[int] = set()
    while head is not None and head[0] not in seen:
        out.append(head)
        seen.add(head[0])
        head = by_id.get(head[2])
    return out + [i for i in items if i[0] not in seen]


def _playlists(
    conn: sqlite3.Connection, paths: dict[int, str], warnings: list[ImportWarning]
) -> list[ImportedPlaylist]:
    lists: dict[int, list[Linked]] = {}
    titles: dict[int, str] = {}
    for list_id, title, parent, nxt in conn.execute(
        "SELECT id, title, parentListId, nextListId FROM Playlist"
    ):
        titles[int(list_id)] = str(title or "")
        lists.setdefault(int(parent or 0), []).append((int(list_id), int(list_id), int(nxt or 0)))
    entities: dict[int, list[Linked]] = {}
    for eid, list_id, track_id, nxt in conn.execute(
        "SELECT id, listId, trackId, nextEntityId FROM PlaylistEntity"
    ):
        entities.setdefault(int(list_id), []).append((int(eid), int(track_id), int(nxt or 0)))

    def build(parent: int) -> list[ImportedPlaylist]:
        out: list[ImportedPlaylist] = []
        for list_id, _, _ in _ordered(lists.get(parent, [])):
            if parent == 0 and titles[list_id] == OWN_FOLDER:
                warnings.append(ImportWarning(code="own_folder_skipped"))
                continue
            tracks = [t for _, t, _ in _ordered(entities.get(list_id, []))]
            node = ImportedPlaylist(
                titles[list_id], False, [paths[t] for t in tracks if t in paths]
            )
            node.children = build(list_id)
            node.is_folder = bool(node.children) and not node.paths
            out.append(node)
        return out

    return build(0)


def read(path: Path) -> ImportedCollection:
    out = ImportedCollection("engine_dj", path)
    library_root = path.parent.parent
    wal = path.with_name(path.name + "-wal")
    with snapshot(path, wal) as folder:
        conn = sqlite3.connect(folder / path.name)
        try:
            layout = _layout(conn)
            perf = {
                int(r[0]): r[1:]
                for r in conn.execute(
                    f"SELECT {layout.id_column}, trackData, quickCues, beatData FROM {layout.table}"
                )
            }
            absolute: dict[int, str] = {}
            for row in conn.execute(
                "SELECT id, path, title, artist, rating, comment, key, bpmAnalyzed, fileBytes "
                "FROM Track WHERE path IS NOT NULL"
            ):
                tid, stored, title, artist, rating, comment, key, bpm, size = row
                file_path = os.path.normpath(_absolute(str(stored), library_root))
                absolute[int(tid)] = file_path
                blobs = perf.get(int(tid), (None, None, None))
                track_data = TrackData.decode(blobs[0])
                beat_data = BeatData.decode(blobs[2])
                rate = (track_data.sample_rate if track_data else 0) or (
                    beat_data.sample_rate if beat_data else 0
                )
                cues = []
                if rate > 0:
                    for slot, cue in enumerate(QuickCues.decode(blobs[1]).cues[:8]):
                        if cue.sample_offset < 0:
                            continue
                        a, r, g, b = cue.color
                        cues.append(
                            ImportedCue(
                                "hot", cue.sample_offset / rate, slot=slot,
                                name=cue.label or None,
                                color=f"#{r:02X}{g:02X}{b:02X}" if a else None,
                            )
                        )  # fmt: skip
                out.tracks.append(
                    ImportedTrack(
                        path=file_path,
                        title=title or None,
                        artist=artist or None,
                        size=int(size) if size else None,
                        key=engine_key(int(key) if key is not None else None),
                        bpm=float(bpm) if bpm and float(bpm) > 0 else None,
                        grid=grid(beat_data, rate),
                        rating=stars(float(rating or 0), 100),
                        comment=comment or None,
                        cues=cues,
                    )
                )
            out.playlists = _playlists(conn, absolute, out.warnings)
        finally:
            conn.close()
    return out
