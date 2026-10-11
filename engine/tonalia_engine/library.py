"""Library import and queries.

Import rules (SPEC 1.4):
- folders are scanned recursively; hidden files (incl. macOS ``._*``) are skipped;
- a known path with unchanged size/mtime is left alone; if it changed, the content
  hash is recomputed and, when different, metadata is re-read and the track is flagged
  for re-analysis;
- an unknown path whose hash matches a track whose file no longer exists is a *move*:
  the track is relocated, keeping its analysis, cues and playlists;
- an unknown path whose hash matches a track whose file still exists is a duplicate
  copy and is skipped;
- unreadable files are stored with ``status='error'`` and the reason; they never stop
  the import.
"""

from __future__ import annotations

import os
import sqlite3
import unicodedata
from collections.abc import Iterable, Iterator, Sequence
from pathlib import Path
from typing import Any

import xxhash

from .db import Database
from .jobs import JobContext
from .metadata import MetadataError, TrackMetadata, read_metadata, save_artwork
from .rpc_schema import (
    AddPathsResult,
    FailedPath,
    LibraryPage,
    LibraryQuery,
    TrackDetail,
    TrackSummary,
)

SUPPORTED_EXTENSIONS = frozenset(
    {".mp3", ".wav", ".wave", ".aif", ".aiff", ".m4a", ".mp4", ".aac", ".flac", ".ogg", ".oga"}
)
HASH_CHUNK = 1024 * 1024
COMMIT_EVERY = 200

_SORT_SQL: dict[str, tuple[str, ...]] = {
    "title": ("COALESCE(t.title, t.path) COLLATE NOCASE",),
    "artist": ("t.artist COLLATE NOCASE",),
    "album": ("t.album COLLATE NOCASE",),
    "genre": ("t.genre COLLATE NOCASE",),
    "year": ("t.year",),
    "duration": ("t.duration",),
    "bpm": ("a.bpm",),
    "key": ("a.key_mode", "a.key_root"),
    "energy": ("a.energy",),
    "added_at": ("t.added_at",),
    "status": ("t.status",),
    "format": ("t.format",),
    "bitrate": ("t.bitrate",),
}

_SUMMARY_COLUMNS = """
t.id, t.path, t.title, t.artist, t.album, t.genre, t.year, t.duration, t.format, t.bitrate,
t.status, t.error, t.added_at, t.artwork_path,
a.key_root, a.key_mode, a.key_confidence, a.bpm, a.energy,
(SELECT count(*) FROM cues c WHERE c.track_id = t.id) AS cue_count
"""
_DETAIL_COLUMNS = (
    _SUMMARY_COLUMNS
    + ", t.sample_rate, t.label, t.comment, t.file_hash, t.size, t.analyzed_at, t.analysis_version"
)
_FROM = "FROM tracks t LEFT JOIN analysis a ON a.track_id = t.id"


def fold(text: str) -> str:
    """Case- and accent-insensitive form used for search ("Música" -> "musica")."""
    decomposed = unicodedata.normalize("NFKD", text)
    return "".join(c for c in decomposed if not unicodedata.combining(c)).casefold()


def search_text(path: str, meta: TrackMetadata) -> str:
    parts = [meta.title, meta.artist, meta.album, meta.genre, meta.label, path]
    return fold(" ".join(p for p in parts if p))


def _is_hidden(name: str) -> bool:
    return name.startswith(".")


def scan(paths: Iterable[Path]) -> Iterator[Path]:
    """Yield supported audio files under ``paths`` (files or folders), depth-first."""
    for root in paths:
        if root.is_file():
            if root.suffix.lower() in SUPPORTED_EXTENSIONS and not _is_hidden(root.name):
                yield root
            continue
        if not root.is_dir():
            continue
        for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
            dirnames[:] = sorted(d for d in dirnames if not _is_hidden(d))
            for name in sorted(filenames):
                if not _is_hidden(name) and Path(name).suffix.lower() in SUPPORTED_EXTENSIONS:
                    yield Path(dirpath) / name


def file_hash(path: Path) -> str:
    """xxh64 of the first and last 1 MB plus the size (fast, stable across moves)."""
    size = path.stat().st_size
    h = xxhash.xxh64()
    h.update(str(size).encode())
    with path.open("rb") as f:
        h.update(f.read(HASH_CHUNK))
        if size > HASH_CHUNK:
            f.seek(max(HASH_CHUNK, size - HASH_CHUNK))
            h.update(f.read(HASH_CHUNK))
    return h.hexdigest()


class Library:
    def __init__(self, db: Database, artwork_dir: Path) -> None:
        self.db = db
        self.artwork_dir = artwork_dir

    @property
    def conn(self) -> sqlite3.Connection:
        return self.db.conn

    # ---- import ----

    def add_paths(self, paths: Iterable[Path], ctx: JobContext) -> AddPathsResult:
        ctx.progress("scanning", 0, force=True)
        files = list(scan(paths))
        ctx.check_cancelled()
        result = AddPathsResult()
        total = len(files)
        self.conn.execute("BEGIN")
        try:
            for i, path in enumerate(files, 1):
                ctx.check_cancelled()
                try:
                    self._add_one(path, result)
                except OSError as exc:
                    result.failed.append(FailedPath(path=str(path), reason=str(exc)))
                if i % COMMIT_EVERY == 0:
                    self.conn.execute("COMMIT")
                    self.conn.execute("BEGIN")
                ctx.progress("importing", i / total * 100, done=i, total=total)
            self.conn.execute("COMMIT")
        except BaseException:
            # Keep everything imported so far: partial imports are valid imports.
            if self.conn.in_transaction:
                self.conn.execute("COMMIT")
            raise
        ctx.progress("importing", 100, done=total, total=total, force=True)
        return result

    def _add_one(self, path: Path, result: AddPathsResult) -> None:
        stat = path.stat()
        key = str(path)
        row = self.conn.execute(
            "SELECT id, size, mtime, file_hash FROM tracks WHERE path = ?", (key,)
        ).fetchone()
        if row is not None:
            if row["size"] == stat.st_size and row["mtime"] == stat.st_mtime:
                result.unchanged += 1
                return
            digest = file_hash(path)
            if digest == row["file_hash"]:
                self.conn.execute(
                    "UPDATE tracks SET size = ?, mtime = ? WHERE id = ?",
                    (stat.st_size, stat.st_mtime, row["id"]),
                )
                result.unchanged += 1
                return
            self._write_track(path, stat, digest, track_id=row["id"])
            result.updated += 1
            return

        digest = file_hash(path)
        for candidate in self.conn.execute(
            "SELECT id, path FROM tracks WHERE file_hash = ? AND size = ?", (digest, stat.st_size)
        ).fetchall():
            if Path(candidate["path"]).exists():
                result.duplicates += 1
                return
            self.conn.execute(
                "UPDATE tracks SET path = ?, mtime = ?, "
                "search_text = replace(search_text, ?, ?) WHERE id = ?",
                (key, stat.st_mtime, fold(candidate["path"]), fold(key), candidate["id"]),
            )
            result.moved += 1
            return
        self._write_track(path, stat, digest)
        result.added += 1

    def _write_track(
        self, path: Path, stat: os.stat_result, digest: str, track_id: int | None = None
    ) -> None:
        key = str(path)
        try:
            meta = read_metadata(path)
            error = None
        except MetadataError as exc:
            meta, error = TrackMetadata(), str(exc)
        artwork = str(save_artwork(meta.artwork, self.artwork_dir)) if meta.artwork else None
        values: dict[str, Any] = {
            "path": key,
            "file_hash": digest,
            "size": stat.st_size,
            "mtime": stat.st_mtime,
            "format": meta.format or path.suffix.lower().lstrip(".") or None,
            "duration": meta.duration,
            "sample_rate": meta.sample_rate,
            "bitrate": meta.bitrate,
            "title": meta.title,
            "artist": meta.artist,
            "album": meta.album,
            "genre": meta.genre,
            "year": meta.year,
            "label": meta.label,
            "comment": meta.comment,
            "artwork_path": artwork,
            "status": "error" if error else "pending",
            "error": error,
            "search_text": search_text(key, meta),
        }
        if track_id is None:
            cols = ", ".join(values)
            marks = ", ".join(f":{c}" for c in values)
            self.conn.execute(f"INSERT INTO tracks ({cols}) VALUES ({marks})", values)
        else:
            sets = ", ".join(f"{c} = :{c}" for c in values)
            self.conn.execute(
                f"UPDATE tracks SET {sets} WHERE id = :id", {**values, "id": track_id}
            )

    # ---- queries ----

    def list(self, query: LibraryQuery) -> LibraryPage:
        where: list[str] = []
        args: list[Any] = []
        if query.search:
            for token in fold(query.search).split():
                escaped = token.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
                where.append("t.search_text LIKE ? ESCAPE '\\'")
                args.append(f"%{escaped}%")
        if query.status:
            where.append("t.status = ?")
            args.append(query.status)
        clause = f"WHERE {' AND '.join(where)}" if where else ""
        total = self.conn.execute(
            f"SELECT count(*) {_FROM} {clause}",
            args,
        ).fetchone()[0]
        direction = "DESC" if query.descending else "ASC"
        order = ", ".join(f"{col} {direction} NULLS LAST" for col in _SORT_SQL[query.sort])
        sql = (
            f"SELECT {_SUMMARY_COLUMNS} {_FROM} {clause} "
            f"ORDER BY {order}, t.id {direction} LIMIT ? OFFSET ?"
        )
        rows = self.conn.execute(sql, [*args, query.limit, query.offset]).fetchall()
        return LibraryPage(total=total, items=[TrackSummary.model_validate(dict(r)) for r in rows])

    def get(self, track_id: int) -> TrackDetail:
        row = self.conn.execute(
            f"SELECT {_DETAIL_COLUMNS} {_FROM} WHERE t.id = ?", (track_id,)
        ).fetchone()
        if row is None:
            raise KeyError(track_id)
        return TrackDetail.model_validate(dict(row))

    def remove(self, track_ids: Sequence[int]) -> int:
        """Remove tracks from the library. Audio files are never touched."""
        removed = 0
        for start in range(0, len(track_ids), 500):
            chunk = list(track_ids[start : start + 500])
            marks = ", ".join("?" for _ in chunk)
            removed += self.conn.execute(
                f"DELETE FROM tracks WHERE id IN ({marks})", chunk
            ).rowcount
        return removed
