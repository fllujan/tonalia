"""Engine DJ export (SPEC 10.5): key, hot cues, beat grid and playlists in ``m.db``.

Engine DJ keeps its collection in an SQLite database, ``<Engine Library>/Database2/m.db``
(``~/Music/Engine Library`` by default, or the same folder on a USB drive). Its layout is
documented by the public reverse-engineering work of libdjinterop; Tonalia supports the
schema families 2.x (Engine DJ 2 and 3, performance data in ``Track``) and 3.x (Engine DJ 4,
in ``PerformanceData``), and refuses any other version.

Precautions, as for the other collections:
- Engine DJ must be closed, and a database with pending WAL changes is not touched;
- the changes are made on a copy, checked (``PRAGMA integrity_check`` and a read-back) and
  only then the original is backed up and replaced atomically; a simulation runs the same
  steps on a throw-away copy;
- only tracks already in Engine's collection are updated (Engine imports files itself);
  others are reported. Pads Tonalia has no cue for, Engine's main cue and its own beat
  grid analysis (kept as the "default" grid) are left as they were;
- playlists go inside one top-level "Tonalia" playlist, replaced on every export.

Blobs: a 4-byte big-endian uncompressed size followed by a zlib stream. Sample offsets are
in samples at the track's sample rate.
"""

from __future__ import annotations

import math
import os
import shutil
import sqlite3
import struct
import tempfile
import time
import unicodedata
import zlib
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from pathlib import Path

from ..analysis.tempo import BeatGrid
from ..db import Database
from ..keys import Key, wheel_letter, wheel_number
from ..rpc_schema import ExportItem, ExportOptions, ExportResult, ExportWarning
from .common import (
    ExportPlaylist,
    ExportTrack,
    add_item,
    backup_copy,
    count_playlists,
    load_playlists,
    load_tracks,
    process_running,
    rgb,
)

SUPPORTED_MAJORS = (2, 3)
PADS = 8
EMPTY_OFFSET = -1.0
PLAYLIST_ROOT = "Tonalia"
# Engine keeps each folder's playlists as a linked list (nextListId) with these triggers.
LIST_TRIGGERS = frozenset(
    {"trigger_before_insert_List", "trigger_after_insert_List", "trigger_after_delete_List"}
)
# Engine DJ's own pad colours (ARGB), used when cue colours are not exported.
STANDARD_PADS: tuple[tuple[int, int, int, int], ...] = (
    (0xFF, 0xEA, 0xC5, 0x32),
    (0xFF, 0xEA, 0x8F, 0x32),
    (0xFF, 0xB8, 0x55, 0xBF),
    (0xFF, 0xBA, 0x2A, 0x41),
    (0xFF, 0x86, 0xC6, 0x4B),
    (0xFF, 0x20, 0xC6, 0x7C),
    (0xFF, 0x00, 0xA8, 0xB1),
    (0xFF, 0x15, 0x8E, 0xE2),
)


class EngineRunningError(RuntimeError):
    pass


class EngineDatabaseBusyError(RuntimeError):
    pass


class UnsupportedEngineLibraryError(RuntimeError):
    pass


def engine_running() -> bool:
    return process_running("Engine DJ.*\\.app/Contents/MacOS", "engine dj")


def find_database(home: Path | None = None) -> Path | None:
    """The default Engine Library (``Music/Engine Library``), on macOS and Windows."""
    candidate = (home or Path.home()) / "Music" / "Engine Library" / "Database2" / "m.db"
    return candidate if candidate.is_file() else None


def resolve_database(path: str) -> Path:
    """Accept the ``m.db`` file or its Engine Library folder."""
    given = Path(path)
    if given.is_dir():
        for candidate in (given / "Database2" / "m.db", given / "m.db"):
            if candidate.is_file():
                return candidate
    return given


# ---- blobs ----


def compress(payload: bytes) -> bytes:
    return struct.pack(">i", len(payload)) + zlib.compress(payload)


def decompress(blob: bytes | None) -> bytes:
    if not blob or len(blob) < 4 or struct.unpack(">i", blob[:4])[0] == 0:
        return b""
    return zlib.decompress(blob[4:])


Color = tuple[int, int, int, int]  # alpha, red, green, blue


@dataclass
class QuickCue:
    label: str
    sample_offset: float
    color: Color

    @classmethod
    def empty(cls) -> QuickCue:
        return cls("", EMPTY_OFFSET, (0, 0, 0, 0))


@dataclass
class QuickCues:
    cues: list[QuickCue] = field(default_factory=list)
    adjusted_main_cue: float = 0.0
    is_main_cue_adjusted: bool = False
    default_main_cue: float = 0.0
    extra: bytes = b""

    @classmethod
    def decode(cls, blob: bytes | None) -> QuickCues:
        data = decompress(blob)
        if not data:
            return cls()
        (count,) = struct.unpack_from(">q", data, 0)
        pos = 8
        cues = []
        for _ in range(count):
            size = data[pos]
            label = data[pos + 1 : pos + 1 + size].decode("utf-8", errors="replace")
            pos += 1 + size
            offset, a, r, g, b = struct.unpack_from(">dBBBB", data, pos)
            pos += 12
            cues.append(QuickCue(label, offset, (a, r, g, b)))
        adjusted, is_adjusted, default = struct.unpack_from(">dBd", data, pos)
        return cls(cues, adjusted, bool(is_adjusted), default, data[pos + 17 :])

    def encode(self) -> bytes:
        out = struct.pack(">q", len(self.cues))
        for cue in self.cues:
            raw = _label_bytes(cue.label)
            out += struct.pack(">B", len(raw)) + raw
            out += struct.pack(">dBBBB", cue.sample_offset, *cue.color)
        out += struct.pack(
            ">dBd", self.adjusted_main_cue, int(self.is_main_cue_adjusted), self.default_main_cue
        )
        return compress(out + self.extra)


def _label_bytes(label: str) -> bytes:
    """UTF-8, at most 255 bytes, never cut inside a character."""
    raw = label.encode("utf-8")
    while len(raw) > 255:
        label = label[:-1]
        raw = label.encode("utf-8")
    return raw


@dataclass
class TrackData:
    sample_rate: float
    samples: int
    key: int
    loudness: tuple[float, float, float]
    extra: bytes = b""

    @classmethod
    def decode(cls, blob: bytes | None) -> TrackData | None:
        data = decompress(blob)
        if len(data) < 44:
            return None
        rate, samples, key, low, mid, high = struct.unpack_from(">dqiddd", data, 0)
        return cls(rate, samples, key, (low, mid, high), data[44:])

    def encode(self) -> bytes:
        payload = struct.pack(">dqiddd", self.sample_rate, self.samples, self.key, *self.loudness)
        return compress(payload + self.extra)


@dataclass(frozen=True)
class Marker:
    sample_offset: float
    beat_number: int
    number_of_beats: int
    unknown: int = 0


@dataclass
class BeatData:
    sample_rate: float
    samples: float
    is_set: bool
    default: list[Marker]
    adjusted: list[Marker]
    extra: bytes = b""

    @classmethod
    def decode(cls, blob: bytes | None) -> BeatData | None:
        data = decompress(blob)
        if len(data) < 33:
            return None
        rate, samples, is_set = struct.unpack_from(">ddB", data, 0)
        pos = 17
        grids: list[list[Marker]] = []
        for _ in range(2):
            (count,) = struct.unpack_from(">q", data, pos)
            pos += 8
            grids.append(
                [Marker(*struct.unpack_from("<dqii", data, pos + 24 * i)) for i in range(count)]
            )
            pos += 24 * count
        return cls(rate, samples, bool(is_set), grids[0], grids[1], data[pos:])

    def encode(self) -> bytes:
        def grid(markers: list[Marker]) -> bytes:
            return struct.pack(">q", len(markers)) + b"".join(
                struct.pack("<dqii", m.sample_offset, m.beat_number, m.number_of_beats, m.unknown)
                for m in markers
            )

        payload = struct.pack(">ddB", self.sample_rate, self.samples, int(self.is_set))
        return compress(payload + grid(self.default) + grid(self.adjusted) + self.extra)


# ---- conversions ----


def engine_key(key: Key) -> int:
    """Engine's key number: 0 = C (8B), 1 = Am (8A), 2 = G (9B)… around the wheel."""
    return ((wheel_number(key) - 8) % 12) * 2 + (1 if wheel_letter(key) == "A" else 0)


def grid_markers(grid: BeatGrid, duration: float, sample_rate: float) -> list[Marker]:
    """Markers from one bar before the first downbeat to a bar line past the end."""
    beats = grid.beats if grid.kind == "variable" and grid.beats and len(grid.beats) > 1 else None
    if beats is None:
        spb = 60.0 / grid.bpm
        first = grid.first_downbeat
        last_beat = max(4, 4 * math.ceil((duration - first) / spb / 4))
        return [
            Marker((first - 4 * spb) * sample_rate, -4, last_beat + 4),
            Marker((first + last_beat * spb) * sample_rate, last_beat, 0),
        ]
    start = min(range(len(beats)), key=lambda i: abs(beats[i] - grid.first_downbeat))
    bars = beats[start::4]
    first_spb = (beats[start + 1] - beats[start]) if start + 1 < len(beats) else 60.0 / grid.bpm
    markers = [Marker((bars[0] - 4 * first_spb) * sample_rate, -4, 4)]
    markers += [Marker(t * sample_rate, 4 * i, 4) for i, t in enumerate(bars)]
    last_spb = beats[-1] - beats[-2]
    extra = max(4, 4 * math.ceil((duration - bars[-1]) / last_spb / 4))
    last = markers[-1]
    markers[-1] = Marker(last.sample_offset, last.beat_number, extra)
    markers.append(Marker((bars[-1] + extra * last_spb) * sample_rate, last.beat_number + extra, 0))
    return markers


def _path_key(path: str) -> str:
    text = unicodedata.normalize("NFC", os.path.normpath(path))
    return text.lower() if os.name == "nt" else text


def _absolute(stored: str, library_root: Path) -> str:
    """Engine stores paths relative to the Engine Library folder, with ``/``."""
    looks_absolute = stored.startswith("/") or (len(stored) > 2 and stored[1] == ":")
    return stored if looks_absolute else str(library_root / stored)


# ---- the database ----


@dataclass
class _Layout:
    table: str  # where the performance blobs live
    id_column: str
    uuid: str


def _layout(conn: sqlite3.Connection) -> _Layout:
    try:
        info = conn.execute(
            "SELECT uuid, schemaVersionMajor, schemaVersionMinor, schemaVersionPatch"
            " FROM Information ORDER BY id LIMIT 1"
        ).fetchone()
    except sqlite3.DatabaseError as e:
        raise UnsupportedEngineLibraryError(f"not an Engine Library database: {e}") from e
    if info is None:
        raise UnsupportedEngineLibraryError("not an Engine Library database: no Information")
    uuid, major, minor, patch = info
    if major not in SUPPORTED_MAJORS:
        raise UnsupportedEngineLibraryError(
            f"Engine Library version {major}.{minor}.{patch} is not supported"
        )
    columns = {row[1] for row in conn.execute("PRAGMA table_info(Track)")}
    triggers = {
        row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type = 'trigger'")
    }
    missing = LIST_TRIGGERS - triggers
    if missing:
        raise UnsupportedEngineLibraryError(
            f"Engine Library version {major}.{minor}.{patch} is not supported"
            f" (missing {', '.join(sorted(missing))})"
        )
    in_track = "quickCues" in columns
    return _Layout(
        table="Track" if in_track else "PerformanceData",
        id_column="id" if in_track else "trackId",
        uuid=str(uuid),
    )


@dataclass
class _Counts:
    cues: int = 0
    tracks: int = 0


def _update_track(
    conn: sqlite3.Connection,
    layout: _Layout,
    engine_id: int,
    track: ExportTrack,
    options: ExportOptions,
) -> int:
    row = conn.execute(
        f"SELECT trackData, quickCues, beatData FROM {layout.table} WHERE {layout.id_column} = ?",
        (engine_id,),
    ).fetchone()
    blobs = row if row is not None else (None, None, None)
    track_data = TrackData.decode(blobs[0])
    beat_data = BeatData.decode(blobs[2])
    rate = (
        (track_data.sample_rate if track_data and track_data.sample_rate > 0 else 0)
        or (beat_data.sample_rate if beat_data and beat_data.sample_rate > 0 else 0)
        or float(track.sample_rate or 44100)
    )
    updates: dict[str, object] = {}
    track_updates: dict[str, object] = {}

    if options.key and track.key is not None:
        number = engine_key(track.key)
        track_updates["key"] = number
        if track_data is not None:
            track_data.key = number
            updates["trackData"] = track_data.encode()

    cues_written = 0
    if options.cues and track.cues:
        quick = QuickCues.decode(blobs[1])
        if not decompress(blobs[1]):
            first = track.cues[0].position if track.cues[0].slot == 0 else None
            if first is None and track.grid is not None:
                first = track.grid.first_downbeat
            quick.default_main_cue = quick.adjusted_main_cue = (first or 0.0) * rate
        quick.cues += [QuickCue.empty() for _ in range(PADS - len(quick.cues))]
        for cue in track.cues:
            if not 0 <= cue.slot < PADS:
                continue
            color = (
                (0xFF, *rgb(cue.color)) if options.colors and cue.color else STANDARD_PADS[cue.slot]
            )
            quick.cues[cue.slot] = QuickCue(cue.name, cue.position * rate, color)
            cues_written += 1
        updates["quickCues"] = quick.encode()
    elif options.cues and not decompress(blobs[1]):
        # A track Engine has not analysed yet still gets 8 empty pads and a main cue.
        first = track.grid.first_downbeat if track.grid is not None else 0.0
        empty = QuickCues(
            [QuickCue.empty() for _ in range(PADS)], first * rate, False, first * rate
        )
        updates["quickCues"] = empty.encode()

    if options.beatgrid and track.grid is not None and track.duration:
        markers = grid_markers(track.grid, track.duration, rate)
        if beat_data is None:
            samples = float(track_data.samples) if track_data else track.duration * rate
            beat_data = BeatData(rate, samples, True, markers, markers)
        else:
            beat_data.adjusted = markers
            beat_data.is_set = True
        updates["beatData"] = beat_data.encode()
        track_updates["bpmAnalyzed"] = track.grid.bpm

    if track_updates:
        sets = ", ".join(f"{k} = ?" for k in track_updates)
        conn.execute(f"UPDATE Track SET {sets} WHERE id = ?", (*track_updates.values(), engine_id))
    if updates:
        sets = ", ".join(f"{k} = ?" for k in updates)
        conn.execute(
            f"UPDATE {layout.table} SET {sets} WHERE {layout.id_column} = ?",
            (*updates.values(), engine_id),
        )
    return cues_written


def _append_list(conn: sqlite3.Connection, title: str, parent: int) -> int:
    """Add a playlist at the end of its parent's list (Engine's triggers relink the old last)."""
    cur = conn.execute(
        "INSERT INTO Playlist (title, parentListId, isPersisted, nextListId, lastEditTime,"
        " isExplicitlyExported) VALUES (?, ?, 1, 0, ?, 1)",
        (title, parent, int(time.time())),
    )
    return int(cur.lastrowid or 0)


def _remove_tonalia_lists(conn: sqlite3.Connection) -> None:
    row = conn.execute(
        "SELECT id FROM Playlist WHERE title = ? AND parentListId = 0", (PLAYLIST_ROOT,)
    ).fetchone()
    if row is None:
        return
    order: list[int] = []
    stack = [int(row[0])]
    while stack:
        current = stack.pop()
        order.append(current)
        stack += [
            int(r[0])
            for r in conn.execute("SELECT id FROM Playlist WHERE parentListId = ?", (current,))
        ]
    for list_id in reversed(order):  # children first
        conn.execute("DELETE FROM PlaylistEntity WHERE listId = ?", (list_id,))
        conn.execute("DELETE FROM Playlist WHERE id = ?", (list_id,))


def _write_playlists(
    conn: sqlite3.Connection,
    layout: _Layout,
    playlists: Iterable[ExportPlaylist],
    engine_ids: dict[int, int],
) -> None:
    _remove_tonalia_lists(conn)
    root = _append_list(conn, PLAYLIST_ROOT, 0)

    def add(nodes: Iterable[ExportPlaylist], parent: int) -> None:
        used: set[str] = set()
        for node in nodes:
            title, n = node.name, 2
            while title in used:
                title, n = f"{node.name} ({n})", n + 1
            used.add(title)
            list_id = _append_list(conn, title, parent)
            tracks = list(dict.fromkeys(engine_ids[t] for t in node.track_ids if t in engine_ids))
            next_id = 0
            for engine_id in reversed(tracks):  # each entity points to the following one
                cur = conn.execute(
                    "INSERT INTO PlaylistEntity (listId, trackId, databaseUuid, nextEntityId,"
                    " membershipReference) VALUES (?, ?, ?, ?, 0)",
                    (list_id, engine_id, layout.uuid, next_id),
                )
                next_id = int(cur.lastrowid or 0)
            add(node.children, list_id)

    add(playlists, root)


def _check(path: Path, layout: _Layout, probe: tuple[int, bytes] | None) -> None:
    conn = sqlite3.connect(path)
    try:
        # Engine's own journal mode is kept; a WAL copy is folded back into the file.
        if conn.execute("PRAGMA journal_mode").fetchone()[0] == "wal":
            conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        status = conn.execute("PRAGMA integrity_check").fetchone()[0]
        if status != "ok":
            raise RuntimeError(f"verification failed: {status}")
        if probe is not None:
            engine_id, expected = probe
            row = conn.execute(
                f"SELECT quickCues FROM {layout.table} WHERE {layout.id_column} = ?", (engine_id,)
            ).fetchone()
            if row is None or bytes(row[0] or b"") != expected:
                raise RuntimeError("verification failed: the cues did not read back")
    finally:
        conn.close()


def export_engine_dj(
    db: Database,
    options: ExportOptions,
    backup_dir: Path,
    check_cancelled: Callable[[], None] = lambda: None,
) -> ExportResult:
    target = resolve_database(options.path) if options.path else find_database()
    if target is None or not target.is_file():
        raise FileNotFoundError(
            f"Engine DJ library not found: {target}" if target else "Engine DJ library not found"
        )
    running = engine_running()
    if running and not options.simulate:
        raise EngineRunningError("Engine DJ is open: close it before exporting")
    wal = target.with_name(target.name + "-wal")
    if not options.simulate and wal.is_file() and wal.stat().st_size > 0:
        raise EngineDatabaseBusyError(
            "Engine DJ did not close cleanly: open and close Engine DJ, then export again"
        )

    with tempfile.TemporaryDirectory(prefix="tonalia-engine-") as scratch:
        work = (
            Path(scratch) / "m.db"
            if options.simulate
            else target.with_name(f".{target.name}.tonalia-{os.getpid()}.tmp")
        )
        shutil.copy2(target, work)
        try:
            result, probe, layout = _apply(db, options, target, work, running, check_cancelled)
            _check(work, layout, probe)
            pending = work.with_name(work.name + "-wal")
            if pending.is_file() and pending.stat().st_size > 0:
                raise RuntimeError("verification failed: changes left in the WAL")
            if options.simulate:
                return result
            backup = backup_copy(target, backup_dir)
            work.replace(target)
            result.backup_path = str(backup) if backup is not None else None
            return result
        finally:
            for suffix in ("", "-journal", "-wal", "-shm"):
                leftover = work.with_name(work.name + suffix)
                leftover.unlink(missing_ok=True)


def _apply(
    db: Database,
    options: ExportOptions,
    target: Path,
    work: Path,
    running: bool,
    check_cancelled: Callable[[], None],
) -> tuple[ExportResult, tuple[int, bytes] | None, _Layout]:
    conn = sqlite3.connect(work, isolation_level=None)
    try:
        layout = _layout(conn)
        library_root = target.parent.parent
        engine_ids_by_path = {
            _path_key(_absolute(str(path), library_root)): int(tid)
            for tid, path in conn.execute("SELECT id, path FROM Track WHERE path IS NOT NULL")
        }
        tracks = load_tracks(db, options.track_ids, options.language)
        warnings = [ExportWarning(code="app_running")] if running else []
        items: list[ExportItem] = []
        engine_ids: dict[int, int] = {}
        counts = _Counts()
        skipped = 0
        probe: tuple[int, bytes] | None = None
        conn.execute("BEGIN")
        for i, track in enumerate(tracks):
            if i % 200 == 0:
                check_cancelled()
            if not track.path.exists():
                warnings.append(
                    ExportWarning(code="missing_file", track_id=track.id, path=str(track.path))
                )
            if track.status != "ready":
                warnings.append(ExportWarning(code="not_analyzed", track_id=track.id))
            engine_id = engine_ids_by_path.get(_path_key(str(track.path)))
            if engine_id is None:
                warnings.append(
                    ExportWarning(code="not_in_collection", track_id=track.id, path=str(track.path))
                )
                skipped += 1
                continue
            engine_ids[track.id] = engine_id
            cues = _update_track(conn, layout, engine_id, track, options)
            if cues and probe is None:
                blob = conn.execute(
                    f"SELECT quickCues FROM {layout.table} WHERE {layout.id_column} = ?",
                    (engine_id,),
                ).fetchone()[0]
                probe = (engine_id, bytes(blob))
            counts.cues += cues
            counts.tracks += 1
            add_item(items, track, "updated", cues)
        playlists = load_playlists(db) if options.include_playlists else []
        if options.include_playlists:
            _write_playlists(conn, layout, playlists, engine_ids)
        conn.execute("COMMIT")
    except BaseException:
        if conn.in_transaction:
            conn.execute("ROLLBACK")
        raise
    finally:
        conn.close()
    result = ExportResult(
        target="engine_dj",
        simulated=options.simulate,
        path=str(target),
        tracks=counts.tracks,
        cues=counts.cues,
        playlists=count_playlists(playlists),
        skipped=skipped,
        warnings=warnings,
        backup_path=None,
        items=items,
    )
    return result, probe, layout


def database_status() -> tuple[Path | None, bool]:
    return find_database(), engine_running()
