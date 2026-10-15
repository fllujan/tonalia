"""Mashup favorites (SPEC 2.15): a combination of two tracks saved with a rating and notes.

A favorite keeps what was heard: tracks, mode (Mashup or DJ Mix), each deck's key change,
where each deck played from (``cue_a``/``cue_b``), each deck's stem and the tempo multiple
B was matched to A at. Saving the same combination again (same tracks, mode, key changes
and stems) updates it instead of adding a duplicate. Favorites go away with their tracks
(ON DELETE CASCADE).
"""

from __future__ import annotations

import sqlite3
from typing import Any

from .cues import transaction
from .db import Database
from .errors import TonaliaError
from .library import summaries
from .rpc_schema import (
    Favorite,
    FavoriteListParams,
    FavoriteSaveParams,
    FavoriteUpdateParams,
)

_COLUMNS = (
    "id, track_a, track_b, mode, shift_a, shift_b, cue_a, cue_b, stem_a, stem_b, bpm_factor,"
    " rating, notes, created_at"
)


class FavoriteError(TonaliaError, ValueError):
    """Invalid favorite (reported to the client as invalid params)."""

    reason = "favorite_not_found"


def _clean_notes(notes: str | None) -> str | None:
    return notes.strip() or None if notes is not None else None


class Favorites:
    def __init__(self, db: Database) -> None:
        self.conn = db.conn

    def _favorites(self, rows: list[sqlite3.Row]) -> list[Favorite]:
        tracks = summaries(self.conn, sorted({r[k] for r in rows for k in ("track_a", "track_b")}))
        out: list[Favorite] = []
        for r in rows:
            a, b = tracks.get(r["track_a"]), tracks.get(r["track_b"])
            if a is None or b is None:
                continue
            fields: dict[str, Any] = {k: r[k] for k in r.keys()}  # noqa: SIM118 (sqlite3.Row)
            fields["bpm_factor"] = float(r["bpm_factor"])
            out.append(Favorite.model_validate({**fields, "a": a, "b": b}))
        return out

    def get(self, favorite_id: int) -> Favorite:
        row = self.conn.execute(
            f"SELECT {_COLUMNS} FROM favorites WHERE id = ?", (favorite_id,)
        ).fetchone()
        found = self._favorites([row]) if row else []
        if not found:
            raise FavoriteError(f"unknown favorite {favorite_id}", reason="favorite_not_found")
        return found[0]

    def list(self, params: FavoriteListParams) -> list[Favorite]:
        order = "rating DESC, created_at DESC, id DESC" if params.sort == "rating" else ""
        rows = self.conn.execute(
            f"SELECT {_COLUMNS} FROM favorites ORDER BY {order or 'created_at DESC, id DESC'}"
        ).fetchall()
        return self._favorites(rows)

    def save(self, p: FavoriteSaveParams) -> Favorite:
        if p.track_a == p.track_b:
            raise FavoriteError("a favorite needs two different tracks", reason="favorite_same")
        known = {
            r[0]
            for r in self.conn.execute(
                "SELECT id FROM tracks WHERE id IN (?, ?)", (p.track_a, p.track_b)
            )
        }
        missing = [t for t in (p.track_a, p.track_b) if t not in known]
        if missing:
            raise FavoriteError(f"unknown track {missing[0]}", reason="track_not_found")
        notes = _clean_notes(p.notes)
        combination = (p.track_a, p.track_b, p.mode, p.shift_a, p.shift_b, p.stem_a, p.stem_b)
        with transaction(self.conn):
            row = self.conn.execute(
                "SELECT id, notes FROM favorites WHERE track_a = ? AND track_b = ? AND mode = ?"
                " AND shift_a = ? AND shift_b = ? AND stem_a = ? AND stem_b = ?",
                combination,
            ).fetchone()
            if row:
                favorite_id = int(row["id"])
                self.conn.execute(
                    "UPDATE favorites SET cue_a = ?, cue_b = ?, bpm_factor = ?, rating = ?,"
                    " notes = ? WHERE id = ?",
                    (
                        p.cue_a,
                        p.cue_b,
                        float(p.bpm_factor),
                        p.rating,
                        notes if notes is not None else row["notes"],
                        favorite_id,
                    ),
                )
            else:
                cur = self.conn.execute(
                    "INSERT INTO favorites (track_a, track_b, mode, shift_a, shift_b, stem_a,"
                    " stem_b, cue_a, cue_b, bpm_factor, rating, notes)"
                    " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (*combination, p.cue_a, p.cue_b, float(p.bpm_factor), p.rating, notes),
                )
                favorite_id = int(cur.lastrowid or 0)
        return self.get(favorite_id)

    def update(self, p: FavoriteUpdateParams) -> Favorite:
        current = self.get(p.favorite_id)
        sent = p.model_fields_set
        rating = p.rating if "rating" in sent and p.rating is not None else current.rating
        notes = _clean_notes(p.notes) if "notes" in sent else current.notes
        with transaction(self.conn):
            self.conn.execute(
                "UPDATE favorites SET rating = ?, notes = ? WHERE id = ?",
                (rating, notes, p.favorite_id),
            )
        return self.get(p.favorite_id)

    def delete(self, favorite_id: int) -> bool:
        with transaction(self.conn):
            cur = self.conn.execute("DELETE FROM favorites WHERE id = ?", (favorite_id,))
        return cur.rowcount > 0
