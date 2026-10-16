"""Beatgrid editing (SPEC 12.4).

The editor sends a tempo and a first downbeat, plus tempo anchors when the tempo changes:
pins that fix where a beat is heard, with the beats in between spread evenly. Saving marks
the grid ``user`` and locks it, so a new analysis keeps it (the grid the analysis found is
kept aside for "Reset"). The segments move to the new downbeats and the automatic cues are
derived again, all without decoding the audio; the user's cues stay where they are, and
the ones that no longer sit on a beat are reported so the editor can offer to snap them.

Every reader of ``analysis.beat_grid`` (exports, Pro mode, render, the set builder) then
uses the edited grid.
"""

from __future__ import annotations

import json
import math
from collections.abc import Mapping, Sequence
from dataclasses import asdict
from itertools import pairwise
from typing import Any

import numpy as np

from .analysis.structure import downbeats
from .analysis.tempo import BeatGrid
from .cues import list_cues, list_segments, refresh_auto_cues, save_segments, transaction
from .db import Database
from .errors import TonaliaError
from .rpc_schema import GridSpec

BEATS_PER_BAR = 4
MIN_BPM, MAX_BPM = 40.0, 300.0
# A user's cue farther than this from every beat is "off the beat".
ON_BEAT_TOLERANCE = 0.005


class GridError(TonaliaError, ValueError):
    """The grid cannot be edited (reported as invalid params)."""

    reason = "not_analysed"


# ---- building a grid ----


def _pins(spec: GridSpec) -> list[tuple[int, float]]:
    pins = [(0, spec.first_downbeat), *((a.beat, a.time) for a in spec.anchors)]
    for (b0, t0), (b1, t1) in pairwise(pins):
        if b1 <= b0:
            raise GridError("tempo anchors must go forward beat by beat", reason="invalid_params")
        if t1 <= t0:
            raise GridError("tempo anchors must go forward in time", reason="invalid_params")
        bpm = 60.0 * (b1 - b0) / (t1 - t0)
        if not MIN_BPM / 2 <= bpm <= MAX_BPM * 2:
            raise GridError(
                f"tempo anchors give {bpm:.1f} BPM between beats {b0} and {b1}",
                reason="invalid_params",
            )
    return pins


def build_grid(spec: GridSpec, duration: float) -> BeatGrid:
    """The stored grid for what the editor drew."""
    if not spec.anchors:
        bar = BEATS_PER_BAR * 60.0 / spec.bpm
        first = spec.first_downbeat - bar * math.floor(spec.first_downbeat / bar)
        if bar - first < 1e-6:
            first = 0.0
        return BeatGrid("constant", round(spec.bpm, 4), round(first, 4))
    pins = _pins(spec)
    beat_idx = np.array([b for b, _ in pins], dtype=np.float64)
    times = np.array([t for _, t in pins], dtype=np.float64)
    first_period = (times[1] - times[0]) / (beat_idx[1] - beat_idx[0])
    last_period = (times[-1] - times[-2]) / (beat_idx[-1] - beat_idx[-2])

    def time_of(k: np.ndarray) -> np.ndarray:
        inside = np.interp(k, beat_idx, times)
        before = times[0] + (k - beat_idx[0]) * first_period
        after = times[-1] + (k - beat_idx[-1]) * last_period
        out: np.ndarray = np.where(
            k < beat_idx[0], before, np.where(k > beat_idx[-1], after, inside)
        )
        return out

    start = -math.ceil(times[0] / first_period - 1e-9)
    end = int(beat_idx[-1] + math.ceil(max(0.0, duration - times[-1]) / last_period)) + 1
    ks = np.arange(start, end + 1, dtype=np.float64)
    at = time_of(ks)
    keep = (at >= -1e-9) & (at < duration)
    ks, at = ks[keep], np.maximum(at[keep], 0.0)
    if len(at) < 2:
        raise GridError("the grid has no beats inside the track", reason="invalid_params")
    downbeat = float(at[np.flatnonzero(np.mod(ks, BEATS_PER_BAR) == 0)[0]])
    bpm = 60.0 / float(np.median(np.diff(at)))
    return BeatGrid(
        "variable",
        round(bpm, 4),
        round(downbeat, 4),
        beats=[round(float(t), 4) for t in at],
        anchors=[[int(b), round(float(t), 4)] for b, t in pins],
    )


def beat_times(grid: BeatGrid, duration: float) -> np.ndarray:
    if grid.kind == "variable" and grid.beats:
        return np.asarray(grid.beats, dtype=np.float64)
    period = 60.0 / grid.bpm
    first = grid.first_downbeat - period * math.floor(grid.first_downbeat / period)
    return np.arange(first, duration, period)


def nearest_beat(grid: BeatGrid, duration: float, time: float) -> float:
    beats = beat_times(grid, duration)
    if not len(beats):
        return time
    return float(beats[int(np.argmin(np.abs(beats - time)))])


def off_beat(grid: BeatGrid, duration: float, positions: Mapping[int, float]) -> list[int]:
    """Slots whose position is not on a beat of ``grid``."""
    return sorted(
        slot
        for slot, at in positions.items()
        if abs(nearest_beat(grid, duration, at) - at) > ON_BEAT_TOLERANCE
    )


def resnap_segments(
    segments: Sequence[Mapping[str, Any]], grid: BeatGrid, duration: float
) -> list[dict[str, Any]]:
    """The same sections with every boundary on the nearest downbeat of ``grid``; two
    boundaries landing on the same bar merge (the later section keeps the place)."""
    bars = downbeats(grid, duration)
    if not segments or not len(bars):
        return [dict(s) for s in segments]
    out: list[dict[str, Any]] = []
    for i, seg in enumerate(segments):
        start = 0.0 if i == 0 else float(bars[int(np.argmin(np.abs(bars - seg["start"])))])
        if out and start - out[-1]["start"] < 1e-6:
            out[-1] = {**dict(seg), "start": out[-1]["start"]}
            if len(out) == 1:
                out[-1]["label"] = segments[0]["label"]
            continue
        out.append({**dict(seg), "start": round(start, 4)})
    for a, b in pairwise(out):
        a["end"] = b["start"]
    out[-1]["end"] = segments[-1]["end"] if segments[-1]["end"] > out[-1]["start"] else duration
    return out


# ---- in the database ----


def _row(db: Database, track_id: int) -> Any:
    row = db.conn.execute(
        "SELECT t.duration, a.beat_grid, a.bpm, a.grid_source, a.grid_locked, "
        "a.beat_grid_auto, a.bpm_auto, a.edited_fields "
        "FROM tracks t LEFT JOIN analysis a ON a.track_id = t.id WHERE t.id = ?",
        (track_id,),
    ).fetchone()
    if row is None:
        raise KeyError(track_id)
    if not row["beat_grid"]:
        raise GridError(f"track {track_id} has no beatgrid yet: analyse it first")
    return row


def _duration(row: Any, grid: BeatGrid | None = None) -> float:
    if row["duration"]:
        return float(row["duration"])
    beats = grid.beats if grid and grid.beats else []
    return float(beats[-1]) + 1.0 if beats else 600.0


def _apply(db: Database, track_id: int, grid: BeatGrid, duration: float) -> None:
    """Move the segments to ``grid`` and derive the automatic cues again."""
    segments = [s.model_dump() for s in list_segments(db, track_id)]
    save_segments(db, track_id, resnap_segments(segments, grid, duration))
    refresh_auto_cues(db, track_id)


def user_cues_off_beat(db: Database, track_id: int) -> list[int]:
    row = _row(db, track_id)
    grid = BeatGrid(**json.loads(row["beat_grid"]))
    user = {c.slot: c.position_sec for c in list_cues(db, track_id) if c.source == "user"}
    return off_beat(grid, _duration(row, grid), user)


def update_grid(db: Database, track_id: int, spec: GridSpec) -> None:
    """Store the user's grid, locked, keeping the analysis's for "Reset"."""
    row = _row(db, track_id)
    grid = build_grid(spec, _duration(row))
    with transaction(db.conn):
        if row["grid_source"] == "auto":
            db.conn.execute(
                "UPDATE analysis SET beat_grid_auto = beat_grid, bpm_auto = bpm WHERE track_id = ?",
                (track_id,),
            )
        db.conn.execute(
            "UPDATE analysis SET beat_grid = ?, bpm = ?, grid_source = 'user', grid_locked = 1 "
            "WHERE track_id = ?",
            (json.dumps(asdict(grid)), round(grid.bpm, 4), track_id),
        )
        _apply(db, track_id, grid, _duration(row, grid))


def reset_grid(db: Database, track_id: int) -> None:
    """Back to the grid the analysis found, unlocked."""
    row = _row(db, track_id)
    with transaction(db.conn):
        if row["beat_grid_auto"]:
            bpm_edited = "bpm" in json.loads(row["edited_fields"] or "[]")
            db.conn.execute(
                "UPDATE analysis SET beat_grid = beat_grid_auto"
                + ("" if bpm_edited else ", bpm = bpm_auto")
                + ", beat_grid_auto = NULL, bpm_auto = NULL WHERE track_id = ?",
                (track_id,),
            )
        db.conn.execute(
            "UPDATE analysis SET grid_source = 'auto', grid_locked = 0 WHERE track_id = ?",
            (track_id,),
        )
        auto = db.conn.execute(
            "SELECT beat_grid FROM analysis WHERE track_id = ?", (track_id,)
        ).fetchone()[0]
        grid = BeatGrid(**json.loads(auto))
        _apply(db, track_id, grid, _duration(row, grid))


def lock_grid(db: Database, track_id: int, locked: bool) -> None:
    _row(db, track_id)
    db.conn.execute(
        "UPDATE analysis SET grid_locked = ? WHERE track_id = ?", (int(locked), track_id)
    )


def snap_cues(db: Database, track_id: int, slots: Sequence[int]) -> None:
    """Put these user cues on the nearest beat ("Ajustar al beat")."""
    row = _row(db, track_id)
    grid = BeatGrid(**json.loads(row["beat_grid"]))
    duration = _duration(row, grid)
    wanted = set(slots)
    with transaction(db.conn):
        for cue in list_cues(db, track_id):
            if cue.slot in wanted and cue.source == "user":
                db.conn.execute(
                    "UPDATE cues SET position_sec = ? WHERE track_id = ? AND slot = ?",
                    (round(nearest_beat(grid, duration, cue.position_sec), 4), track_id, cue.slot),
                )
