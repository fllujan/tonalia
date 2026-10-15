"""Personal energy (SPEC 12.2): the user's ratings calibrate the energy model.

- ``rating_queue`` picks analysed, unrated tracks spread over every energy level and genre
  of the library, each with the start of a 20 s excerpt from its drop.
- ``rate`` stores (or clears) one rating; ``import_preview`` / ``import_ratings`` read
  levels the user already wrote in comments, grouping or rating tags.
- ``calibrate`` fits weights and sigmoid by ridge regression (``energy_calibration``) once
  there are ``MIN_RATINGS``, reports the MAE before and after, and applies it on request:
  every level of the library is recomputed from the stored block descriptors, without
  decoding the audio. ``revert`` goes back to the default model the same way.

Energies edited by hand never change; their curve still follows the active model.
"""

from __future__ import annotations

import json
import re
from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import numpy as np

from .analysis.energy import EnergyModel, track_energy
from .analysis.energy_calibration import Calibration, calibrate
from .db import Database
from .errors import TonaliaError
from .tags.writer import TagWriteError, read_fields

MIN_RATINGS = 30
EXCERPT_SECONDS = 20.0
MODEL_SETTING = "energy_model"  # "default" | "personal"
PARAMS_SETTING = "energy_personal"  # the calibration: weights, sigmoid and its report
DEFAULT_PATTERNS = ("Energy {n}", "E{n}", "{n} - ", "{n}")
IMPORT_FIELDS = ("comment", "grouping", "rating")
# Other programs keep star ratings in the rating tag, so it is read only when asked.
DEFAULT_IMPORT_FIELDS = ("comment", "grouping")


class NotEnoughRatingsError(TonaliaError):
    def __init__(self, count: int) -> None:
        super().__init__(
            f"{count} ratings, {MIN_RATINGS} needed to calibrate",
            reason="not_enough_ratings",
            count=count,
            needed=MIN_RATINGS,
        )


# ---- the active model ----


def personal_params(db: Database) -> dict[str, Any] | None:
    """The calibration the analysis uses, or None while the default model is active."""
    if db.get_setting(MODEL_SETTING, "default") != "personal":
        return None
    params = db.get_setting(PARAMS_SETTING)
    return params if isinstance(params, dict) else None


def active_model(db: Database) -> EnergyModel:
    return EnergyModel.load().with_params(personal_params(db))


# ---- queue and ratings ----


@dataclass(frozen=True)
class QueueEntry:
    track_id: int
    start: float  # seconds: the excerpt to listen to
    energy: int  # the level the active model gives it


def _spread(seed: int) -> int:
    return (seed * 2654435761) % 2**32  # deterministic shuffle, stable between calls


def rating_queue(db: Database, n: int) -> list[QueueEntry]:
    """Up to ``n`` unrated analysed tracks covering every energy level and genre.

    Levels with fewer ratings come first, then round-robin over the levels; within a
    level, genres with fewer ratings first. Only tracks with stored block descriptors
    can calibrate, so the others (analysed before 12.2) wait for a reanalysis."""
    rows = db.conn.execute(
        "SELECT t.id, t.genre, t.duration, a.energy, a.energy_curve, "
        "(SELECT MIN(s.start_sec) FROM segments s WHERE s.track_id = t.id AND s.label = 'drop') "
        "FROM tracks t JOIN analysis a ON a.track_id = t.id "
        "WHERE t.status = 'ready' AND a.energy IS NOT NULL AND a.energy_blocks IS NOT NULL "
        "AND t.id NOT IN (SELECT track_id FROM energy_ratings)"
    ).fetchall()
    rated = db.conn.execute(
        "SELECT a.energy, lower(coalesce(t.genre, '')) FROM energy_ratings r "
        "JOIN tracks t ON t.id = r.track_id JOIN analysis a ON a.track_id = t.id"
    ).fetchall()
    level_count = Counter(level for level, _ in rated)
    genre_count = Counter(genre for _, genre in rated)
    by_level: dict[int, list[tuple[int, float]]] = {}
    for tid, genre, duration, energy, curve, drop in rows:
        by_level.setdefault(int(energy), []).append((tid, _excerpt(duration, curve, drop)))
        genre_count.setdefault(str(genre or "").lower(), 0)
    genres = {tid: str(genre or "").lower() for tid, genre, *_ in rows}
    for level, items in by_level.items():
        items.sort(key=lambda it: (genre_count[genres[it[0]]], _spread(it[0])))
        # Interleave genres inside the level: one per genre before repeating any.
        seen: Counter[str] = Counter()
        ranked = []
        for tid, start in items:
            ranked.append((seen[genres[tid]], genre_count[genres[tid]], _spread(tid), tid, start))
            seen[genres[tid]] += 1
        by_level[level] = [(tid, start) for *_, tid, start in sorted(ranked)]
    levels = sorted(by_level, key=lambda lv: (level_count[lv], lv))
    out: list[QueueEntry] = []
    while len(out) < n and any(by_level[lv] for lv in levels):
        for level in levels:
            if by_level[level] and len(out) < n:
                tid, start = by_level[level].pop(0)
                out.append(QueueEntry(tid, start, level))
    return out


def _excerpt(duration: float | None, curve_json: str | None, drop: float | None) -> float:
    """Start of the excerpt: the first drop, else the most energetic block."""
    start = drop
    if start is None and curve_json:
        curve = json.loads(curve_json)
        if curve:
            start = float(max(curve, key=lambda b: b["level"])["start"])
    start = float(start or 0.0)
    if duration:
        start = min(start, max(0.0, float(duration) - EXCERPT_SECONDS))
    return round(max(0.0, start), 2)


def rate(db: Database, track_id: int, rating: int | None, source: str = "listen") -> None:
    """Store the user's rating 1-10 of a track (None removes it)."""
    if db.conn.execute("SELECT 1 FROM tracks WHERE id = ?", (track_id,)).fetchone() is None:
        raise KeyError(track_id)
    if rating is None:
        db.conn.execute("DELETE FROM energy_ratings WHERE track_id = ?", (track_id,))
        return
    db.conn.execute(
        "INSERT INTO energy_ratings (track_id, rating, source) VALUES (?, ?, ?) "
        "ON CONFLICT(track_id) DO UPDATE SET rating = excluded.rating, "
        "source = excluded.source, rated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
        (track_id, int(rating), source),
    )


@dataclass(frozen=True)
class Status:
    ratings: int
    usable: int  # ratings of tracks with stored descriptors (what a calibration uses)
    needed: int
    model: str  # "default" | "personal"
    calibration: dict[str, Any] | None  # tracks, maeBefore, maeAfter, calibratedAt
    histogram: list[int]  # ratings per level 1-10
    needs_reanalysis: int  # analysed tracks without descriptors (before SPEC 12.2)


def status(db: Database) -> Status:
    hist = [0] * 10
    for rating, count in db.conn.execute(
        "SELECT rating, COUNT(*) FROM energy_ratings GROUP BY rating"
    ):
        hist[int(rating) - 1] = int(count)
    usable = db.conn.execute(
        "SELECT COUNT(*) FROM energy_ratings r JOIN analysis a ON a.track_id = r.track_id "
        "WHERE a.energy_blocks IS NOT NULL"
    ).fetchone()[0]
    old = db.conn.execute(
        "SELECT COUNT(*) FROM analysis WHERE energy IS NOT NULL AND energy_blocks IS NULL"
    ).fetchone()[0]
    params = db.get_setting(PARAMS_SETTING)
    report = params.get("report") if isinstance(params, dict) else None
    return Status(
        ratings=sum(hist),
        usable=int(usable),
        needed=MIN_RATINGS,
        model="personal" if personal_params(db) is not None else "default",
        calibration=report if isinstance(report, dict) else None,
        histogram=hist,
        needs_reanalysis=int(old),
    )


# ---- calibration ----


@dataclass(frozen=True)
class CalibrationOutcome:
    calibration: Calibration
    applied: bool
    updated: int  # tracks whose level or curve was recomputed


def calibrate_library(db: Database, apply: bool) -> CalibrationOutcome:
    """Fit the energy model to the user's ratings; with ``apply``, make it the active one."""
    rows = db.conn.execute(
        "SELECT r.rating, a.energy_blocks FROM energy_ratings r "
        "JOIN analysis a ON a.track_id = r.track_id WHERE a.energy_blocks IS NOT NULL "
        "ORDER BY r.track_id"
    ).fetchall()
    blocks = [np.asarray(json.loads(b), dtype=np.float64) for _, b in rows]
    kept = [(r, b) for (r, _), b in zip(rows, blocks, strict=True) if b.ndim == 2 and len(b)]
    if len(kept) < MIN_RATINGS:
        raise NotEnoughRatingsError(len(kept))
    fit = calibrate([b for _, b in kept], np.array([float(r) for r, _ in kept]))
    updated = 0
    if apply:
        report = {
            "tracks": fit.tracks,
            "maeBefore": fit.mae_before,
            "maeAfter": fit.mae_after,
            "calibratedAt": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        }
        db.set_setting(PARAMS_SETTING, {**fit.params(), "report": report})
        db.set_setting(MODEL_SETTING, "personal")
        updated = recompute(db, active_model(db))
    return CalibrationOutcome(fit, apply, updated)


def revert(db: Database) -> int:
    """Back to the default model; the calibration is kept to apply again. Returns the
    number of tracks recomputed."""
    db.set_setting(MODEL_SETTING, "default")
    return recompute(db, EnergyModel.load())


def recompute(db: Database, model: EnergyModel) -> int:
    """Levels and curves of every track with stored descriptors, under ``model``."""
    rows = db.conn.execute(
        "SELECT track_id, energy_blocks, energy_curve, edited_fields FROM analysis "
        "WHERE energy_blocks IS NOT NULL AND energy_curve IS NOT NULL"
    ).fetchall()
    updates: list[tuple[int | None, str, int]] = []
    for track_id, blocks_json, curve_json, edited_json in rows:
        raw = np.asarray(json.loads(blocks_json), dtype=np.float64)
        curve = json.loads(curve_json)
        if raw.ndim != 2 or len(raw) != len(curve) or not len(raw):
            continue
        levels = model.levels(raw)
        new_curve = [
            {**block, "level": round(float(lv), 2)} for block, lv in zip(curve, levels, strict=True)
        ]
        edited = "energy" in json.loads(edited_json or "[]")
        updates.append((None if edited else track_energy(levels), json.dumps(new_curve), track_id))
    db.conn.execute("BEGIN")
    try:
        db.conn.executemany(
            "UPDATE analysis SET energy = coalesce(?, energy), energy_curve = ? WHERE track_id = ?",
            updates,
        )
        db.conn.execute("COMMIT")
    except BaseException:
        db.conn.execute("ROLLBACK")
        raise
    return len(updates)


# ---- ratings already in the tags ----


def compile_patterns(patterns: Sequence[str]) -> list[re.Pattern[str]]:
    """``Energy {n}`` → a case-insensitive regex for a level 1-10 in that place.

    A pattern that starts with ``{n}`` (``{n} - ``) must start the text, ``{n}`` alone must
    be the whole text, and the others may appear anywhere after a non-letter. Spaces in a
    pattern match any run of spaces."""

    def literal(text: str) -> str:
        return r"\s*".join(re.escape(part) for part in text.split(" "))

    out = []
    for pattern in patterns:
        text = pattern.strip()
        if text.count("{n}") != 1:
            continue
        head, _, tail = text.partition("{n}")
        level = r"(10|[1-9])(?![0-9])"
        if not head and not tail:
            out.append(re.compile(r"^\s*" + level + r"\s*$"))
            continue
        prefix = r"^\s*" if not head else r"(?<![0-9A-Za-z])"
        out.append(re.compile(prefix + literal(head) + level + literal(tail), re.IGNORECASE))
    return out


def find_level(text: str | None, patterns: Sequence[re.Pattern[str]]) -> int | None:
    if not text:
        return None
    for regex in patterns:
        match = regex.search(text)
        if match:
            return int(match.group(1))
    return None


@dataclass(frozen=True)
class ImportItem:
    track_id: int
    field: str
    text: str
    rating: int
    existing: int | None  # the rating already stored, if any


@dataclass(frozen=True)
class ImportPreview:
    items: list[ImportItem]
    scanned: int
    written_by_tonalia: int  # matches that are Tonalia's own energy tag, left out
    unreadable: int


def _tonalia_values(db: Database) -> dict[tuple[int, str], set[str]]:
    """Texts Tonalia itself wrote, by (track, field), from the batches not undone."""
    out: dict[tuple[int, str], set[str]] = {}
    for track_id, changes in db.conn.execute(
        "SELECT b.track_id, b.changes FROM tag_backups b JOIN tag_batches t ON t.id = b.batch_id "
        "WHERE t.undone_at IS NULL AND b.changes IS NOT NULL"
    ):
        for change in json.loads(changes):
            if change.get("after"):
                out.setdefault((track_id, change["field"]), set()).add(str(change["after"]))
    return out


def import_preview(
    db: Database,
    patterns: Sequence[str] = DEFAULT_PATTERNS,
    fields: Sequence[str] = DEFAULT_IMPORT_FIELDS,
) -> ImportPreview:
    """Levels found in the tags of the library's files (nothing is written).

    A rating tag counts as the level itself (Tonalia writes the energy there, scaled).
    Values Tonalia wrote are its own estimate, not the user's opinion, and are left out."""
    regexes = compile_patterns(patterns)
    fields = tuple(f for f in fields if f in IMPORT_FIELDS)
    ours = _tonalia_values(db)
    existing = dict(db.conn.execute("SELECT track_id, rating FROM energy_ratings").fetchall())
    items: list[ImportItem] = []
    scanned = ours_count = unreadable = 0
    for track_id, path in db.conn.execute("SELECT id, path FROM tracks ORDER BY id").fetchall():
        scanned += 1
        try:
            values = read_fields(Path(path), fields)
        except (TagWriteError, OSError, ValueError):
            unreadable += 1
            continue
        for field in fields:
            text = values.get(field)
            if not text:
                continue
            level = _rating_level(text) if field == "rating" else find_level(text, regexes)
            if level is None:
                continue
            if text in ours.get((track_id, field), set()):
                ours_count += 1
                break
            items.append(ImportItem(track_id, field, text, level, existing.get(track_id)))
            break
    return ImportPreview(items, scanned, ours_count, unreadable)


def _rating_level(text: str) -> int | None:
    try:
        value = round(float(text))
    except ValueError:
        return None
    return value if 1 <= value <= 10 else None


def import_ratings(db: Database, items: Sequence[tuple[int, int]], overwrite: bool) -> int:
    """Store imported ratings ``(track_id, rating)``; ratings heard by the user are kept
    unless ``overwrite``. Returns how many were stored."""
    heard = {
        tid
        for (tid,) in db.conn.execute("SELECT track_id FROM energy_ratings WHERE source = 'listen'")
    }
    known = {tid for (tid,) in db.conn.execute("SELECT id FROM tracks")}
    stored = 0
    db.conn.execute("BEGIN")
    try:
        for track_id, rating in items:
            if track_id not in known or not 1 <= rating <= 10:
                continue
            if track_id in heard and not overwrite:
                continue
            rate(db, track_id, rating, source="import")
            stored += 1
        db.conn.execute("COMMIT")
    except BaseException:
        db.conn.execute("ROLLBACK")
        raise
    return stored
