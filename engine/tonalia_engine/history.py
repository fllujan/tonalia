"""Play history (SPEC 13.4): what each DJ program says was played, and sets marked by hand.

Each program keeps its history its own way; none of these formats is published, so each
reader follows what the files hold (the fixtures in ``tests/test_history.py`` are made by
hand in the same shape). Reading never writes to the program's files.

- **Rekordbox** — ``rekordbox.xml`` (File → Export Collection in xml format): the
  playlists under the top folder ``HISTORY``, one per day (``HISTORY 2026-10-03``, a second
  one that day ``HISTORY 2026-10-03 (2)``). The XML keeps the day and the order, not the
  time, so the plays of a session are dated at that day's midnight (local time).
- **Traktor** — ``History/history_2026y10m03d_22h15m03s.nml`` next to ``collection.nml``:
  an NML collection per session whose ``ENTRY`` elements carry an ``EXTENDEDDATA`` with
  ``STARTDATE`` (``year << 16 | month << 8 | day``), ``STARTTIME`` (seconds since local
  midnight) and ``PLAYEDPUBLIC`` (0 = only heard on the headphones: not counted).
- **Serato** — ``_Serato_/History/Sessions/*.session``: records of a 4-byte tag, a 4-byte
  big-endian length and the body. Each ``oent`` holds an ``adat`` whose fields are a
  4-byte id, a 4-byte length and the value: 2 = path (UTF-16 BE, absolute or relative to
  the drive of ``_Serato_``), 28 = start (Unix time), 29 = end, 50 = played (one byte;
  0 = loaded and not played: not counted).
- **VirtualDJ** — ``History/**/*.m3u`` in VirtualDJ's folder (next to ``database.xml``):
  one list per day, a ``#EXTVDJ:`` line before each path with ``<lastplaytime>`` (Unix
  time) or ``<time>`` (HH:MM of that day).
- **Engine DJ** — ``Database2/hm.db`` (or ``m.db``): ``Historylist`` (``id``, ``title``,
  ``startTime``) and ``HistorylistEntity`` (``listId``, ``trackId``, ``startTime``), with
  ``Track.path`` relative to the Engine Library folder. Read from a copy.

Importing the same history again brings its sessions up to date instead of adding them
twice (a session is known by the program and its file or list). "Times played" is the
number of plays in the history, or the counter another program kept if it is higher (it
also counts plays from before its history was kept), plus the plays marked by hand.
"""

from __future__ import annotations

import os
import re
import sqlite3
import struct
import uuid
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, time, timedelta
from pathlib import Path, PurePath, PureWindowsPath

import defusedxml.ElementTree as SafeET

from .db import Database
from .errors import CollectionNotFoundError, TonaliaError
from .export import engine_dj as engine_export
from .export import serato_crates, traktor_nml
from .export import virtualdj as vdj_export
from .export.traktor_nml import root_volume_name
from .filters import TIMES_PLAYED
from .import_ import service as import_service
from .import_.model import ImportedTrack, snapshot
from .import_.rekordbox import local_path
from .import_.serato import drive_root
from .import_.traktor import location_path
from .rpc_schema import (
    HistoryDeleteResult,
    HistoryImportParams,
    HistoryImportResult,
    HistoryList,
    HistoryMarkParams,
    HistoryMarkResult,
    HistoryQuery,
    HistorySources,
    HistorySourceStatus,
    HistoryWarning,
    ImportSource,
    PlaySession,
)

UNMATCHED_LISTED = 20
# Big enough for any real history; a corrupt file never makes the reader loop or balloon.
MAX_FILE_BYTES = 64 * 1024 * 1024
MAX_FIELD_BYTES = 64 * 1024


class SessionNotFoundError(TonaliaError):
    def __init__(self, session_id: int) -> None:
        super().__init__(f"unknown play session {session_id}", reason="session_not_found")


@dataclass
class ReadSession:
    key: str  # unique within the program: the same session read again has the same key
    started_at: datetime
    name: str | None = None
    ended_at: datetime | None = None
    plays: list[tuple[str, datetime]] = field(default_factory=list)  # (path, when), in order


@dataclass
class ReadHistory:
    sessions: list[ReadSession] = field(default_factory=list)
    warnings: list[HistoryWarning] = field(default_factory=list)


def iso(moment: datetime) -> str:
    """UTC ISO 8601 with seconds (naive moments are local time)."""
    return moment.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _local(day: date, seconds: float = 0) -> datetime:
    return (datetime.combine(day, time()) + timedelta(seconds=seconds)).astimezone()


def _unix(value: float) -> datetime | None:
    try:
        return datetime.fromtimestamp(value, UTC) if value > 0 else None
    except (OverflowError, OSError, ValueError):
        return None


def _read_bytes(path: Path) -> bytes:
    if path.stat().st_size > MAX_FILE_BYTES:
        raise ValueError(f"{path.name} is too big for a history file")
    return path.read_bytes()


# ---- Rekordbox ----

_DAY = re.compile(r"(\d{4})-(\d{2})-(\d{2})")


def _day(text: str) -> date | None:
    m = _DAY.search(text)
    if not m:
        return None
    try:
        return date(int(m[1]), int(m[2]), int(m[3]))
    except ValueError:
        return None


def read_rekordbox(path: Path) -> ReadHistory:
    root = SafeET.fromstring(_read_bytes(path))
    out = ReadHistory()
    by_id: dict[str, str] = {}
    collection = root.find("COLLECTION")
    for el in collection.findall("TRACK") if collection is not None else []:
        if el.get("Location"):
            by_id[el.get("TrackID", "")] = local_path(el.get("Location", ""))
    lists = root.find("PLAYLISTS")
    top = lists.find("NODE") if lists is not None else None
    folders = [
        n
        for n in (top.findall("NODE") if top is not None else [])
        if n.get("Type") == "0" and (n.get("Name") or "").strip().casefold() == "history"
    ]
    for folder in folders:
        for node in folder.findall("NODE"):
            name = node.get("Name") or ""
            day = _day(name)
            if node.get("Type") != "1" or day is None:
                continue
            when = _local(day)
            by_location = node.get("KeyType") == "1"
            plays = []
            for item in node.findall("TRACK"):
                key = item.get("Key") or ""
                file_path = local_path(key) if by_location else by_id.get(key)
                if file_path:
                    plays.append((file_path, when))
            out.sessions.append(ReadSession(key=name, started_at=when, name=name, plays=plays))
    return out


# ---- Traktor ----

_TRAKTOR_NAME = re.compile(r"(\d{4})y(\d{2})m(\d{2})d_(\d{2})h(\d{2})m(\d{2})s")


def _traktor_moment(start_date: str | None, start_time: str | None) -> datetime | None:
    try:
        packed = int(start_date or "")
        day = date(packed >> 16, (packed >> 8) & 0xFF, packed & 0xFF)
        return _local(day, float(start_time or 0))
    except ValueError:
        return None


def _traktor_file(path: Path, volume: str) -> ReadSession | None:
    root = SafeET.fromstring(_read_bytes(path))
    plays: list[tuple[str, datetime]] = []
    collection = root.find("COLLECTION")
    for entry in collection.findall("ENTRY") if collection is not None else []:
        loc = entry.find("LOCATION")
        extended = entry.find("EXTENDEDDATA")
        if loc is None or not loc.get("FILE") or extended is None:
            continue
        if extended.get("PLAYEDPUBLIC") == "0":
            continue
        when = _traktor_moment(extended.get("STARTDATE"), extended.get("STARTTIME"))
        if when is None:
            continue
        file_path = location_path(
            loc.get("VOLUME", ""), loc.get("DIR", ""), loc.get("FILE", ""), volume
        )
        plays.append((file_path, when))
    plays.sort(key=lambda p: p[1])
    m = _TRAKTOR_NAME.search(path.name)
    started: datetime | None = None
    if m:
        try:
            y, mo, d, hh, mm, ss = (int(g) for g in m.groups())
            started = datetime(y, mo, d, hh, mm, ss).astimezone()
        except ValueError:
            started = None
    if started is None:
        if not plays:
            return None
        started = plays[0][1]
    return ReadSession(
        key=path.name,
        started_at=started,
        ended_at=plays[-1][1] if plays else None,
        plays=plays,
    )


def read_traktor(path: Path, root_volume: str | None = None) -> ReadHistory:
    volume = root_volume or root_volume_name()
    out = ReadHistory()
    files = sorted(path.glob("*.nml")) if path.is_dir() else [path]
    for file in files:
        try:
            session = _traktor_file(file, volume)
        except (OSError, ValueError, SafeET.ParseError):
            out.warnings.append(HistoryWarning(code="unreadable_file", path=str(file)))
            continue
        if session is not None:
            out.sessions.append(session)
    return out


# ---- Serato ----


def _records(data: bytes) -> Iterable[tuple[bytes, bytes]]:
    i = 0
    while i + 8 <= len(data):
        (n,) = struct.unpack(">I", data[i + 4 : i + 8])
        if i + 8 + n > len(data):
            raise ValueError("a record runs past the end of the file")
        yield data[i : i + 4], data[i + 8 : i + 8 + n]
        i += 8 + n


def _fields(data: bytes) -> dict[int, bytes]:
    out: dict[int, bytes] = {}
    i = 0
    while i + 8 <= len(data):
        number, n = struct.unpack(">II", data[i : i + 8])
        if n > MAX_FIELD_BYTES or i + 8 + n > len(data):
            raise ValueError("a field runs past the end of its entry")
        out[number] = data[i + 8 : i + 8 + n]
        i += 8 + n
    return out


def _uint(value: bytes | None) -> int | None:
    if not value or len(value) > 8:
        return None
    return int.from_bytes(value, "big")


def _serato_path(stored: str, root: PurePath) -> str:
    if stored.startswith("/") or re.match(r"^[A-Za-z]:[\\/]", stored):
        return str(PureWindowsPath(stored)) if stored[1:2] == ":" else stored
    return str(root.joinpath(*[p for p in stored.replace("\\", "/").split("/") if p]))


def _serato_file(path: Path, root: PurePath) -> ReadSession | None:
    plays: list[tuple[str, datetime]] = []
    ends: list[datetime] = []
    for tag, body in _records(_read_bytes(path)):
        if tag != b"oent":
            continue
        for inner, value in _records(body):
            if inner != b"adat":
                continue
            fields = _fields(value)
            if _uint(fields.get(50)) == 0:
                continue
            raw = fields.get(2)
            start = _unix(_uint(fields.get(28)) or 0)
            if not raw or start is None:
                continue
            stored = raw.decode("utf-16-be", errors="replace").rstrip("\x00")
            plays.append((_serato_path(stored, root), start))
            end = _unix(_uint(fields.get(29)) or 0)
            if end is not None:
                ends.append(end)
    if not plays:
        return None
    plays.sort(key=lambda p: p[1])
    return ReadSession(
        key=path.name,
        started_at=plays[0][1],
        ended_at=max(ends) if ends else plays[-1][1],
        plays=plays,
    )


def read_serato(path: Path) -> ReadHistory:
    """``path``: the ``_Serato_`` folder, its ``History/Sessions`` folder or a session."""
    if path.is_dir() and (path / "History" / "Sessions").is_dir():
        path = path / "History" / "Sessions"
    serato_folder = path
    while serato_folder.name != "_Serato_" and serato_folder.parent != serato_folder:
        serato_folder = serato_folder.parent
    root = drive_root(serato_folder if serato_folder.name == "_Serato_" else path)
    out = ReadHistory()
    files = sorted(path.glob("*.session")) if path.is_dir() else [path]
    for file in files:
        try:
            session = _serato_file(file, root)
        except (OSError, ValueError, struct.error):
            out.warnings.append(HistoryWarning(code="unreadable_file", path=str(file)))
            continue
        if session is not None:
            out.sessions.append(session)
    return out


# ---- VirtualDJ ----

_VDJ_TAG = re.compile(r"<(lastplaytime|time)>([^<]*)</\1>")


def _vdj_day(file: Path) -> date | None:
    text = file.as_posix()
    found = _day(text)
    if found:
        return found
    m = re.search(r"(\d{4})/(\d{2})/(\d{2})\.m3u$", text)
    if m:
        try:
            return date(int(m[1]), int(m[2]), int(m[3]))
        except ValueError:
            return None
    return None


def _vdj_file(file: Path, folder: Path) -> ReadSession | None:
    day = _vdj_day(file)
    plays: list[tuple[str, datetime]] = []
    pending: datetime | None = None
    text = _read_bytes(file).decode("utf-8-sig", errors="replace")
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        if line.startswith("#"):
            if line.startswith("#EXTVDJ:"):
                tags = dict(_VDJ_TAG.findall(line))
                pending = None
                if tags.get("lastplaytime", "").isdigit():
                    pending = _unix(int(tags["lastplaytime"]))
                elif day and re.fullmatch(r"\d{1,2}:\d{2}", tags.get("time", "")):
                    hours, minutes = tags["time"].split(":")
                    pending = _local(day, int(hours) * 3600 + int(minutes) * 60)
            continue
        when = pending or (_local(day) if day else None)
        pending = None
        if when is not None:
            plays.append((line, when))
    if not plays:
        return None
    started = _local(day) if day else plays[0][1]
    return ReadSession(
        key=file.relative_to(folder).as_posix() if file.is_relative_to(folder) else file.name,
        started_at=min(started, plays[0][1]),
        ended_at=plays[-1][1],
        plays=plays,
    )


def read_virtualdj(path: Path) -> ReadHistory:
    """``path``: VirtualDJ's folder, its ``database.xml``, its ``History`` or one list."""
    if path.is_file() and path.suffix.lower() == ".xml":
        path = path.parent
    if path.is_dir() and (path / "History").is_dir():
        path = path / "History"
    out = ReadHistory()
    files = sorted(path.rglob("*.m3u")) if path.is_dir() else [path]
    folder = path if path.is_dir() else path.parent
    for file in files:
        try:
            session = _vdj_file(file, folder)
        except (OSError, ValueError):
            out.warnings.append(HistoryWarning(code="unreadable_file", path=str(file)))
            continue
        if session is not None:
            out.sessions.append(session)
    return out


# ---- Engine DJ ----


def _tables(conn: sqlite3.Connection) -> set[str]:
    return {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}


def read_engine_dj(path: Path) -> ReadHistory:
    """``path``: the Engine Library folder, its ``m.db`` or its ``hm.db``."""
    if path.is_dir():
        path = engine_export.resolve_database(str(path))
    database2 = path.parent
    history_db = database2 / "hm.db" if (database2 / "hm.db").is_file() else path
    main_db = database2 / "m.db"
    library_root = database2.parent
    out = ReadHistory()
    files = [
        p
        for name in {history_db.name, main_db.name}
        for p in (database2 / name, database2 / f"{name}-wal")
    ]
    with snapshot(*files) as folder:
        conn = sqlite3.connect(folder / history_db.name)
        try:
            tables = _tables(conn)
            if not {"Historylist", "HistorylistEntity"} <= tables:
                out.warnings.append(HistoryWarning(code="no_history", path=str(history_db)))
                return out
            if "Track" not in tables and (folder / main_db.name).is_file():
                conn.execute("ATTACH DATABASE ? AS main_db", (str(folder / main_db.name),))
                track_table = "main_db.Track"
            else:
                track_table = "Track"
            paths = {
                int(tid): os.path.normpath(
                    str(library_root.joinpath(*[p for p in str(stored).split("/") if p]))
                )
                for tid, stored in conn.execute(
                    f"SELECT id, path FROM {track_table} WHERE path IS NOT NULL"
                )
            }
            lists = conn.execute(
                "SELECT id, title, startTime FROM Historylist ORDER BY startTime, id"
            ).fetchall()
            for list_id, title, start in lists:
                plays = []
                for track_id, when in conn.execute(
                    "SELECT trackId, startTime FROM HistorylistEntity WHERE listId = ? "
                    "ORDER BY startTime, id",
                    (list_id,),
                ):
                    moment = _unix(float(when or 0)) or _unix(float(start or 0))
                    file_path = paths.get(int(track_id)) if track_id is not None else None
                    if moment is not None and file_path:
                        plays.append((file_path, moment))
                started = _unix(float(start or 0)) or (plays[0][1] if plays else None)
                if started is None:
                    continue
                out.sessions.append(
                    ReadSession(
                        key=f"{list_id}:{int(float(start or 0))}",
                        started_at=started,
                        name=title or None,
                        ended_at=plays[-1][1] if plays else None,
                        plays=plays,
                    )
                )
        except sqlite3.DatabaseError:
            out.warnings.append(HistoryWarning(code="unreadable_file", path=str(history_db)))
        finally:
            conn.close()
    return out


# ---- where each program keeps it ----


def default_path(source: ImportSource) -> Path | None:
    if source == "traktor":
        collection = traktor_nml.find_collection()
        folder = collection.parent / "History" if collection else None
        return folder if folder and folder.is_dir() else None
    if source == "serato":
        folder = serato_crates.find_serato_folder() / "History" / "Sessions"
        return folder if folder.is_dir() else None
    if source == "virtualdj":
        database = vdj_export.find_database()
        candidates = [database.parent / "History"] if database else []
        candidates.append(Path.home() / "Documents" / "VirtualDJ" / "History")
        return next((c for c in candidates if c.is_dir()), None)
    if source == "engine_dj":
        database = engine_export.find_database()
        if database is None:
            return None
        history_db = database.with_name("hm.db")
        return history_db if history_db.is_file() else database
    return None  # rekordbox.xml is wherever the DJ exported it


def detect() -> HistorySources:
    out = []
    for source in import_service.PROGRAMS:
        found = default_path(source)
        out.append(
            HistorySourceStatus(
                source=source,
                path=str(found) if found else None,
                running=import_service.running(source),
            )
        )
    return HistorySources(sources=out)


def _resolve(params: HistoryImportParams) -> Path:
    program = import_service.PROGRAMS[params.source]
    if params.path:
        path = Path(params.path)
        if params.source == "traktor" and path.name == "collection.nml":
            path = path.parent / "History"
    else:
        found = default_path(params.source)
        if found is None:
            raise CollectionNotFoundError(f"{program} history not found", program=program)
        path = found
    if not path.exists():
        raise CollectionNotFoundError(f"{program} history not found: {path}", program=program)
    return path


def read(source: ImportSource, path: Path) -> ReadHistory:
    if source == "rekordbox":
        if path.is_dir():
            raise CollectionNotFoundError(
                "choose the rekordbox.xml exported by Rekordbox", program="Rekordbox"
            )
        try:
            return read_rekordbox(path)
        except (OSError, ValueError, SafeET.ParseError):
            return ReadHistory(warnings=[HistoryWarning(code="unreadable_file", path=str(path))])
    if source == "traktor":
        return read_traktor(path)
    if source == "serato":
        return read_serato(path)
    if source == "virtualdj":
        return read_virtualdj(path)
    return read_engine_dj(path)


# ---- the statistics the table shows ----


def refresh_stats(conn: sqlite3.Connection, track_ids: Iterable[int] | None = None) -> None:
    """Recount ``play_stats`` for these tracks (all of them when None)."""
    select = (
        "SELECT track_id, sum(source = 'import'), sum(source = 'manual'), max(played_at) "
        "FROM plays {where} GROUP BY track_id"
    )
    if track_ids is None:
        conn.execute("DELETE FROM play_stats")
        conn.execute(
            "INSERT INTO play_stats (track_id, program_plays, manual_plays, last_played) "
            + select.format(where="")
        )
        return
    ids = sorted(set(track_ids))
    for start in range(0, len(ids), 500):
        chunk = ids[start : start + 500]
        marks = ", ".join("?" for _ in chunk)
        conn.execute(f"DELETE FROM play_stats WHERE track_id IN ({marks})", chunk)
        conn.execute(
            "INSERT INTO play_stats (track_id, program_plays, manual_plays, last_played) "
            + select.format(where=f"WHERE track_id IN ({marks})"),
            chunk,
        )


# ---- import ----


def import_history(
    db: Database,
    params: HistoryImportParams,
    progress: Callable[[str, float], None] = lambda stage, percent: None,
    check_cancelled: Callable[[], None] = lambda: None,
) -> HistoryImportResult:
    path = _resolve(params)
    progress("reading", 5)
    history = read(params.source, path)
    if import_service.running(params.source) and params.source == "engine_dj":
        history.warnings.insert(0, HistoryWarning(code="app_running"))
    if not history.sessions and not any(w.code == "no_history" for w in history.warnings):
        history.warnings.append(HistoryWarning(code="no_history", path=str(path)))
    check_cancelled()
    progress("matching", 30)
    index = import_service._Index.load(db)
    all_paths = list(dict.fromkeys(p for s in history.sessions for p, _ in s.plays))
    unmatched_paths = [p for p in all_paths if import_service.path_key(p) not in index.by_path]
    maps = import_service.detect_maps(unmatched_paths, index.paths)
    hashes: dict[str, str] = {}
    matched: dict[str, int | None] = {}
    for n, p in enumerate(all_paths):
        if n % 200 == 0:
            check_cancelled()
        matched[p] = import_service._match_one(ImportedTrack(path=p), index, maps, hashes).track_id
    progress("saving", 80)
    conn = db.conn
    new_sessions = plays = unmatched = 0
    touched: set[int] = set()
    missing: list[str] = []
    conn.execute("BEGIN")
    try:
        for session in history.sessions:
            key = f"{params.source}:{session.key}"
            row = conn.execute(
                "SELECT id FROM play_sessions WHERE source_key = ?", (key,)
            ).fetchone()
            values = (
                session.name,
                iso(session.started_at),
                iso(session.ended_at) if session.ended_at else None,
            )
            if row is None:
                cur = conn.execute(
                    "INSERT INTO play_sessions (program, source, source_key, name, started_at, "
                    "ended_at) VALUES (?, 'import', ?, ?, ?, ?)",
                    (params.source, key, *values),
                )
                session_id = int(cur.lastrowid or 0)
                new_sessions += 1
            else:
                session_id = int(row[0])
                touched |= {
                    int(r[0])
                    for r in conn.execute(
                        "SELECT track_id FROM plays WHERE session_id = ?", (session_id,)
                    )
                }
                conn.execute("DELETE FROM plays WHERE session_id = ?", (session_id,))
                conn.execute(
                    "UPDATE play_sessions SET name = ?, started_at = ?, ended_at = ?, "
                    "imported_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?",
                    (*values, session_id),
                )
            position = 0
            for file_path, when in session.plays:
                track_id = matched.get(file_path)
                if track_id is None:
                    unmatched += 1
                    if file_path not in missing:
                        missing.append(file_path)
                    continue
                conn.execute(
                    "INSERT INTO plays (track_id, played_at, source, session_id, program, "
                    "position) VALUES (?, ?, 'import', ?, ?, ?)",
                    (track_id, iso(when), session_id, params.source, position),
                )
                position += 1
                plays += 1
                touched.add(track_id)
        refresh_stats(conn, touched)
        conn.execute("COMMIT")
    except BaseException:
        conn.execute("ROLLBACK")
        raise
    progress("saving", 100)
    played = {matched[p] for s in history.sessions for p, _ in s.plays if matched.get(p)}
    return HistoryImportResult(
        source=params.source,
        path=str(path),
        sessions=len(history.sessions),
        new_sessions=new_sessions,
        plays=plays,
        tracks=len(played),
        unmatched=unmatched,
        unmatched_paths=missing[:UNMATCHED_LISTED],
        warnings=history.warnings,
    )


# ---- sessions ----


def list_sessions(db: Database, query: HistoryQuery) -> HistoryList:
    conn = db.conn
    total = int(conn.execute("SELECT count(*) FROM play_sessions").fetchone()[0])
    plays = int(conn.execute("SELECT count(*) FROM plays").fetchone()[0])
    played_tracks = int(
        conn.execute(
            "SELECT count(*) FROM tracks t LEFT JOIN play_stats ps ON ps.track_id = t.id "
            f"WHERE {TIMES_PLAYED} > 0"
        ).fetchone()[0]
    )
    rows = conn.execute(
        "SELECT s.id, s.program, s.source, s.name, s.started_at, s.ended_at, "
        "(SELECT count(*) FROM plays p WHERE p.session_id = s.id) AS tracks "
        "FROM play_sessions s ORDER BY s.started_at DESC, s.id DESC LIMIT ? OFFSET ?",
        (query.limit, query.offset),
    ).fetchall()
    return HistoryList(
        total=total,
        plays=plays,
        played_tracks=played_tracks,
        sessions=[PlaySession.model_validate(dict(r)) for r in rows],
    )


def _moment(text: str | None) -> datetime:
    now = datetime.now(UTC)
    if not text:
        return now
    try:
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
            day = date.fromisoformat(text)
            moment = now if day == datetime.now().date() else _local(day, 12 * 3600)
        else:
            moment = datetime.fromisoformat(text.replace("Z", "+00:00"))
            if moment.tzinfo is None:
                moment = moment.astimezone()
    except ValueError as exc:
        raise TonaliaError(f"not a date: {text!r}", reason="invalid_params") from exc
    if moment > now + timedelta(days=1):
        raise TonaliaError("a play cannot be in the future", reason="invalid_params")
    return moment


def mark_played(db: Database, params: HistoryMarkParams) -> HistoryMarkResult:
    conn = db.conn
    track_ids = list(params.track_ids)
    name = params.name.strip() if params.name else None
    if params.playlist_id is not None:
        row = conn.execute(
            "SELECT name, is_folder, smart_query FROM playlists WHERE id = ?",
            (params.playlist_id,),
        ).fetchone()
        if row is None:
            raise TonaliaError(
                f"unknown playlist {params.playlist_id}", reason="playlist_not_found"
            )
        if row["is_folder"] or row["smart_query"] is not None:
            raise TonaliaError("only a regular playlist can be marked", reason="playlist_kind")
        track_ids += [
            int(r[0])
            for r in conn.execute(
                "SELECT track_id FROM playlist_tracks WHERE playlist_id = ? ORDER BY position",
                (params.playlist_id,),
            )
        ]
        name = name or row["name"]
    track_ids = list(dict.fromkeys(track_ids))
    if track_ids:
        marks = ", ".join("?" for _ in track_ids)
        known = {
            int(r[0])
            for r in conn.execute(f"SELECT id FROM tracks WHERE id IN ({marks})", track_ids)
        }
        unknown = [t for t in track_ids if t not in known]
        if unknown:
            raise TonaliaError(f"unknown track {unknown[0]}", reason="track_not_found")
    if not track_ids:
        raise TonaliaError("nothing to mark: the playlist is empty", reason="invalid_params")
    when = iso(_moment(params.played_at))
    conn.execute("BEGIN")
    try:
        cur = conn.execute(
            "INSERT INTO play_sessions (program, source, source_key, name, started_at) "
            "VALUES (NULL, 'manual', ?, ?, ?)",
            (f"manual:{uuid.uuid4().hex}", name or None, when),
        )
        session_id = int(cur.lastrowid or 0)
        conn.executemany(
            "INSERT INTO plays (track_id, played_at, source, session_id, program, position) "
            "VALUES (?, ?, 'manual', ?, NULL, ?)",
            [(tid, when, session_id, n) for n, tid in enumerate(track_ids)],
        )
        refresh_stats(conn, track_ids)
        conn.execute("COMMIT")
    except BaseException:
        conn.execute("ROLLBACK")
        raise
    return HistoryMarkResult(session_id=session_id, plays=len(track_ids))


def delete_session(db: Database, session_id: int) -> HistoryDeleteResult:
    """Forget a session (its plays go; the tracks and the program's files stay)."""
    conn = db.conn
    if conn.execute("SELECT 1 FROM play_sessions WHERE id = ?", (session_id,)).fetchone() is None:
        raise SessionNotFoundError(session_id)
    tracks = [
        int(r[0])
        for r in conn.execute("SELECT track_id FROM plays WHERE session_id = ?", (session_id,))
    ]
    conn.execute("BEGIN")
    try:
        conn.execute("DELETE FROM plays WHERE session_id = ?", (session_id,))
        conn.execute("DELETE FROM play_sessions WHERE id = ?", (session_id,))
        refresh_stats(conn, tracks)
        conn.execute("COMMIT")
    except BaseException:
        conn.execute("ROLLBACK")
        raise
    return HistoryDeleteResult(session_id=session_id, plays=len(tracks))
