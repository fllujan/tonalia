"""Segments and cue points in the database (SPEC 2.6).

Automatic cues are derived from the stored segments and beatgrid, so "reset to
automatic" needs no new analysis. The user's cues (``source = 'user'``) are never
overwritten: automatic cues only use the free slots and keep clear of the user's
positions.
"""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from typing import Any

from .analysis.structure import Segment, auto_cues
from .analysis.tempo import BeatGrid
from .db import Database
from .rpc_schema import Cue, CueSetParams, SegmentInfo

SLOTS = range(8)
DEFAULT_CUE_COUNT = 8


@contextmanager
def transaction(conn: sqlite3.Connection) -> Iterator[None]:
    """BEGIN/COMMIT unless a transaction is already open (then the caller owns it)."""
    if conn.in_transaction:
        yield
        return
    conn.execute("BEGIN")
    try:
        yield
        conn.execute("COMMIT")
    except BaseException:
        conn.execute("ROLLBACK")
        raise


def _require_track(db: Database, track_id: int) -> None:
    if db.conn.execute("SELECT 1 FROM tracks WHERE id = ?", (track_id,)).fetchone() is None:
        raise KeyError(track_id)


def list_cues(db: Database, track_id: int) -> list[Cue]:
    rows = db.conn.execute(
        "SELECT slot, position_sec, label, color, source FROM cues WHERE track_id = ? "
        "ORDER BY slot",
        (track_id,),
    ).fetchall()
    return [Cue.model_validate(dict(r)) for r in rows]


def list_segments(db: Database, track_id: int) -> list[SegmentInfo]:
    rows = db.conn.execute(
        "SELECT start_sec AS start, end_sec AS end, label, energy FROM segments "
        "WHERE track_id = ? ORDER BY start_sec",
        (track_id,),
    ).fetchall()
    return [SegmentInfo.model_validate(dict(r)) for r in rows]


def save_segments(db: Database, track_id: int, segments: Sequence[dict[str, Any]]) -> None:
    db.conn.execute("DELETE FROM segments WHERE track_id = ?", (track_id,))
    db.conn.executemany(
        "INSERT INTO segments (track_id, start_sec, end_sec, label, energy) VALUES (?, ?, ?, ?, ?)",
        [(track_id, s["start"], s["end"], s["label"], s.get("energy")) for s in segments],
    )


def cue_count(db: Database) -> int:
    return int(db.get_setting("cue_count", DEFAULT_CUE_COUNT))


def refresh_auto_cues(db: Database, track_id: int, max_cues: int | None = None) -> None:
    """Replace the automatic cues of a track from its stored segments and beatgrid."""
    max_cues = cue_count(db) if max_cues is None else max_cues
    with transaction(db.conn):
        db.conn.execute("DELETE FROM cues WHERE track_id = ? AND source = 'auto'", (track_id,))
        row = db.conn.execute(
            "SELECT beat_grid FROM analysis WHERE track_id = ?", (track_id,)
        ).fetchone()
        segments = [Segment(s.start, s.end, s.label, s.energy) for s in list_segments(db, track_id)]
        if row is None or not row[0] or not segments:
            return
        grid = BeatGrid(**json.loads(row[0]))
        user = list_cues(db, track_id)
        free = [slot for slot in SLOTS if slot not in {c.slot for c in user}]
        cues = auto_cues(
            segments,
            grid,
            max_cues=min(max_cues, len(free)),
            reserved=[c.position_sec for c in user],
        )
        db.conn.executemany(
            "INSERT INTO cues (track_id, slot, position_sec, label, color, source) "
            "VALUES (?, ?, ?, ?, ?, 'auto')",
            [
                (track_id, slot, cue.position, cue.label, cue.color)
                for slot, cue in zip(free, cues, strict=False)
            ],
        )


def set_cue(db: Database, params: CueSetParams) -> Cue:
    _require_track(db, params.track_id)
    db.conn.execute(
        "INSERT INTO cues (track_id, slot, position_sec, label, color, source) "
        "VALUES (?, ?, ?, ?, ?, 'user') ON CONFLICT (track_id, slot) DO UPDATE SET "
        "position_sec = excluded.position_sec, label = excluded.label, "
        "color = excluded.color, source = 'user'",
        (params.track_id, params.slot, params.position_sec, params.label, params.color),
    )
    return next(c for c in list_cues(db, params.track_id) if c.slot == params.slot)


def delete_cue(db: Database, track_id: int, slot: int) -> bool:
    _require_track(db, track_id)
    cursor = db.conn.execute("DELETE FROM cues WHERE track_id = ? AND slot = ?", (track_id, slot))
    return cursor.rowcount > 0


def reset_auto_cues(db: Database, track_id: int) -> list[Cue]:
    """Drop the user's cues and recompute the automatic ones ("Restablecer automáticos")."""
    _require_track(db, track_id)
    with transaction(db.conn):
        db.conn.execute("DELETE FROM cues WHERE track_id = ?", (track_id,))
        refresh_auto_cues(db, track_id)
    return list_cues(db, track_id)
