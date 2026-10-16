"""Mix points by phrases (SPEC 14.1): where A goes out and B comes in.

Everything is counted in bars from each track's first downbeat, on its beatgrid, and every
point falls on a downbeat at the start of a phrase (8, 16 or 32 bars). The sections come
from ``structure.py``: the intro (the first section when it is one), the outro (the last
one) and the first drop.

Three styles (setting ``mixPointStyle``):

- ``intro_outro`` (default): B's intro plays over A's outro. B comes in at its first downbeat
  when A reaches its outro; the overlap is the longest of 32, 16 or 8 bars that fits both
  (and the overlap the DJ asked for). Without an outro, A's last phrases are used; without
  an intro, B's first 16 bars.
- ``drop_swap``: B's first drop lands exactly when A's phrase ends (A's outro). B comes in
  the overlap's bars before its drop; A is gone at the drop. A track without a drop falls
  back to ``intro_outro``.
- ``cut``: no overlap. A plays until its outro (the end of a phrase) and B starts there,
  from its first downbeat.

The phrase fit (0-1) says how well the two tracks are built for that transition: sections
of whole phrases, long enough for the overlap. The same function scores one pair here and a
whole library at once in the DJ Mix ideas and the set builder (``fit_scores``), so the score
behind an idea is the one ``mix.points`` explains.
"""

from __future__ import annotations

import json
import math
import sqlite3
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

import numpy as np
import numpy.typing as npt

from .analysis.structure import bar_length, downbeats
from .analysis.tempo import BeatGrid
from .db import Database
from .errors import TonaliaError
from .rpc_schema import MixPointReason, MixPoints, MixPointsParams, MixPointStyle

PHRASE = 8
OVERLAPS = (32, 16, 8)
DEFAULT_OVERLAP = 32
NO_INTRO_OVERLAP = 16  # B without an intro: its first 16 bars play over A
# What the fit loses for each thing missing from the ideal transition.
MISSING_SECTION = 0.25
SHORTER_OVERLAP = {16: 0.1, 8: 0.25}
NO_DROP = 0.2
OFF_PHRASE = 0.1

FloatArray = npt.NDArray[np.float64]
IntArray = npt.NDArray[np.int64]


class MixPointsError(TonaliaError, ValueError):
    reason = "not_analysed"


@dataclass(frozen=True)
class Sections:
    """A track's bars and its sections in bars (0 = none)."""

    bars: int  # whole bars from the first downbeat to the end
    intro: int  # bars of the intro
    outro: int  # bars of the outro
    drop: int  # bar where the first drop starts (0 = none, or it starts at the top)
    outro_on_phrase: bool = True


def _bar_index(times: FloatArray, t: float) -> int:
    return int(np.argmin(np.abs(times - t))) if times.size else 0


def sections(grid: BeatGrid, duration: float, segments: Sequence[Any]) -> Sections:
    """Sections of a track from its grid and its ``(label, start, end)`` segments."""
    times = downbeats(grid, duration)
    # Whole bars (the last one may fall a tenth short, as the audio fades out).
    bars = int(np.sum(times + 0.9 * bar_length(grid) <= duration))
    ordered = sorted(segments, key=lambda s: s[1])
    intro = outro = drop = 0
    outro_on_phrase = True
    if ordered and ordered[0][0] == "intro":
        intro = _bar_index(times, ordered[0][2])
    if len(ordered) > 1 and ordered[-1][0] == "outro":
        start = _bar_index(times, ordered[-1][1])
        outro = max(0, bars - start)
        outro_on_phrase = start % PHRASE == 0
    for label, start, _end in ordered:
        if label == "drop":
            drop = _bar_index(times, start)
            break
    return Sections(bars, intro, outro, drop, outro_on_phrase)


def _floor_phrase(bars: IntArray | int) -> Any:
    return (np.asarray(bars) // PHRASE) * PHRASE


def _best_overlap(limit: IntArray) -> IntArray:
    """The longest of 32/16/8 bars within ``limit`` (never under 8)."""
    out = np.full(limit.shape, PHRASE, dtype=np.int64)
    for length in sorted(OVERLAPS):
        out = np.where(limit >= length, length, out)
    return out


def _shorter(overlap: IntArray, wanted: int) -> FloatArray:
    loss = np.zeros(overlap.shape)
    for length, cost in SHORTER_OVERLAP.items():
        loss = np.where((overlap == length) & (wanted > length), cost, loss)
    return loss


def fit_scores(
    style: MixPointStyle,
    outro_a: int,
    intro_b: IntArray,
    drop_b: IntArray,
    overlap: int = DEFAULT_OVERLAP,
    outro_on_phrase: bool = True,
) -> tuple[FloatArray, IntArray]:
    """Phrase fit (0-1) and overlap in bars from one A into many Bs (bars of A's outro, of
    each B's intro and where each B's first drop starts; 0 = none)."""
    intro_b = np.asarray(intro_b, dtype=np.int64)
    drop_b = np.asarray(drop_b, dtype=np.int64)
    has_outro = outro_a >= PHRASE
    a_penalty = (0.0 if has_outro else MISSING_SECTION) + (0.0 if outro_on_phrase else OFF_PHRASE)
    # intro over outro
    limit_a = _floor_phrase(outro_a) if has_outro else overlap
    limit_b = np.where(intro_b >= PHRASE, _floor_phrase(intro_b), NO_INTRO_OVERLAP)
    blend = _best_overlap(np.minimum(np.minimum(limit_b, limit_a), overlap))
    blend_fit = (
        1.0
        - a_penalty
        - np.where(intro_b >= PHRASE, 0.0, MISSING_SECTION)
        - np.where(intro_b % PHRASE == 0, 0.0, OFF_PHRASE)
        - _shorter(blend, overlap)
    )
    if style == "intro_outro":
        return np.clip(blend_fit, 0, 1), blend
    if style == "cut":
        fit = 1.0 - a_penalty - np.where(intro_b >= PHRASE, 0.0, OFF_PHRASE)
        return np.clip(np.broadcast_to(fit, intro_b.shape).astype(np.float64), 0, 1), np.zeros(
            intro_b.shape, dtype=np.int64
        )
    has_drop = drop_b >= PHRASE
    swap = _best_overlap(np.minimum(_floor_phrase(drop_b), overlap))
    swap_fit = (
        1.0 - a_penalty - np.where(drop_b % PHRASE == 0, 0.0, OFF_PHRASE) - _shorter(swap, overlap)
    )
    fit = np.where(has_drop, swap_fit, blend_fit - NO_DROP)
    return np.clip(fit, 0, 1), np.where(has_drop, swap, blend)


@dataclass(frozen=True)
class TrackMix:
    grid: BeatGrid
    duration: float
    sections: Sections

    def time(self, bar: int) -> float:
        times = downbeats(self.grid, self.duration)
        if 0 <= bar < len(times):
            return float(times[bar])
        last = float(times[-1]) if times.size else self.grid.first_downbeat
        return last + (bar - (len(times) - 1)) * bar_length(self.grid)


def load(db: Database, track_id: int) -> TrackMix:
    row = db.conn.execute(
        "SELECT t.duration, a.beat_grid FROM tracks t LEFT JOIN analysis a ON a.track_id = t.id"
        " WHERE t.id = ?",
        (track_id,),
    ).fetchone()
    if row is None:
        raise MixPointsError(f"unknown track {track_id}", reason="track_not_found")
    if not row["beat_grid"] or not row["duration"]:
        raise MixPointsError("the track has no beatgrid yet", reason="not_analysed")
    grid = BeatGrid(**json.loads(row["beat_grid"]))
    segments = db.conn.execute(
        "SELECT label, start_sec, end_sec FROM segments WHERE track_id = ? ORDER BY start_sec",
        (track_id,),
    ).fetchall()
    return TrackMix(grid, float(row["duration"]), sections(grid, row["duration"], segments))


def _switch_bar(a: Sections, overlap: int) -> int:
    """Bar where A's outro (or, without one, its last phrase that leaves room) starts."""
    if a.outro >= PHRASE:
        return a.bars - a.outro
    return max(0, int(_floor_phrase(a.bars - overlap)))


def plan(a: TrackMix, b: TrackMix, style: MixPointStyle, overlap: int) -> MixPoints:
    sa, sb = a.sections, b.sections
    fits, lengths = fit_scores(
        style,
        sa.outro,
        np.array([sb.intro]),
        np.array([sb.drop]),
        overlap,
        sa.outro_on_phrase,
    )
    fit, length = float(fits[0]), int(lengths[0])
    used = style
    reasons: list[MixPointReason] = []
    if style == "drop_swap" and sb.drop < PHRASE:
        used = "intro_outro"
        reasons.append(MixPointReason(code="no_drop"))
    if sa.outro < PHRASE:
        reasons.append(MixPointReason(code="no_outro"))
    if used == "cut":
        switch = _switch_bar(sa, 0) if sa.outro >= PHRASE else int(_floor_phrase(sa.bars))
        a_start, b_start = switch, 0
        reasons.insert(0, MixPointReason(code="cut", a_bars=sa.outro or None))
    elif used == "drop_swap":
        switch = _switch_bar(sa, length)
        a_start, b_start = max(0, switch - length), sb.drop - length
        switch = a_start + length
        reasons.insert(0, MixPointReason(code="drop_swap", bars=length))
    else:
        a_start = _switch_bar(sa, length)
        # The overlap never runs past A's end.
        length = min(length, max(PHRASE, int(_floor_phrase(sa.bars - a_start))))
        switch, b_start = a_start + length, 0
        intro, outro = int(_floor_phrase(sb.intro)), int(_floor_phrase(sa.outro))
        if sb.intro < PHRASE:
            reasons.append(MixPointReason(code="no_intro", bars=length))
        elif intro < min(overlap, outro if sa.outro >= PHRASE else overlap):
            reasons.insert(0, MixPointReason(code="short_intro", bars=length))
        elif sa.outro < PHRASE:
            pass  # "no_outro" says it all
        elif outro < min(overlap, intro):
            reasons.insert(0, MixPointReason(code="short_outro", bars=length))
        else:
            reasons.insert(0, MixPointReason(code="outro_intro", a_bars=sa.outro, b_bars=sb.intro))
    a_time, switch_time = a.time(a_start), a.time(switch)
    return MixPoints(
        style=used,
        a_start=round(a_time, 3),
        a_end=round(switch_time, 3),
        b_start=round(b.time(b_start), 3),
        overlap_bars=switch - a_start,
        overlap_seconds=round(switch_time - a_time, 3),
        fit=round(fit, 3),
        reasons=reasons,
    )


def mix_points(db: Database, p: MixPointsParams, style: MixPointStyle) -> MixPoints:
    a, b = load(db, p.track_a), load(db, p.track_b)
    return plan(a, b, p.style or style, p.overlap_bars or DEFAULT_OVERLAP)


def track_points(track: TrackMix, style: MixPointStyle) -> tuple[float, float]:
    """A track's own "Mix in" and "Mix out" (for the exports): where it comes in and where
    the next one would come in, with a partner that has a full 32-bar intro."""
    s = track.sections
    if style == "drop_swap" and s.drop >= PHRASE:
        mix_in = s.drop - min(DEFAULT_OVERLAP, int(_floor_phrase(s.drop)))
    else:
        mix_in = 0
    overlap = 0 if style == "cut" else DEFAULT_OVERLAP
    switch = _switch_bar(s, overlap)
    mix_out = switch - DEFAULT_OVERLAP if style == "drop_swap" else switch
    return round(track.time(mix_in), 3), round(track.time(max(mix_in + PHRASE, mix_out)), 3)


def style_setting(db: Database) -> MixPointStyle:
    value = db.get_setting("mix_point_style", "intro_outro")
    return value if value in ("intro_outro", "drop_swap", "cut") else "intro_outro"


def library_sections(
    conn: sqlite3.Connection, track_ids: Sequence[int] | None = None
) -> dict[int, Sections]:
    """Sections of many tracks at once (the ideas index, the set builder). Tracks without a
    grid get none (and a fit as if they had no intro or outro)."""
    sql = (
        "SELECT t.id, a.beat_grid, t.duration FROM tracks t JOIN analysis a"
        " ON a.track_id = t.id WHERE a.beat_grid IS NOT NULL AND t.duration > 0"
    )
    rows: list[Any] = []
    if track_ids is None:
        rows = conn.execute(sql).fetchall()
    else:
        ids = list(dict.fromkeys(track_ids))
        for start in range(0, len(ids), 500):  # under SQLite's variable limit
            chunk = ids[start : start + 500]
            marks = ", ".join("?" for _ in chunk)
            rows += conn.execute(f"{sql} AND t.id IN ({marks})", chunk).fetchall()
    grids = {r[0]: (BeatGrid(**json.loads(r[1])), float(r[2])) for r in rows}
    segments: dict[int, list[Any]] = {}
    if grids:
        for r in conn.execute(
            "SELECT track_id, label, start_sec, end_sec FROM segments ORDER BY track_id, start_sec"
        ):
            if r[0] in grids:
                segments.setdefault(r[0], []).append((r[1], r[2], r[3]))
    return {
        tid: _quick_sections(grid, duration, segments.get(tid, []))
        for tid, (grid, duration) in grids.items()
    }


def _quick_sections(grid: BeatGrid, duration: float, segments: list[Any]) -> Sections:
    """``sections`` by arithmetic on the bar length (no downbeat list): close enough for
    scoring thousands of tracks, exact on a constant grid."""
    if grid.kind == "variable":
        return sections(grid, duration, segments)
    bar = bar_length(grid)
    first = grid.first_downbeat - bar * math.floor(grid.first_downbeat / bar)

    def at(t: float) -> int:
        return max(0, round((t - first) / bar))

    bars = max(0, math.floor((duration - first) / bar + 0.1))
    intro = outro = drop = 0
    on_phrase = True
    if segments and segments[0][0] == "intro":
        intro = at(segments[0][2])
    if len(segments) > 1 and segments[-1][0] == "outro":
        start = at(segments[-1][1])
        outro, on_phrase = max(0, bars - start), start % PHRASE == 0
    drop = next((at(s[1]) for s in segments if s[0] == "drop"), 0)
    return Sections(bars, intro, outro, drop, on_phrase)
