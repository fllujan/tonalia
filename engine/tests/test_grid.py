"""Beatgrid editing (SPEC 12.4): user grids, tempo anchors, lock, reset and the cues."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np
import pytest

from tests.test_analysis_queue import call, ctx, wait_job
from tests.test_cues_rpc import analysed
from tests.test_track_update import call_error
from tonalia_engine.analysis.structure import downbeats
from tonalia_engine.analysis.tempo import BeatGrid
from tonalia_engine.grid import build_grid, off_beat, resnap_segments
from tonalia_engine.rpc_schema import GridAnchor, GridSpec
from tonalia_engine.server import EngineContext

__all__ = ["analysed", "ctx"]


# ---- building a grid ----


def test_a_constant_grid_keeps_its_tempo_and_moves_the_downbeat_to_the_first_bar() -> None:
    grid = build_grid(GridSpec(bpm=120.0, first_downbeat=0.25), duration=60.0)
    assert grid == BeatGrid("constant", 120.0, 0.25)
    # "First downbeat here" at 1:00 is the same grid: the first bar of the track.
    later = build_grid(GridSpec(bpm=120.0, first_downbeat=60.25), duration=90.0)
    assert later.first_downbeat == pytest.approx(0.25)
    before = build_grid(GridSpec(bpm=120.0, first_downbeat=-1.75), duration=60.0)
    assert before.first_downbeat == pytest.approx(0.25)


def test_anchors_pin_beats_and_the_beats_between_them_are_interpolated() -> None:
    spec = GridSpec(
        bpm=120.0,
        first_downbeat=1.0,
        anchors=[GridAnchor(beat=8, time=5.0), GridAnchor(beat=16, time=9.2)],
    )
    grid = build_grid(spec, duration=20.0)
    assert grid.kind == "variable" and grid.beats is not None
    beats = np.asarray(grid.beats)
    # Before beat 0 and up to beat 8: 0.5 s per beat; then 0.525 s, kept after the last pin.
    assert beats[0] == pytest.approx(0.0)
    assert beats[2] == pytest.approx(1.0)
    assert beats[2 + 8] == pytest.approx(5.0)
    assert beats[2 + 12] == pytest.approx(5.0 + 4 * 0.525)
    assert beats[2 + 16] == pytest.approx(9.2)
    assert beats[2 + 17] == pytest.approx(9.725)
    assert beats[-1] < 20.0
    # The first bar of the track starts on beat 0 (beat -2 is not a downbeat).
    assert grid.first_downbeat == pytest.approx(1.0)
    assert downbeats(grid, 20.0)[:3] == pytest.approx([1.0, 3.0, 5.0])
    # The pins come back to the editor, beat 0 included.
    assert grid.anchors == [[0, 1.0], [8, 5.0], [16, 9.2]]
    assert grid.bpm == pytest.approx(60 / 0.525, abs=0.01)


@pytest.mark.parametrize(
    "anchors",
    [
        [GridAnchor(beat=8, time=5.0), GridAnchor(beat=8, time=6.0)],  # same beat twice
        [GridAnchor(beat=8, time=5.0), GridAnchor(beat=4, time=6.0)],  # beats go back
        [GridAnchor(beat=8, time=0.5)],  # a pin before beat 0
        [GridAnchor(beat=8, time=1.2)],  # 8 beats in 0.2 s: far beyond the tempo range
    ],
)
def test_impossible_anchors_are_rejected(anchors: list[GridAnchor]) -> None:
    with pytest.raises(ValueError):
        build_grid(GridSpec(bpm=120.0, first_downbeat=1.0, anchors=anchors), duration=30.0)


def test_segments_move_to_the_downbeats_of_the_new_grid() -> None:
    new = BeatGrid("constant", 120.0, 0.1)  # bars every 2 s from 0.1
    segments = [
        {"start": 0.0, "end": 8.05, "label": "intro", "energy": 3.0},
        {"start": 8.05, "end": 16.4, "label": "drop", "energy": 8.0},
        {"start": 16.4, "end": 30.0, "label": "outro", "energy": 3.0},
    ]
    out = resnap_segments(segments, new, duration=30.0)
    assert [(s["start"], s["end"]) for s in out] == [(0.0, 8.1), (8.1, 16.1), (16.1, 30.0)]
    assert [s["label"] for s in out] == ["intro", "drop", "outro"]
    # Two boundaries that land on the same bar merge: no empty segment is left.
    tight = resnap_segments(
        [{**segments[0], "end": 8.05}, {**segments[1], "start": 8.05, "end": 8.3},
         {**segments[2], "start": 8.3}],
        new,
        duration=30.0,
    )  # fmt: skip
    assert [s["label"] for s in tight] == ["intro", "outro"]


def test_off_beat_finds_the_cues_that_no_longer_sit_on_a_beat() -> None:
    grid = BeatGrid("constant", 120.0, 0.0)
    assert off_beat(grid, 60.0, {0: 2.0, 1: 2.26, 2: 2.503}) == [1]


# ---- through RPC ----


def detail(ctx: EngineContext, tid: int) -> dict[str, Any]:
    out: dict[str, Any] = call(ctx, "library.get", {"trackId": tid})
    return out


def test_saving_a_grid_locks_it_and_moves_the_automatic_cues(
    ctx: EngineContext, analysed: int
) -> None:
    before = detail(ctx, analysed)
    assert before["gridSource"] == "auto" and before["gridLocked"] is False
    auto = before["beatGrid"]
    # The grid half a bar later, a touch faster; the user's cue half a beat off it.
    bar = 240.0 / auto["bpm"]
    spec = {"bpm": 124.5, "firstDownbeat": auto["first_downbeat"] + bar / 2}
    beat = 60.0 / 124.5
    mine = call(
        ctx,
        "cues.set",
        {"trackId": analysed, "slot": 7, "positionSec": spec["firstDownbeat"] + 40.5 * beat},
    )
    result = call(ctx, "grid.update", {"trackId": analysed, "grid": spec})
    after = result["track"]
    assert after["gridSource"] == "user" and after["gridLocked"] is True
    assert after["bpm"] == pytest.approx(124.5)
    grid = BeatGrid(**after["beatGrid"])
    assert grid.bpm == pytest.approx(124.5)
    # Every automatic cue sits on a downbeat of the new grid; the user's stays put.
    bars = downbeats(grid, after["duration"])
    for cue in after["cues"]:
        if cue["source"] == "auto":
            assert np.min(np.abs(bars - cue["positionSec"])) < 1e-3, cue
    kept = next(c for c in after["cues"] if c["slot"] == 7)
    assert kept["positionSec"] == pytest.approx(mine["positionSec"])
    # …and the segments start on its downbeats too.
    for seg in after["segments"][1:]:
        assert np.min(np.abs(bars - seg["start"])) < 1e-3
    # The user's cue is reported as off the beat; "snap" puts it on one.
    assert result["offBeat"] == [7]
    snapped = call(ctx, "grid.snapCues", {"trackId": analysed, "slots": [7]})
    cue = next(c for c in snapped["track"]["cues"] if c["slot"] == 7)
    phase = (cue["positionSec"] - grid.first_downbeat) / beat
    assert abs(phase - round(phase)) < 1e-3
    assert snapped["offBeat"] == []


def test_reanalysing_keeps_a_locked_grid_and_reset_goes_back_to_the_analysis(
    ctx: EngineContext, analysed: int
) -> None:
    auto = detail(ctx, analysed)["beatGrid"]
    spec = {"bpm": 123.0, "firstDownbeat": auto["first_downbeat"] + 0.01}
    call(ctx, "grid.update", {"trackId": analysed, "grid": spec})
    wait_job(ctx, call(ctx, "analysis.reanalyze", {"trackIds": [analysed]})["jobId"])
    kept = detail(ctx, analysed)
    assert kept["gridSource"] == "user" and kept["gridLocked"] is True
    assert kept["beatGrid"]["bpm"] == pytest.approx(123.0)
    assert kept["bpm"] == pytest.approx(123.0)
    # The cues derived after reanalysing follow the user's grid.
    bars = downbeats(BeatGrid(**kept["beatGrid"]), kept["duration"])
    for cue in kept["cues"]:
        assert np.min(np.abs(bars - cue["positionSec"])) < 1e-3, cue

    reset = call(ctx, "grid.reset", {"trackId": analysed})["track"]
    assert reset["gridSource"] == "auto" and reset["gridLocked"] is False
    assert reset["beatGrid"]["bpm"] == pytest.approx(auto["bpm"])
    assert reset["beatGrid"]["first_downbeat"] == pytest.approx(auto["first_downbeat"])
    assert reset["bpm"] == pytest.approx(auto["bpm"])


def test_an_unlocked_user_grid_is_replaced_by_the_next_analysis(
    ctx: EngineContext, analysed: int
) -> None:
    auto = detail(ctx, analysed)["beatGrid"]
    call(ctx, "grid.update", {"trackId": analysed, "grid": {"bpm": 123.0, "firstDownbeat": 0.3}})
    unlocked = call(ctx, "grid.lock", {"trackId": analysed, "locked": False})["track"]
    assert unlocked["gridLocked"] is False and unlocked["gridSource"] == "user"
    wait_job(ctx, call(ctx, "analysis.reanalyze", {"trackIds": [analysed]})["jobId"])
    again = detail(ctx, analysed)
    assert again["gridSource"] == "auto"
    assert again["beatGrid"]["bpm"] == pytest.approx(auto["bpm"])


def test_anchors_go_through_rpc_and_the_rekordbox_export_uses_them(
    ctx: EngineContext, analysed: int, tmp_path: Path
) -> None:
    auto = detail(ctx, analysed)["beatGrid"]
    fd = auto["first_downbeat"]
    beat = 60.0 / auto["bpm"]
    spec = {
        "bpm": auto["bpm"],
        "firstDownbeat": fd,
        "anchors": [{"beat": 64, "time": fd + 64 * beat + 0.2}],
    }
    track = call(ctx, "grid.update", {"trackId": analysed, "grid": spec})["track"]
    assert track["beatGrid"]["kind"] == "variable"
    assert track["beatGrid"]["anchors"][1] == pytest.approx([64, fd + 64 * beat + 0.2], abs=1e-3)
    out = tmp_path / "rekordbox.xml"
    job = call(ctx, "export.rekordbox", {"path": str(out), "simulate": False})
    assert wait_job(ctx, job["jobId"])["status"] == "done"
    xml = out.read_text("utf-8")
    assert xml.count("<TEMPO ") > 1  # a tempo change after the anchor


def test_editing_the_grid_of_a_track_without_analysis_is_refused(
    ctx: EngineContext, tmp_path: Path
) -> None:
    from tests.test_analysis_queue import import_folder, track_id, write_track
    from tonalia_engine.keys import Key

    folder = tmp_path / "sin analizar"
    folder.mkdir()
    write_track(folder / "nuevo.flac", Key(0, "major"), 120.0, seconds=8.0)
    import_folder(ctx, folder)
    tid = track_id(ctx, "nuevo")
    error = call_error(
        ctx, "grid.update", {"trackId": tid, "grid": {"bpm": 120, "firstDownbeat": 0}}
    )
    assert error["data"]["reason"] == "not_analysed"
    bad = call_error(
        ctx,
        "grid.update",
        {
            "trackId": tid,
            "grid": {"bpm": 120, "firstDownbeat": 0, "anchors": [{"beat": 0, "time": 1}]},
        },
    )
    assert bad["data"]["reason"] == "invalid_params"
    missing = call_error(ctx, "grid.reset", {"trackId": 9999})
    assert missing["data"]["reason"] == "track_not_found"


def test_the_stored_grid_round_trips_through_beatgrid() -> None:
    grid = build_grid(
        GridSpec(bpm=120.0, first_downbeat=1.0, anchors=[GridAnchor(beat=8, time=5.1)]),
        duration=12.0,
    )
    from dataclasses import asdict

    assert BeatGrid(**json.loads(json.dumps(asdict(grid)))) == grid
