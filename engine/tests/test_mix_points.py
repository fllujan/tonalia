"""Mix points by phrases (SPEC 14.1): the three styles, the phrase fit and its reasons, the
same fit for one pair and for many at once, and ``mix.points`` through RPC."""

from __future__ import annotations

import json
from typing import Any

import numpy as np
import pytest

from tests.test_analysis_queue import call
from tests.test_export_rekordbox import library
from tests.test_export_traktor import nml, traktor_closed
from tonalia_engine.analysis.tempo import BeatGrid
from tonalia_engine.db import Database
from tonalia_engine.mix_points import (
    TrackMix,
    _quick_sections,
    fit_scores,
    plan,
    sections,
    track_points,
)
from tonalia_engine.server import EngineContext

__all__ = ["library", "nml", "traktor_closed"]

BPM = 128.0
BAR = 240.0 / BPM
FIRST = 0.5
GRID = BeatGrid("constant", BPM, FIRST)


def layout(*parts: tuple[str, int]) -> tuple[float, list[tuple[str, float, float]]]:
    """(duration, segments) from (label, bars) parts laid end to end from the first downbeat."""
    at, out = 0, []
    for label, bars in parts:
        out.append((label, FIRST + at * BAR, FIRST + (at + bars) * BAR))
        at += bars
    out[0] = (out[0][0], 0.0, out[0][2])
    return FIRST + at * BAR, out


FULL = layout(("intro", 32), ("drop", 32), ("breakdown", 32), ("drop", 32), ("outro", 32))
SHORT_INTRO = layout(("intro", 16), ("build", 16), ("drop", 48), ("breakdown", 32), ("outro", 32))
NO_SECTIONS = layout(("verse", 64), ("chorus", 64))
LATE_DROP = layout(("intro", 32), ("build", 16), ("drop", 64), ("outro", 32))


def track(spec: tuple[float, list[tuple[str, float, float]]]) -> TrackMix:
    duration, segments = spec
    return TrackMix(GRID, duration, sections(GRID, duration, segments))


def bar_of(t: float) -> float:
    return (t - FIRST) / BAR


def test_sections_in_bars() -> None:
    s = sections(GRID, FULL[0], FULL[1])
    assert (s.bars, s.intro, s.outro, s.drop) == (160, 32, 32, 32)
    # The quick version used for whole libraries agrees on a constant grid.
    for spec in (FULL, SHORT_INTRO, NO_SECTIONS, LATE_DROP):
        assert _quick_sections(GRID, spec[0], spec[1]) == sections(GRID, spec[0], spec[1])


def test_intro_over_outro() -> None:
    p = plan(track(FULL), track(FULL), "intro_outro", 32)
    assert p.style == "intro_outro"
    assert bar_of(p.a_start) == pytest.approx(128) and bar_of(p.a_end) == pytest.approx(160)
    assert p.b_start == pytest.approx(FIRST)
    assert p.overlap_bars == 32 and p.overlap_seconds == pytest.approx(32 * BAR)
    assert p.fit == 1.0
    assert p.reasons[0].code == "outro_intro"
    assert (p.reasons[0].a_bars, p.reasons[0].b_bars) == (32, 32)


def test_a_short_intro_shortens_the_overlap() -> None:
    p = plan(track(FULL), track(SHORT_INTRO), "intro_outro", 32)
    assert p.overlap_bars == 16 and bar_of(p.a_start) == pytest.approx(128)
    assert p.reasons[0].code == "short_intro" and p.reasons[0].bars == 16
    assert p.fit == pytest.approx(0.9)
    # Asking for 16 bars, a 16-bar intro is a perfect fit.
    assert plan(track(FULL), track(SHORT_INTRO), "intro_outro", 16).fit == 1.0


def test_without_sections_the_last_phrases_and_first_bars_are_used() -> None:
    p = plan(track(NO_SECTIONS), track(NO_SECTIONS), "intro_outro", 32)
    codes = [r.code for r in p.reasons]
    assert "no_outro" in codes and "no_intro" in codes
    assert p.overlap_bars == 16 and bar_of(p.a_end) <= 128 + 1e-6
    assert bar_of(p.a_start) % 8 == pytest.approx(0)
    assert p.fit == pytest.approx(0.4)


def test_drop_swap_lands_b_drop_as_a_phrase_ends() -> None:
    p = plan(track(FULL), track(LATE_DROP), "drop_swap", 32)
    assert p.style == "drop_swap" and p.overlap_bars == 32
    assert bar_of(p.a_end) == pytest.approx(128)  # A's outro: A is gone here
    assert bar_of(p.a_start) == pytest.approx(96)
    assert bar_of(p.b_start) == pytest.approx(48 - 32)  # B's drop arrives at A's bar 128
    assert p.reasons[0].code == "drop_swap" and p.fit == 1.0
    # Without a drop it falls back to intro over outro, and says so.
    fallback = plan(track(FULL), track(NO_SECTIONS), "drop_swap", 32)
    assert fallback.style == "intro_outro" and fallback.reasons[0].code == "no_drop"


def test_cut_has_no_overlap() -> None:
    p = plan(track(FULL), track(FULL), "cut", 32)
    assert p.overlap_bars == 0 and p.a_start == p.a_end
    assert bar_of(p.a_start) == pytest.approx(128) and p.b_start == pytest.approx(FIRST)
    assert p.reasons[0].code == "cut" and p.fit == 1.0


@pytest.mark.parametrize("style", ["intro_outro", "drop_swap", "cut"])
def test_points_fall_on_phrase_downbeats(style: Any) -> None:
    for a in (FULL, SHORT_INTRO, NO_SECTIONS, LATE_DROP):
        for b in (FULL, SHORT_INTRO, NO_SECTIONS, LATE_DROP):
            p = plan(track(a), track(b), style, 32)
            for t in (p.a_start, p.a_end, p.b_start):
                assert bar_of(t) == pytest.approx(round(bar_of(t)), abs=1e-6)
            assert bar_of(p.a_start) % 8 == pytest.approx(0)
            assert p.a_end <= a[0] + 1e-6  # never past A's end
            assert 0.0 <= p.fit <= 1.0


@pytest.mark.parametrize("style", ["intro_outro", "drop_swap", "cut"])
def test_one_pair_and_many_at_once_agree(style: Any) -> None:
    specs = (FULL, SHORT_INTRO, NO_SECTIONS, LATE_DROP)
    bs = [track(s).sections for s in specs]
    for a in specs:
        sa = track(a).sections
        fits, _ = fit_scores(
            style, sa.outro, np.array([b.intro for b in bs]), np.array([b.drop for b in bs])
        )
        for i, b in enumerate(specs):
            assert fits[i] == pytest.approx(plan(track(a), track(b), style, 32).fit)


def test_track_points_for_the_exports() -> None:
    mix_in, mix_out = track_points(track(FULL), "intro_outro")
    assert mix_in == pytest.approx(FIRST) and bar_of(mix_out) == pytest.approx(128)
    mix_in, mix_out = track_points(track(LATE_DROP), "drop_swap")
    assert bar_of(mix_in) == pytest.approx(16) and bar_of(mix_out) == pytest.approx(80)


# ---- RPC ----


def add_track(db: Database, track_id: int, spec: tuple[float, list[Any]] | None) -> None:
    duration = spec[0] if spec else 300.0
    db.conn.execute(
        "INSERT INTO tracks (id, path, title, status, display_title, duration)"
        " VALUES (?, ?, ?, 'ready', ?, ?)",
        (track_id, f"/music/{track_id}.mp3", f"T{track_id}", f"T{track_id}", duration),
    )
    grid = json.dumps({"kind": "constant", "bpm": BPM, "first_downbeat": FIRST}) if spec else None
    db.conn.execute(
        "INSERT INTO analysis (track_id, key_root, key_mode, bpm, energy, beat_grid)"
        " VALUES (?, 9, 'minor', ?, 7, ?)",
        (track_id, BPM, grid),
    )
    for label, start, end in spec[1] if spec else []:
        db.conn.execute(
            "INSERT INTO segments (track_id, start_sec, end_sec, label) VALUES (?, ?, ?, ?)",
            (track_id, start, end, label),
        )


def test_rpc_uses_the_setting_and_reports_errors(engine_ctx: EngineContext) -> None:
    db = engine_ctx.db
    add_track(db, 1, FULL)
    add_track(db, 2, LATE_DROP)
    add_track(db, 3, None)
    p = call(engine_ctx, "mix.points", {"trackA": 1, "trackB": 2})
    assert p["style"] == "intro_outro" and p["overlapBars"] == 32
    assert p["reasons"][0] == {"code": "outro_intro", "bars": None, "aBars": 32, "bBars": 32}
    call(engine_ctx, "settings.set", {"mixPointStyle": "drop_swap"})
    assert call(engine_ctx, "settings.get", {})["mixPointStyle"] == "drop_swap"
    assert call(engine_ctx, "mix.points", {"trackA": 1, "trackB": 2})["style"] == "drop_swap"
    cut = call(engine_ctx, "mix.points", {"trackA": 1, "trackB": 2, "style": "cut"})
    assert cut["overlapBars"] == 0
    short = call(engine_ctx, "mix.points", {"trackA": 1, "trackB": 2, "style": "intro_outro",
                                            "overlapBars": 16})  # fmt: skip
    assert short["overlapBars"] == 16

    import json as _json

    from tonalia_engine.server import build_dispatcher

    def reason(params: dict[str, int]) -> str:
        out = build_dispatcher(engine_ctx).handle_line(
            _json.dumps({"jsonrpc": "2.0", "id": 1, "method": "mix.points", "params": params})
        )
        assert out is not None
        return str(_json.loads(out)["error"]["data"]["reason"])

    assert reason({"trackA": 1, "trackB": 99}) == "track_not_found"
    assert reason({"trackA": 3, "trackB": 1}) == "not_analysed"


# ---- the ideas, the set builder and the exports use them ----


def test_dj_mix_ideas_prefer_phrases_that_fit(engine_ctx: EngineContext) -> None:
    db = engine_ctx.db
    add_track(db, 1, FULL)
    add_track(db, 2, SHORT_INTRO)  # same key, tempo and energy: only the phrases differ
    add_track(db, 3, FULL)
    result = call(engine_ctx, "suggest.mixouts", {"trackId": 1, "energyDirection": "keep"})
    items = {i["track"]["id"]: i for i in result["items"]}
    assert result["items"][0]["track"]["id"] == 3
    assert items[3]["scores"]["phrase"] == 1.0 and items[2]["scores"]["phrase"] == 0.9
    assert {"kind": "phrase", "code": "good", "value": None} in items[3]["reasons"]
    # Mashups do not mix out: no phrase score.
    mashup = call(engine_ctx, "suggest.mashups", {"trackId": 1})
    assert all(i["scores"]["phrase"] == 0.0 for i in mashup["items"])
    # The style setting changes the fit: with a cut, the intro length no longer matters.
    call(engine_ctx, "settings.set", {"mixPointStyle": "cut"})
    cut = call(engine_ctx, "suggest.mixouts", {"trackId": 1, "energyDirection": "keep"})
    assert {i["scores"]["phrase"] for i in cut["items"]} == {1.0}


def test_the_set_builder_scores_each_transition_with_the_phrases(engine_ctx: EngineContext) -> None:
    db = engine_ctx.db
    add_track(db, 1, FULL)
    add_track(db, 2, NO_SECTIONS)
    result = call(engine_ctx, "builder.score", {"trackIds": [1, 2]})
    move = result["items"][1]["transition"]
    # FULL's outro into a track without an intro: B's first 16 bars over A.
    assert move["scores"]["phrase"] == pytest.approx(0.65)


def _bloom_sections(ctx: EngineContext, track_id: int) -> None:
    bar = 240.0 / 124.0
    at = [0.25 + n * bar for n in (0, 32, 96, 128)]
    for label, start, end in (
        ("intro", 0.0, at[1]),
        ("drop", at[1], at[2]),
        ("outro", at[2], at[3]),
    ):
        ctx.db.conn.execute(
            "INSERT INTO segments (track_id, start_sec, end_sec, label) VALUES (?, ?, ?, ?)",
            (track_id, start, end, label),
        )
    ctx.db.conn.execute("UPDATE tracks SET duration = ? WHERE id = ?", (0.25 + 128 * bar, track_id))


def test_exports_write_mix_in_and_mix_out_without_taking_a_pad(
    engine_ctx: EngineContext, library: dict[str, int], nml: Any, tmp_path: Any
) -> None:
    import xml.etree.ElementTree as ET

    from tests.test_export_rekordbox import by_name
    from tests.test_export_rekordbox import export as export_rekordbox
    from tests.test_export_traktor import entries
    from tests.test_export_traktor import export as export_traktor

    bar = 240.0 / 124.0
    _bloom_sections(engine_ctx, library["bloom"])
    out = tmp_path / "rekordbox.xml"
    export_rekordbox(engine_ctx, path=str(out), simulate=False, mixPoints=True)
    bloom = by_name(ET.parse(out).getroot())["Midnight Bloom"]
    marks = [m.attrib for m in bloom.findall("POSITION_MARK")]
    mix = {m["Name"]: m for m in marks if m["Name"].startswith("Mix")}
    assert set(mix) == {"Mix in", "Mix out"} and {m["Num"] for m in mix.values()} == {"-1"}
    assert float(mix["Mix in"]["Start"]) == pytest.approx(0.25, abs=1e-3)
    assert float(mix["Mix out"]["Start"]) == pytest.approx(0.25 + 96 * bar, abs=1e-3)
    assert sum(m["Num"] != "-1" for m in marks) == 3  # the hot cues stay as they were
    # Off by default.
    export_rekordbox(engine_ctx, path=str(out), simulate=False)
    bloom = by_name(ET.parse(out).getroot())["Midnight Bloom"]
    assert not [m for m in bloom.findall("POSITION_MARK") if m.get("Name", "").startswith("Mix")]

    for _ in range(2):  # exporting again replaces them, never stacks copies
        assert (
            export_traktor(engine_ctx, path=str(nml), simulate=False, mixPoints=True)["status"]
            == "done"
        )
    entry = entries(ET.parse(nml).getroot())["01 Midnight Bloom.mp3"]
    cues = [c.attrib for c in entry.findall("CUE_V2") if c.get("NAME", "").startswith("Mix")]
    assert [(c["NAME"], c["TYPE"], c["HOTCUE"]) for c in cues] == [
        ("Mix in", "0", "-1"), ("Mix out", "0", "-1")
    ]  # fmt: skip
    assert float(cues[1]["START"]) == pytest.approx((0.25 + 96 * bar) * 1000, abs=1)
