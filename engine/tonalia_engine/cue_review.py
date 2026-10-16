"""Assisted cue review (SPEC 12.5).

The DJ hears each automatic cue and says whether it marks a real section change
(``ok``), sits in the wrong place (``wrong``), or whether a cue is missing somewhere
(``missing``). The report is the share of automatic cues that are right, with the most
frequent failures by section type, for ``docs/accuracy.md`` and for tuning
``analysis/structure.py``. It never carries titles or paths.

Cue ids change whenever the automatic cues are derived again, so each verdict keeps a
copy of what was reviewed (slot, section label, position, who placed it, analysis
version): moving a misplaced cue or reanalysing the track does not change the report.
"""

from __future__ import annotations

import json
from collections import defaultdict
from typing import Any

from .analysis.pipeline import ANALYSIS_VERSION
from .analysis.structure import bar_length
from .analysis.tempo import BeatGrid
from .cues import SECTION_ORDER, list_segments
from .db import Database
from .errors import TonaliaError
from .library import Library
from .rpc_schema import (
    CueReviewItem,
    CueReviewQueue,
    CueReviewReport,
    CueReviewSetParams,
    CueSectionStats,
    TrackSummary,
)


class CueReviewError(TonaliaError, ValueError):
    """A verdict that does not fit the track (reported as invalid params)."""

    reason = "invalid_params"


def _require_track(db: Database, track_id: int) -> str | None:
    row = db.conn.execute(
        "SELECT analysis_version FROM tracks WHERE id = ?", (track_id,)
    ).fetchone()
    if row is None:
        raise KeyError(track_id)
    return str(row[0]) if row[0] else None


def _pending_tracks(db: Database, n: int) -> list[int]:
    """Analysed tracks with automatic cues not yet reviewed, newest analysis first and
    spread over genres, so a batch is not twenty tracks of one style."""
    rows = db.conn.execute(
        "SELECT t.id, COALESCE(lower(t.genre), '') AS genre FROM tracks t "
        "WHERE t.status = 'ready' AND EXISTS ("
        "  SELECT 1 FROM cues c WHERE c.track_id = t.id AND c.source = 'auto' AND NOT EXISTS ("
        "    SELECT 1 FROM cue_reviews r WHERE r.cue_id = c.id AND r.verdict != 'missing'))"
        " ORDER BY t.analyzed_at DESC, t.id"
    ).fetchall()
    by_genre: dict[str, list[int]] = defaultdict(list)
    for row in rows:
        by_genre[row["genre"]].append(int(row["id"]))
    picked: list[int] = []
    groups = list(by_genre.values())
    while len(picked) < n and any(groups):
        for group in groups:
            if group and len(picked) < n:
                picked.append(group.pop(0))
    return picked


def _item(db: Database, library: Library, track_id: int) -> CueReviewItem:
    detail = library.get(track_id)
    autos = sorted((c for c in detail.cues if c.source == "auto"), key=lambda c: c.position_sec)
    grid = BeatGrid(**detail.beat_grid) if detail.beat_grid else None
    ids = {
        int(r["slot"]): int(r["id"])
        for r in db.conn.execute(
            "SELECT id, slot FROM cues WHERE track_id = ? AND source = 'auto'", (track_id,)
        )
    }
    verdicts = {
        str(r["slot"]): r["verdict"]
        for r in db.conn.execute(
            "SELECT slot, verdict FROM cue_reviews WHERE track_id = ? AND verdict != 'missing' "
            "AND cue_id IN (SELECT value FROM json_each(?)) ORDER BY id",
            (track_id, json.dumps(list(ids.values()))),
        )
    }
    missing = [
        float(r[0])
        for r in db.conn.execute(
            "SELECT position_sec FROM cue_reviews WHERE track_id = ? AND verdict = 'missing' "
            "ORDER BY position_sec",
            (track_id,),
        )
    ]
    summary = TrackSummary.model_validate(detail.model_dump(include=set(TrackSummary.model_fields)))
    return CueReviewItem(
        track=summary,
        cues=autos,
        segments=detail.segments,
        bar_seconds=round(bar_length(grid), 4) if grid else 0.0,
        verdicts=verdicts,
        missing=missing,
    )


def queue(db: Database, library: Library, n: int, track_ids: list[int] | None) -> CueReviewQueue:
    if track_ids:
        for tid in track_ids:
            _require_track(db, tid)
        ids = list(dict.fromkeys(track_ids))[:n]
    else:
        ids = _pending_tracks(db, n)
    return CueReviewQueue(items=[_item(db, library, tid) for tid in ids], report=report(db))


def _section_at(db: Database, track_id: int, position: float) -> str | None:
    for seg in list_segments(db, track_id):
        if seg.start <= position < seg.end:
            return seg.label
    return None


def set_verdict(db: Database, params: CueReviewSetParams) -> int:
    """Store a verdict; a new verdict on the same cue replaces the old one."""
    version = _require_track(db, params.track_id)
    if params.verdict == "missing":
        if params.position_sec is None:
            raise CueReviewError("a missing cue needs the place where it is missing")
        cur = db.conn.execute(
            "INSERT INTO cue_reviews (track_id, label, position_sec, verdict, analysis_version) "
            "VALUES (?, ?, ?, 'missing', ?)",
            (
                params.track_id,
                _section_at(db, params.track_id, params.position_sec),
                round(params.position_sec, 4),
                version,
            ),
        )
        return int(cur.lastrowid or 0)
    if params.slot is None:
        raise CueReviewError("say which cue the verdict is for")
    cue = db.conn.execute(
        "SELECT id, label, position_sec, source FROM cues WHERE track_id = ? AND slot = ?",
        (params.track_id, params.slot),
    ).fetchone()
    if cue is None:
        raise CueReviewError(f"there is no cue in slot {params.slot + 1}", slot=params.slot + 1)
    with db.conn:
        db.conn.execute(
            "DELETE FROM cue_reviews WHERE cue_id = ? AND verdict != 'missing'", (cue["id"],)
        )
        cur = db.conn.execute(
            "INSERT INTO cue_reviews (track_id, cue_id, slot, label, position_sec, cue_source, "
            "verdict, analysis_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (
                params.track_id,
                cue["id"],
                params.slot,
                cue["label"],
                cue["position_sec"],
                cue["source"],
                params.verdict,
                version,
            ),
        )
    return int(cur.lastrowid or 0)


def delete_verdict(db: Database, review_id: int) -> None:
    db.conn.execute("DELETE FROM cue_reviews WHERE id = ?", (review_id,))


def _order(label: str) -> tuple[int, str]:
    return (SECTION_ORDER.index(label) if label in SECTION_ORDER else len(SECTION_ORDER), label)


def report(db: Database, version: str = ANALYSIS_VERSION) -> CueReviewReport:
    """The accuracy of the automatic cues of this analysis version."""
    rows = db.conn.execute(
        "SELECT id, track_id, slot, label, position_sec, cue_source, verdict FROM cue_reviews "
        "WHERE analysis_version = ? AND (verdict = 'missing' OR cue_source = 'auto') ORDER BY id",
        (version,),
    ).fetchall()
    # The same cue reviewed again after a reanalysis counts once (the latest verdict).
    latest: dict[Any, Any] = {}
    for r in rows:
        key: Any = (
            r["id"]
            if r["verdict"] == "missing"
            else (r["track_id"], r["slot"], round(float(r["position_sec"]), 1))
        )
        latest[key] = r
    stats: dict[str, dict[str, int]] = defaultdict(
        lambda: {"reviewed": 0, "wrong": 0, "missing": 0}
    )
    reviewed = correct = missing = 0
    for r in latest.values():
        label = r["label"] or "unknown"
        if r["verdict"] == "missing":
            missing += 1
            stats[label]["missing"] += 1
            continue
        reviewed += 1
        stats[label]["reviewed"] += 1
        if r["verdict"] == "ok":
            correct += 1
        else:
            stats[label]["wrong"] += 1
    return CueReviewReport(
        analysis_version=version,
        tracks=len({r["track_id"] for r in latest.values()}),
        reviewed_cues=reviewed,
        correct=correct,
        accuracy=round(correct / reviewed, 4) if reviewed else None,
        missing=missing,
        by_section=[
            CueSectionStats(label=label, **counts)
            for label, counts in sorted(stats.items(), key=lambda kv: _order(kv[0]))
        ],
    )
