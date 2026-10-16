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

import json
import os
import sqlite3
import unicodedata
from collections.abc import Iterable, Iterator, Sequence
from pathlib import Path
from typing import Any

import xxhash

from .analysis.vocals import vocal_kind
from .cues import list_cues, list_segments
from .db import Database
from .errors import TonaliaError, classify
from .filters import QUALITY_PENDING, TIMES_PLAYED, filter_sql, validate_filter
from .jobs import JobContext
from .metadata import MetadataError, TrackMetadata, read_metadata, save_artwork
from .rpc_schema import (
    AddPathsResult,
    FailedPath,
    GenreCount,
    GenreList,
    KeyCount,
    LibraryPage,
    LibraryQuery,
    LibraryStats,
    TrackDetail,
    TrackFilter,
    TrackSummary,
    TrackUpdateParams,
)

SUPPORTED_EXTENSIONS = frozenset(
    {".mp3", ".wav", ".wave", ".aif", ".aiff", ".m4a", ".mp4", ".aac", ".flac", ".ogg", ".oga"}
)
HASH_CHUNK = 1024 * 1024
COMMIT_EVERY = 200

_SORT_SQL: dict[str, tuple[str, ...]] = {
    "title": ("t.display_title COLLATE NOCASE",),
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
    "times_played": (TIMES_PLAYED,),
    "last_played": ("ps.last_played",),
}

_SUMMARY_COLUMNS = (
    """
t.id, t.path, t.title, t.artist, t.album, t.genre, t.year, t.duration, t.format, t.bitrate,
t.status, t.error, t.error_info, t.added_at, t.artwork_path,
a.key_root, a.key_mode, a.key_confidence, a.bpm, a.energy,
COALESCE(a.edited_fields, '[]') AS edited_fields,
COALESCE(a.quality_flags, '[]') AS quality_flags,
COALESCE(a.quality_reviewed, '[]') AS quality_reviewed,
(SELECT count(*) FROM cues c WHERE c.track_id = t.id) AS cue_count,
(SELECT json_group_array(json_object('slot', d.slot, 'color', d.color))
   FROM (SELECT slot, color FROM cues c WHERE c.track_id = t.id ORDER BY slot) d) AS cue_dots,
"""
    + f"{TIMES_PLAYED} AS times_played, ps.last_played AS last_played"
)
_DETAIL_COLUMNS = (
    _SUMMARY_COLUMNS
    + ", t.sample_rate, t.label, t.comment, t.file_hash, t.size, t.analyzed_at, t.analysis_version"
    + ", a.key_alternatives, a.key_secondary_root, a.key_secondary_mode, a.key_secondary_start"
    + ", a.tuning_hz, a.bpm_confidence, a.beat_grid, a.energy_curve"
    + ", a.loudness_lufs, a.peak_db, a.clipping_ratio, a.cutoff_hz, a.silence_start, a.silence_end"
    + ", a.waveform_path, a.vocal_presence, a.vocal_source"
    + ", COALESCE(a.grid_source, 'auto') AS grid_source, COALESCE(a.grid_locked, 0) AS grid_locked"
    + ", t.rating, t.play_count"
)
_FROM = (
    "FROM tracks t LEFT JOIN analysis a ON a.track_id = t.id"
    " LEFT JOIN play_stats ps ON ps.track_id = t.id"
)


def _row(row: sqlite3.Row) -> dict[str, Any]:
    data = dict(row)
    data["edited_fields"] = json.loads(data.get("edited_fields") or "[]")
    data["quality_flags"] = json.loads(data.get("quality_flags") or "[]")
    data["quality_reviewed"] = json.loads(data.get("quality_reviewed") or "[]")
    data["cue_dots"] = json.loads(data.get("cue_dots") or "[]")
    info = data.get("error_info")
    data["error_info"] = json.loads(info) if info else None
    return data


def summaries(conn: sqlite3.Connection, track_ids: list[int]) -> dict[int, TrackSummary]:
    """Table rows of these tracks, by id (missing ids are left out)."""
    out: dict[int, TrackSummary] = {}
    for start in range(0, len(track_ids), 500):  # stay under SQLite's variable limit
        chunk = track_ids[start : start + 500]
        marks = ", ".join("?" for _ in chunk)
        for row in conn.execute(
            f"SELECT {_SUMMARY_COLUMNS} {_FROM} WHERE t.id IN ({marks})", chunk
        ):
            out[row["id"]] = TrackSummary.model_validate(_row(row))
    return out


def fold(text: str) -> str:
    """Case- and accent-insensitive form used for search ("Música" -> "musica")."""
    decomposed = unicodedata.normalize("NFKD", text)
    return "".join(c for c in decomposed if not unicodedata.combining(c)).casefold()


def search_text(path: str, meta: TrackMetadata) -> str:
    parts = [meta.title, meta.artist, meta.album, meta.genre, meta.label, path]
    return fold(" ".join(p for p in parts if p))


def display_title(path: Path, title: str | None) -> str:
    """Name used to sort by title: the tag, or the file name for untagged files."""
    return title or path.stem


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
                    result.failed.append(
                        FailedPath(path=str(path), reason=str(exc), info=classify(exc))
                    )
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
                "search_text = replace(search_text, ?, ?), "
                "display_title = CASE WHEN title IS NULL THEN ? ELSE display_title END "
                "WHERE id = ?",
                (
                    key,
                    stat.st_mtime,
                    fold(candidate["path"]),
                    fold(key),
                    path.stem,
                    candidate["id"],
                ),
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
            error = info = None
        except MetadataError as exc:
            meta, error, info = TrackMetadata(), str(exc), classify(exc).model_dump_json()
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
            "error_info": info,
            "search_text": search_text(key, meta),
            "display_title": display_title(path, meta.title),
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
        source = _FROM
        if query.search:
            for token in fold(query.search).split():
                escaped = token.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
                where.append("t.search_text LIKE ? ESCAPE '\\'")
                args.append(f"%{escaped}%")
        if query.status:
            where.append("t.status = ?")
            args.append(query.status)
        if query.quality_issues is not None:
            where.append(QUALITY_PENDING if query.quality_issues else f"NOT {QUALITY_PENDING}")
        if query.filter is not None:
            validate_filter(self.conn, query.filter)
            conditions, values = filter_sql(query.filter)
            where += conditions
            args += values
        position = False
        if query.playlist_id is not None:
            playlist = self.conn.execute(
                "SELECT is_folder, smart_query FROM playlists WHERE id = ?", (query.playlist_id,)
            ).fetchone()
            if playlist is None:
                raise TonaliaError(
                    f"unknown playlist {query.playlist_id}", reason="playlist_not_found"
                )
            if playlist["is_folder"]:
                raise TonaliaError("folders have no tracks of their own", reason="folder_no_tracks")
            if playlist["smart_query"] is not None:
                conditions, values = filter_sql(
                    TrackFilter.model_validate_json(playlist["smart_query"])
                )
                where += conditions
                args += values
            else:
                source = f"{_FROM} JOIN playlist_tracks pt ON pt.track_id = t.id"
                where.append("pt.playlist_id = ?")
                args.append(query.playlist_id)
                position = True
        if query.session_id is not None:
            if query.playlist_id is not None:
                raise TonaliaError("a play session is not a playlist", reason="invalid_params")
            if (
                self.conn.execute(
                    "SELECT 1 FROM play_sessions WHERE id = ?", (query.session_id,)
                ).fetchone()
                is None
            ):
                raise TonaliaError(
                    f"unknown play session {query.session_id}", reason="session_not_found"
                )
            # A track played twice in the session is listed once, where it was first played.
            source += (
                " JOIN (SELECT track_id, min(position) AS position FROM plays"
                " WHERE session_id = ? GROUP BY track_id) pt ON pt.track_id = t.id"
            )
            args.insert(0, query.session_id)
            position = True
        clause = f"WHERE {' AND '.join(where)}" if where else ""
        total = self.conn.execute(
            f"SELECT count(*) {source} {clause}",
            args,
        ).fetchone()[0]
        direction = "DESC" if query.descending else "ASC"
        sort = query.sort
        if sort == "position" and not position:
            sort = "added_at"
        columns = ("pt.position",) if sort == "position" else _SORT_SQL[sort]
        order = ", ".join(f"{col} {direction} NULLS LAST" for col in columns)
        sql = (
            f"SELECT {_SUMMARY_COLUMNS} {source} {clause} "
            f"ORDER BY {order}, t.id {direction} LIMIT ? OFFSET ?"
        )
        rows = self.conn.execute(sql, [*args, query.limit, query.offset]).fetchall()
        return LibraryPage(total=total, items=[TrackSummary.model_validate(_row(r)) for r in rows])

    def get(self, track_id: int) -> TrackDetail:
        row = self.conn.execute(
            f"SELECT {_DETAIL_COLUMNS} {_FROM} WHERE t.id = ?", (track_id,)
        ).fetchone()
        if row is None:
            raise KeyError(track_id)
        data = _row(row)
        data["key_alternatives"] = json.loads(data["key_alternatives"] or "[]")
        sec_root, sec_mode = data.pop("key_secondary_root"), data.pop("key_secondary_mode")
        data["key_secondary"] = (
            {"root": sec_root, "mode": sec_mode} if sec_root is not None and sec_mode else None
        )
        data["beat_grid"] = json.loads(data["beat_grid"]) if data["beat_grid"] else None
        data["energy_curve"] = json.loads(data["energy_curve"] or "[]")
        data["segments"] = list_segments(self.db, track_id)
        data["cues"] = list_cues(self.db, track_id)
        data["markers"] = [
            dict(r)
            for r in self.conn.execute(
                "SELECT kind, position_sec, length_sec, label, color, source FROM markers "
                "WHERE track_id = ? ORDER BY position_sec",
                (track_id,),
            )
        ]
        if data["vocal_source"] in ("model", "stems"):
            data["vocal_kind"] = vocal_kind(data["vocal_presence"])
        data["grid_locked"] = bool(data["grid_locked"])
        return TrackDetail.model_validate(data)

    def review_quality(self, track_ids: Sequence[int], reviewed: bool) -> int:
        """Mark the current quality flags of these tracks as reviewed (they leave "Revisar
        calidad" until a new flag shows up), or clear that mark. Returns how many changed."""
        marks = ", ".join("?" for _ in track_ids)
        value = "COALESCE(quality_flags, '[]')" if reviewed else "NULL"
        with self.conn:
            cur = self.conn.execute(
                f"UPDATE analysis SET quality_reviewed = {value} WHERE track_id IN ({marks})",
                track_ids,
            )
        return cur.rowcount

    def update(self, params: TrackUpdateParams) -> TrackDetail:
        """Apply a manual edit; edited fields are protected from later analyses."""
        tid = params.track_id
        if self.conn.execute("SELECT 1 FROM tracks WHERE id = ?", (tid,)).fetchone() is None:
            raise KeyError(tid)
        values: dict[str, Any] = {}
        edited: list[str] = []
        if "key" in params.model_fields_set:
            key = params.key
            values |= {
                "key_root": key.root if key else None,
                "key_mode": key.mode if key else None,
                "key_confidence": None,
            }
            edited.append("key")
        if "bpm" in params.model_fields_set:
            values |= {"bpm": params.bpm, "bpm_confidence": None}
            edited.append("bpm")
        if "energy" in params.model_fields_set:
            values["energy"] = params.energy
            edited.append("energy")
        if edited:
            self.conn.execute("BEGIN")
            try:
                self.conn.execute(
                    "INSERT INTO analysis (track_id) VALUES (?) ON CONFLICT DO NOTHING", (tid,)
                )
                row = self.conn.execute(
                    "SELECT edited_fields FROM analysis WHERE track_id = ?", (tid,)
                ).fetchone()
                fields = sorted(set(json.loads(row[0] or "[]")) | set(edited))
                sets = ", ".join(f"{col} = :{col}" for col in values)
                self.conn.execute(
                    f"UPDATE analysis SET {sets}, edited_fields = :edited WHERE track_id = :tid",
                    {**values, "edited": json.dumps(fields), "tid": tid},
                )
                self.conn.execute("COMMIT")
            except BaseException:
                self.conn.execute("ROLLBACK")
                raise
        return self.get(tid)

    def stats(self) -> LibraryStats:
        """Key and energy distribution of the analysed tracks (the Analyse view)."""
        total = self.conn.execute("SELECT count(*) FROM tracks").fetchone()[0]
        analysed = self.conn.execute(
            "SELECT count(*) FROM analysis WHERE key_root IS NOT NULL OR bpm IS NOT NULL"
        ).fetchone()[0]
        keys = self.conn.execute(
            "SELECT key_root, key_mode, count(*) AS n FROM analysis "
            "WHERE key_root IS NOT NULL AND key_mode IN ('major', 'minor') "
            "GROUP BY key_root, key_mode ORDER BY n DESC, key_mode, key_root"
        ).fetchall()
        energy = [0] * 10
        for level, n in self.conn.execute(
            "SELECT energy, count(*) FROM analysis WHERE energy BETWEEN 1 AND 10 GROUP BY energy"
        ):
            energy[int(level) - 1] = int(n)
        return LibraryStats(
            total=int(total),
            analysed=int(analysed),
            keys=[KeyCount(root=int(r), mode=m, count=int(n)) for r, m, n in keys],
            energy=energy,
        )

    def genres(self) -> GenreList:
        """Genres in use, most used first; case variants are counted together under
        their most common spelling (for autocomplete)."""
        rows = self.conn.execute(
            "SELECT genre, count(*) AS n FROM tracks "
            "WHERE genre IS NOT NULL AND trim(genre) != '' GROUP BY genre"
        ).fetchall()
        groups: dict[str, list[tuple[str, int]]] = {}
        for genre, n in rows:
            groups.setdefault(fold(genre.strip()), []).append((genre.strip(), n))
        out = [
            GenreCount(name=max(variants, key=lambda v: v[1])[0], count=sum(n for _, n in variants))
            for variants in groups.values()
        ]
        out.sort(key=lambda g: (-g.count, g.name.casefold()))
        return GenreList(genres=out)

    def remove(self, track_ids: Sequence[int]) -> int:
        """Remove tracks from the library. Audio files are never touched; only Tonalia's
        own cache (waveforms) for those tracks is deleted."""
        removed = 0
        for start in range(0, len(track_ids), 500):
            chunk = list(track_ids[start : start + 500])
            marks = ", ".join("?" for _ in chunk)
            caches = [
                Path(r[0])
                for r in self.conn.execute(
                    f"SELECT waveform_path FROM analysis WHERE track_id IN ({marks}) "
                    "AND waveform_path IS NOT NULL",
                    chunk,
                )
            ]
            removed += self.conn.execute(
                f"DELETE FROM tracks WHERE id IN ({marks})", chunk
            ).rowcount
            for cache in caches:
                if cache.parent.name == "waveforms" and cache.suffix == ".twf":
                    cache.unlink(missing_ok=True)
        return removed
