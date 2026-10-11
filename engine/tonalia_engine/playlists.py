"""Folders, playlists and smart playlists (SPEC 2.11), plus M3U/M3U8 import and export.

- Folders and playlists nest without a depth limit; only folders can have children.
- Regular playlists keep an ordered list of tracks, without repeats (adding a track that
  is already there is a no-op). Positions are rewritten 0..n-1 on every change.
- Smart playlists store a :class:`TrackFilter`; their tracks are computed on demand.
- Exports never overwrite silently: an existing file is copied to the backups folder
  first and the new one is written atomically.
"""

from __future__ import annotations

import os
import shutil
import time
import unicodedata
from collections.abc import Iterable, Sequence
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse

from .cues import transaction
from .db import Database
from .filters import filter_sql, validate_filter
from .fsutil import write_atomic
from .jobs import JobContext
from .library import SUPPORTED_EXTENSIONS, Library
from .rpc_schema import (
    M3UExportParams,
    M3UExportResult,
    M3UImportParams,
    M3UImportResult,
    PlaylistCreateParams,
    PlaylistMoveParams,
    PlaylistNode,
    PlaylistTracksParams,
    PlaylistTracksResult,
    PlaylistUpdateParams,
    TrackFilter,
)

M3U_EXTENSIONS = frozenset({".m3u", ".m3u8"})
_COLUMNS = "id, parent_id, name, emoji, is_folder, sort_order, smart_query"


class PlaylistError(ValueError):
    """Invalid playlist operation (reported to the client as invalid params)."""


def _clean_name(name: str) -> str:
    cleaned = " ".join(name.split())
    if not cleaned:
        raise PlaylistError("the name cannot be empty")
    return cleaned


def _clean_emoji(emoji: str | None) -> str | None:
    return emoji.strip() or None if emoji is not None else None


class Playlists:
    def __init__(self, db: Database) -> None:
        self.db = db

    @property
    def conn(self) -> Any:
        return self.db.conn

    # ---- tree ----

    def _row(self, playlist_id: int) -> Any:
        row = self.conn.execute(
            f"SELECT {_COLUMNS} FROM playlists WHERE id = ?", (playlist_id,)
        ).fetchone()
        if row is None:
            raise PlaylistError(f"unknown playlist {playlist_id}")
        return row

    def _node(self, row: Any) -> PlaylistNode:
        smart = (
            TrackFilter.model_validate_json(row["smart_query"])
            if row["smart_query"] is not None
            else None
        )
        if row["is_folder"]:
            count = 0
        elif smart is not None:
            where, args = filter_sql(smart)
            clause = f"WHERE {' AND '.join(where)}" if where else ""
            count = self.conn.execute(
                "SELECT count(*) FROM tracks t LEFT JOIN analysis a ON a.track_id = t.id " + clause,
                args,
            ).fetchone()[0]
        else:
            count = self.conn.execute(
                "SELECT count(*) FROM playlist_tracks WHERE playlist_id = ?", (row["id"],)
            ).fetchone()[0]
        return PlaylistNode(
            id=row["id"],
            parent_id=row["parent_id"],
            name=row["name"],
            emoji=row["emoji"],
            is_folder=bool(row["is_folder"]),
            sort_order=row["sort_order"],
            smart=smart,
            track_count=count,
        )

    def _validate(self, smart: TrackFilter | None) -> None:
        if smart is not None:
            try:
                validate_filter(self.conn, smart)
            except ValueError as exc:
                raise PlaylistError(str(exc)) from None

    def get(self, playlist_id: int) -> PlaylistNode:
        return self._node(self._row(playlist_id))

    def tree(self) -> list[PlaylistNode]:
        rows = self.conn.execute(
            f"SELECT {_COLUMNS} FROM playlists ORDER BY sort_order, id"
        ).fetchall()
        children: dict[int | None, list[Any]] = {}
        for row in rows:
            children.setdefault(row["parent_id"], []).append(row)
        ordered: list[PlaylistNode] = []

        def walk(parent: int | None) -> None:
            for row in children.get(parent, []):
                ordered.append(self._node(row))
                walk(row["id"])

        walk(None)
        return ordered

    def _require_folder(self, parent_id: int | None) -> None:
        if parent_id is not None and not self._row(parent_id)["is_folder"]:
            raise PlaylistError("only folders can contain playlists")

    def _siblings(self, parent_id: int | None, exclude: int | None = None) -> list[int]:
        rows = self.conn.execute(
            "SELECT id FROM playlists WHERE parent_id IS ? AND id IS NOT ? ORDER BY sort_order, id",
            (parent_id, exclude),
        ).fetchall()
        return [r[0] for r in rows]

    def _renumber(self, ids: Sequence[int]) -> None:
        self.conn.executemany(
            "UPDATE playlists SET sort_order = ? WHERE id = ?",
            [(i, pid) for i, pid in enumerate(ids)],
        )

    def create(self, p: PlaylistCreateParams) -> PlaylistNode:
        name = _clean_name(p.name)
        if p.is_folder and p.smart is not None:
            raise PlaylistError("a folder cannot be a smart playlist")
        self._validate(p.smart)
        with transaction(self.conn):
            self._require_folder(p.parent_id)
            order = len(self._siblings(p.parent_id))
            cur = self.conn.execute(
                "INSERT INTO playlists (parent_id, name, emoji, is_folder, sort_order, "
                "smart_query) VALUES (?, ?, ?, ?, ?, ?)",
                (
                    p.parent_id,
                    name,
                    _clean_emoji(p.emoji),
                    int(p.is_folder),
                    order,
                    p.smart.model_dump_json(by_alias=True) if p.smart is not None else None,
                ),
            )
        return self.get(int(cur.lastrowid))

    def update(self, p: PlaylistUpdateParams) -> PlaylistNode:
        row = self._row(p.playlist_id)
        sets: dict[str, Any] = {}
        if p.name is not None:
            sets["name"] = _clean_name(p.name)
        if p.emoji is not None:
            sets["emoji"] = _clean_emoji(p.emoji)
        if p.smart is not None:
            if row["smart_query"] is None:
                raise PlaylistError("only smart playlists have a query")
            self._validate(p.smart)
            sets["smart_query"] = p.smart.model_dump_json(by_alias=True)
        if sets:
            assignments = ", ".join(f"{col} = :{col}" for col in sets)
            self.conn.execute(
                f"UPDATE playlists SET {assignments} WHERE id = :id", {**sets, "id": row["id"]}
            )
        return self.get(row["id"])

    def move(self, p: PlaylistMoveParams) -> list[PlaylistNode]:
        with transaction(self.conn):
            row = self._row(p.playlist_id)
            self._require_folder(p.parent_id)
            ancestor = p.parent_id
            while ancestor is not None:
                if ancestor == row["id"]:
                    raise PlaylistError("a folder cannot be moved inside itself")
                ancestor = self._row(ancestor)["parent_id"]
            old_parent = row["parent_id"]
            self.conn.execute(
                "UPDATE playlists SET parent_id = ? WHERE id = ?", (p.parent_id, row["id"])
            )
            siblings = self._siblings(p.parent_id, exclude=row["id"])
            siblings.insert(min(p.index, len(siblings)), row["id"])
            self._renumber(siblings)
            if old_parent != p.parent_id:
                self._renumber(self._siblings(old_parent))
        return self.tree()

    def delete(self, playlist_id: int) -> int:
        row = self._row(playlist_id)
        count = self.conn.execute(
            "WITH RECURSIVE sub(id) AS (SELECT ? UNION ALL "
            "SELECT p.id FROM playlists p JOIN sub ON p.parent_id = sub.id) "
            "SELECT count(*) FROM sub",
            (playlist_id,),
        ).fetchone()[0]
        with transaction(self.conn):
            # ON DELETE CASCADE removes nested playlists and their track lists.
            self.conn.execute("DELETE FROM playlists WHERE id = ?", (playlist_id,))
            self._renumber(self._siblings(row["parent_id"]))
        return int(count)

    # ---- tracks of regular playlists ----

    def _regular(self, playlist_id: int) -> Any:
        row = self._row(playlist_id)
        if row["is_folder"]:
            raise PlaylistError("folders have no tracks of their own")
        if row["smart_query"] is not None:
            raise PlaylistError("smart playlists are filled by their query")
        return row

    def track_ids(self, playlist_id: int) -> list[int]:
        rows = self.conn.execute(
            "SELECT track_id FROM playlist_tracks WHERE playlist_id = ? ORDER BY position",
            (playlist_id,),
        ).fetchall()
        return [r[0] for r in rows]

    def _write_tracks(self, playlist_id: int, ids: Sequence[int]) -> None:
        self.conn.execute("DELETE FROM playlist_tracks WHERE playlist_id = ?", (playlist_id,))
        self.conn.executemany(
            "INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)",
            [(playlist_id, tid, i) for i, tid in enumerate(ids)],
        )

    def _require_tracks(self, track_ids: Iterable[int]) -> None:
        wanted = set(track_ids)
        marks = ", ".join("?" for _ in wanted)
        found = {
            r[0]
            for r in self.conn.execute(f"SELECT id FROM tracks WHERE id IN ({marks})", list(wanted))
        }
        if missing := wanted - found:
            raise PlaylistError(f"unknown tracks {sorted(missing)}")

    def add_tracks(self, p: PlaylistTracksParams) -> PlaylistTracksResult:
        with transaction(self.conn):
            self._regular(p.playlist_id)
            self._require_tracks(p.track_ids)
            current = self.track_ids(p.playlist_id)
            present = set(current)
            new = [tid for tid in dict.fromkeys(p.track_ids) if tid not in present]
            at = len(current) if p.index is None else min(p.index, len(current))
            self._write_tracks(p.playlist_id, current[:at] + new + current[at:])
        return PlaylistTracksResult(changed=len(new), track_count=len(current) + len(new))

    def remove_tracks(self, p: PlaylistTracksParams) -> PlaylistTracksResult:
        with transaction(self.conn):
            self._regular(p.playlist_id)
            current = self.track_ids(p.playlist_id)
            drop = set(p.track_ids)
            kept = [tid for tid in current if tid not in drop]
            self._write_tracks(p.playlist_id, kept)
        return PlaylistTracksResult(changed=len(current) - len(kept), track_count=len(kept))

    def reorder_tracks(self, p: PlaylistTracksParams) -> PlaylistTracksResult:
        with transaction(self.conn):
            self._regular(p.playlist_id)
            current = self.track_ids(p.playlist_id)
            move = set(p.track_ids)
            moving = [tid for tid in current if tid in move]
            rest = [tid for tid in current if tid not in move]
            at = len(rest) if p.index is None else min(p.index, len(rest))
            self._write_tracks(p.playlist_id, rest[:at] + moving + rest[at:])
        return PlaylistTracksResult(changed=len(moving), track_count=len(current))

    def ordered_tracks(self, playlist_id: int) -> list[Any]:
        """Rows (path, title, artist, duration) of a playlist or smart playlist, in order."""
        row = self._row(playlist_id)
        if row["is_folder"]:
            raise PlaylistError("folders cannot be exported")
        select = "SELECT t.path, t.title, t.artist, t.duration FROM tracks t "
        if row["smart_query"] is None:
            return list(
                self.conn.execute(
                    select + "JOIN playlist_tracks pt ON pt.track_id = t.id "
                    "WHERE pt.playlist_id = ? ORDER BY pt.position",
                    (playlist_id,),
                )
            )
        where, args = filter_sql(TrackFilter.model_validate_json(row["smart_query"]))
        clause = f"WHERE {' AND '.join(where)}" if where else ""
        return list(
            self.conn.execute(
                select + "LEFT JOIN analysis a ON a.track_id = t.id "
                f"{clause} ORDER BY t.display_title COLLATE NOCASE, t.id",
                args,
            )
        )

    # ---- M3U ----

    def import_m3u(self, p: M3UImportParams, library: Library) -> M3UImportResult:
        source = Path(p.path)
        if source.suffix.lower() not in M3U_EXTENSIONS:
            raise PlaylistError("only .m3u and .m3u8 playlists can be imported")
        try:
            raw = source.read_bytes()
        except OSError as exc:
            raise PlaylistError(f"cannot read {source.name}: {exc.strerror}") from None
        entries = parse_m3u(raw)

        ids: list[int] = []
        missing: list[str] = []
        imported = 0
        unknown: list[tuple[int, Path]] = []
        for entry in entries:
            path = resolve_entry(entry, source.parent)
            tid = self._find_track(path) if path is not None else None
            if tid is not None:
                ids.append(tid)
            elif (
                path is not None and path.suffix.lower() in SUPPORTED_EXTENSIONS and path.is_file()
            ):
                unknown.append((len(ids), path))
                ids.append(-1)
            else:
                missing.append(entry)
        if unknown:
            library.add_paths([path for _, path in unknown], JobContext("m3u", _SilentNotifier()))
            for slot, path in unknown:
                tid = self._find_track(path)
                if tid is None:
                    missing.append(str(path))
                else:
                    ids[slot] = tid
                    imported += 1
        node = self.create(PlaylistCreateParams(parent_id=p.parent_id, name=source.stem or "M3U"))
        unique = list(dict.fromkeys(t for t in ids if t >= 0))
        with transaction(self.conn):
            self._write_tracks(node.id, unique)
        return M3UImportResult(
            playlist=self.get(node.id),
            matched=len(unique) - imported,
            imported=imported,
            missing=missing,
        )

    def _find_track(self, path: Path) -> int | None:
        text = str(path)
        candidates = dict.fromkeys(
            [text, unicodedata.normalize("NFC", text), unicodedata.normalize("NFD", text)]
        )
        for candidate in candidates:
            row = self.conn.execute("SELECT id FROM tracks WHERE path = ?", (candidate,)).fetchone()
            if row is not None:
                return int(row[0])
        return None

    def export_m3u(self, p: M3UExportParams, backup_dir: Path) -> M3UExportResult:
        target = Path(p.path)
        if target.suffix.lower() not in M3U_EXTENSIONS:
            raise PlaylistError("the file must end in .m3u or .m3u8")
        if not target.parent.is_dir():
            raise PlaylistError(f"the folder {target.parent} does not exist")
        rows = self.ordered_tracks(p.playlist_id)
        lines = ["#EXTM3U"]
        for row in rows:
            seconds = round(row["duration"]) if row["duration"] is not None else -1
            label = " - ".join(x for x in (row["artist"], row["title"]) if x)
            lines.append(f"#EXTINF:{seconds},{label or Path(row['path']).stem}")
            lines.append(_entry_path(Path(row["path"]), target.parent, p.relative))
        backup: Path | None = None
        if target.exists():
            backup_dir.mkdir(parents=True, exist_ok=True)
            stamp = time.strftime("%Y%m%d-%H%M%S")
            backup = backup_dir / f"{stamp}-{target.name}"
            n = 1
            while backup.exists():
                backup = backup_dir / f"{stamp}-{n}-{target.name}"
                n += 1
            shutil.copy2(target, backup)
        data = ("\n".join(lines) + "\n").encode("utf-8")
        write_atomic(target, data, keep_mode_of=target)
        return M3UExportResult(
            path=str(target),
            written=len(rows),
            backup_path=str(backup) if backup is not None else None,
        )


class _SilentNotifier:
    def notify(self, method: str, params: Any) -> None:
        pass


def parse_m3u(raw: bytes) -> list[str]:
    """Track entries of an M3U/M3U8 file (UTF-8, falling back to Windows-1252)."""
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw.decode("cp1252", errors="replace")
    entries = []
    for line in text.splitlines():
        entry = line.strip()
        if entry and not entry.startswith("#"):
            entries.append(entry)
    return entries


def resolve_entry(entry: str, base: Path) -> Path | None:
    """Local path an entry points to, or None for remote URLs."""
    if "://" in entry:
        url = urlparse(entry)
        if url.scheme != "file":
            return None
        local = unquote(url.path)
        if os.name == "nt" and local.startswith("/") and local[2:3] == ":":
            local = local[1:]  # file:///C:/Music/x.mp3
        return Path(local)
    if os.name != "nt" and "\\" in entry and "/" not in entry:
        entry = entry.replace("\\", "/")  # relative Windows-style entries
    path = Path(entry)
    if not path.is_absolute():
        path = base / path
    return Path(os.path.normpath(path))


def _entry_path(path: Path, base: Path, relative: bool) -> str:
    if relative:
        try:
            return os.path.relpath(path, base)
        except ValueError:
            pass  # another drive on Windows: keep it absolute
    return str(path)
