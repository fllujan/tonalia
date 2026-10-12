"""Tag write batches: preview, write with undo records, undo (SPEC 2.9, 2.10).

Three kinds of batch share the same safe path: analysis results (key, BPM, energy,
comment template), cleaning rules and mass edits of any field.

Every write belongs to a batch. For each file the undo record (``tag_backups``) is
stored *before* the verified copy replaces the original, so a crash can never leave a
written file without its backup. After writing or undoing, the library row is updated
(comment, size, mtime, hash) so the file is not mistaken for a modified one.
"""

from __future__ import annotations

import json
import uuid
from collections.abc import Callable, Mapping, Sequence
from pathlib import Path

from ..db import Database
from ..jobs import JobContext
from ..keys import Key
from ..library import display_title, file_hash, search_text
from ..metadata import MetadataError, read_metadata
from ..rpc_schema import (
    CleanRules,
    FailedPath,
    TagBatchInfo,
    TagChange,
    TagOptions,
    TagPreviewItem,
    TagUndoResult,
    TagWriteResult,
)
from .backup import UndoRefusedError, restore
from .cleaner import TEXT_FIELDS as CLEANABLE
from .cleaner import clean_fields
from .writer import (
    FieldChange,
    PreparedWrite,
    TagValues,
    TagWriteError,
    plan_changes,
    plan_fields,
    prepare_write,
    read_fields,
)

#: Builds the field changes for one track: (track id, path) -> changes.
Planner = Callable[[int, Path], list[FieldChange]]


def values_for(db: Database, track_id: int) -> tuple[Path, TagValues] | None:
    row = db.conn.execute(
        "SELECT t.path, a.key_root, a.key_mode, a.key_alternatives, a.bpm, a.energy "
        "FROM tracks t LEFT JOIN analysis a ON a.track_id = t.id WHERE t.id = ?",
        (track_id,),
    ).fetchone()
    if row is None:
        return None
    key = Key(row["key_root"], row["key_mode"]) if row["key_root"] is not None else None
    alternatives = json.loads(row["key_alternatives"] or "[]")
    alt = Key(alternatives[0]["root"], alternatives[0]["mode"]) if alternatives else None
    return Path(row["path"]), TagValues(key, alt, row["bpm"], row["energy"])


def _changes(items: Sequence[FieldChange]) -> list[TagChange]:
    return [TagChange.model_validate(c.__dict__) for c in items]


def _path(db: Database, track_id: int) -> Path | None:
    row = db.conn.execute("SELECT path FROM tracks WHERE id = ?", (track_id,)).fetchone()
    return Path(row[0]) if row else None


def results_planner(db: Database, options: TagOptions) -> Planner:
    def plan(track_id: int, path: Path) -> list[FieldChange]:
        found = values_for(db, track_id)
        return plan_changes(path, found[1], options) if found else []

    return plan


def clean_planner(rules: CleanRules) -> Planner:
    def plan(_: int, path: Path) -> list[FieldChange]:
        return plan_fields(path, clean_fields(read_fields(path, CLEANABLE), rules))

    return plan


def edit_planner(values: dict[str, str]) -> Planner:
    def plan(_: int, path: Path) -> list[FieldChange]:
        return plan_fields(path, values)

    return plan


def preview(db: Database, track_ids: Sequence[int], planner: Planner) -> list[TagPreviewItem]:
    out = []
    for tid in track_ids:
        path = _path(db, tid)
        if path is None:
            continue
        try:
            changes = _changes(planner(tid, path))
            out.append(TagPreviewItem(track_id=tid, path=str(path), changes=changes))
        except (TagWriteError, OSError) as exc:
            out.append(TagPreviewItem(track_id=tid, path=str(path), changes=[], error=str(exc)))
    return out


def _sync_library(db: Database, track_id: int, path: Path) -> None:
    """Keep the library row in step with the file Tonalia just rewrote."""
    stat = path.stat()
    try:
        meta = read_metadata(path)
    except MetadataError:
        db.conn.execute(
            "UPDATE tracks SET size = ?, mtime = ?, file_hash = ? WHERE id = ?",
            (stat.st_size, stat.st_mtime, file_hash(path), track_id),
        )
        return
    db.conn.execute(
        "UPDATE tracks SET title = ?, artist = ?, album = ?, genre = ?, year = ?, label = ?, "
        "comment = ?, search_text = ?, display_title = ?, size = ?, mtime = ?, file_hash = ? "
        "WHERE id = ?",
        (
            meta.title,
            meta.artist,
            meta.album,
            meta.genre,
            meta.year,
            meta.label,
            meta.comment,
            search_text(str(path), meta),
            display_title(path, meta.title),
            stat.st_size,
            stat.st_mtime,
            file_hash(path),
            track_id,
        ),
    )


Preparer = Callable[[int, Path], PreparedWrite | None]


def write_batch(
    db: Database,
    track_ids: Sequence[int],
    planner: Planner | None,
    description: Mapping[str, object],
    job: JobContext,
    prepare: Preparer | None = None,
) -> TagWriteResult:
    """Apply ``planner`` (text fields) or ``prepare`` (any verified change, e.g. Serato
    markers) to every track, with backup and undo; ``description`` (kind and options) is
    stored with the batch for the history."""
    if prepare is None:
        if planner is None:
            raise ValueError("write_batch needs a planner or a preparer")
        text_planner = planner

        def prepare(tid: int, path: Path) -> PreparedWrite | None:
            return prepare_write(path, text_planner(tid, path))

    batch_id = uuid.uuid4().hex
    db.conn.execute(
        "INSERT INTO tag_batches (id, options) VALUES (?, ?)",
        (batch_id, json.dumps(description, ensure_ascii=False)),
    )
    result = TagWriteResult(batch_id=batch_id)
    fields: list[str] = []
    titles: list[str] = []
    for done, tid in enumerate(track_ids, 1):
        if job.cancelled:
            break
        path = _path(db, tid)
        if path is None:
            continue
        try:
            prepared = prepare(tid, path)
            if prepared is None:
                result.unchanged += 1
            else:
                changes = [c.__dict__ for c in prepared.changes]
                db.conn.execute(
                    "INSERT INTO tag_backups (batch_id, track_id, path, original_tags, changes) "
                    "VALUES (?, ?, ?, ?, ?)",
                    (batch_id, tid, str(path), prepared.patch, json.dumps(changes)),
                )
                try:
                    prepared.commit()
                except BaseException:
                    prepared.discard()
                    db.conn.execute(
                        "DELETE FROM tag_backups WHERE batch_id = ? AND track_id = ?",
                        (batch_id, tid),
                    )
                    raise
                _sync_library(db, tid, path)
                result.written += 1
                fields.extend(c.field for c in prepared.changes if c.field not in fields)
                if len(titles) < HISTORY_TITLES:
                    titles.append(_title(db, tid, path))
        except (TagWriteError, OSError) as exc:
            result.failed.append(FailedPath(path=str(path), reason=str(exc)))
        job.progress("writing", 100 * done / len(track_ids), done=done, total=len(track_ids))
    summary = json.dumps({"fields": fields, "titles": titles}, ensure_ascii=False)
    db.conn.execute(
        "UPDATE tag_batches SET written = ?, summary = ? WHERE id = ?",
        (result.written, summary, batch_id),
    )
    return result


HISTORY_TITLES = 3


def _title(db: Database, track_id: int, path: Path) -> str:
    row = db.conn.execute("SELECT display_title FROM tracks WHERE id = ?", (track_id,)).fetchone()
    return (row["display_title"] if row else "") or path.stem


def history(db: Database, limit: int) -> list[TagBatchInfo]:
    """The latest batches that changed at least one file, newest first, with how many
    files can still be restored. Batches written before the summary existed (schema < 11)
    describe themselves from their remaining backups."""
    rows = db.conn.execute(
        "SELECT b.id, b.created_at, b.options, b.written, b.undone_at, b.summary, "
        "(SELECT COUNT(*) FROM tag_backups k WHERE k.batch_id = b.id) AS undoable "
        "FROM tag_batches b WHERE b.written > 0 ORDER BY b.created_at DESC, b.rowid DESC "
        "LIMIT ?",
        (limit,),
    ).fetchall()
    items = []
    for row in rows:
        summary = json.loads(row["summary"]) if row["summary"] else _legacy_summary(db, row["id"])
        kind = json.loads(row["options"]).get("kind", "results")
        items.append(
            TagBatchInfo(
                batch_id=row["id"],
                kind=str(kind),
                created_at=row["created_at"],
                written=row["written"],
                undone_at=row["undone_at"],
                undoable=row["undoable"],
                fields=summary.get("fields", []),
                titles=summary.get("titles", []),
            )
        )
    return items


def _legacy_summary(db: Database, batch_id: str) -> dict[str, list[str]]:
    fields: list[str] = []
    titles: list[str] = []
    for row in db.conn.execute(
        "SELECT track_id, path, changes FROM tag_backups WHERE batch_id = ?", (batch_id,)
    ):
        for change in json.loads(row["changes"] or "[]"):
            if change.get("field") not in fields:
                fields.append(change["field"])
        if len(titles) < HISTORY_TITLES:
            titles.append(_title(db, row["track_id"], Path(row["path"])))
    return {"fields": fields, "titles": titles}


def batch_exists(db: Database, batch_id: str) -> bool:
    return (
        db.conn.execute("SELECT 1 FROM tag_batches WHERE id = ?", (batch_id,)).fetchone()
        is not None
    )


def undo_batch(db: Database, batch_id: str, job: JobContext) -> TagUndoResult:
    rows = db.conn.execute(
        "SELECT track_id, path, original_tags FROM tag_backups WHERE batch_id = ?", (batch_id,)
    ).fetchall()
    result = TagUndoResult(batch_id=batch_id)
    for done, row in enumerate(rows, 1):
        path = Path(row["path"])
        try:
            restore(path, row["original_tags"])
        except (UndoRefusedError, OSError) as exc:
            result.skipped.append(FailedPath(path=str(path), reason=str(exc)))
        else:
            db.conn.execute(
                "DELETE FROM tag_backups WHERE batch_id = ? AND track_id = ?",
                (batch_id, row["track_id"]),
            )
            if db.conn.execute("SELECT 1 FROM tracks WHERE id = ?", (row["track_id"],)).fetchone():
                _sync_library(db, row["track_id"], path)
            result.restored += 1
        job.progress("restoring", 100 * done / len(rows), done=done, total=len(rows))
    if not result.skipped:
        db.conn.execute(
            "UPDATE tag_batches SET undone_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?",
            (batch_id,),
        )
    return result
