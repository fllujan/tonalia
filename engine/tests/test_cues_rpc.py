"""Segments and cue points through RPC (SPEC 2.6): auto cues, user cues kept, reset."""

import wave
from pathlib import Path
from typing import Any

import numpy as np
import pytest

from tests.fixtures.energy import section
from tests.fixtures.generate import encode
from tests.fixtures.music import SR
from tests.test_analysis_queue import call, ctx, import_folder, track_id, wait_job
from tests.test_track_update import call_error
from tonalia_engine.server import EngineContext

__all__ = ["ctx"]

BPM = 124.0
BAR = 240.0 / BPM
PLAN = [(0.35, 16), (0.6, 8), (1.0, 16), (0.05, 16), (0.6, 8), (1.0, 16), (0.35, 16)]


def write_club_track(path: Path) -> Path:
    audio = np.concatenate(
        [section(lv, bars * BAR, BPM, seed=i) for i, (lv, bars) in enumerate(PLAN)]
    )
    wav = path.with_suffix(".wav")
    with wave.open(str(wav), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((np.clip(audio, -1, 1) * 32767).astype("<i2").tobytes())
    out = encode(wav, path, "flac")
    wav.unlink()
    return out


@pytest.fixture
def analysed(ctx: EngineContext, tmp_path: Path) -> int:
    folder = tmp_path / "Estructura 🎚️"
    folder.mkdir()
    write_club_track(folder / "club.flac")
    import_folder(ctx, folder)
    tid = track_id(ctx, "club")
    wait_job(ctx, call(ctx, "analysis.start", {"trackIds": [tid]})["jobId"])
    return tid


def bars(cues: list[dict[str, Any]], grid: dict[str, Any]) -> list[float]:
    return [
        round((c["positionSec"] - grid["first_downbeat"]) / (240.0 / grid["bpm"]), 2) for c in cues
    ]


def test_analysis_stores_segments_and_auto_cues(ctx: EngineContext, analysed: int) -> None:
    detail = call(ctx, "library.get", {"trackId": analysed})
    labels = [s["label"] for s in detail["segments"]]
    assert labels[0] == "intro" and labels[-1] == "outro"
    assert labels.count("drop") == 2 and "breakdown" in labels
    cues = detail["cues"]
    assert [c["slot"] for c in cues] == list(range(len(cues)))
    assert all(c["source"] == "auto" for c in cues)
    assert [c["label"] for c in cues] == ["intro", "drop", "breakdown", "drop2", "outro"]
    # Every cue sits on a downbeat of the stored grid.
    positions = bars(cues, detail["beatGrid"])
    assert all(abs(p - round(p)) < 0.02 for p in positions), positions
    assert detail["cueCount"] == 5
    assert call(ctx, "cues.list", {"trackId": analysed})["cues"] == cues


def test_user_cues_survive_reanalysis(ctx: EngineContext, analysed: int) -> None:
    drop = next(
        c for c in call(ctx, "cues.list", {"trackId": analysed})["cues"] if c["label"] == "drop"
    )
    mine = call(
        ctx,
        "cues.set",
        {
            "trackId": analysed,
            "slot": 7,
            "positionSec": drop["positionSec"] + 0.1,
            "label": "Mi drop",
            "color": "#123ABC",
        },
    )
    assert mine["source"] == "user" and mine["slot"] == 7
    wait_job(ctx, call(ctx, "analysis.reanalyze", {"trackIds": [analysed]})["jobId"])
    cues = call(ctx, "cues.list", {"trackId": analysed})["cues"]
    user = [c for c in cues if c["source"] == "user"]
    assert user == [mine]
    # The auto drop cue near the user's cue is not duplicated.
    assert "drop" not in [c["label"] for c in cues if c["source"] == "auto"]


def test_delete_reset_and_cue_count(ctx: EngineContext, analysed: int) -> None:
    assert call(ctx, "cues.delete", {"trackId": analysed, "slot": 0})["deleted"] is True
    assert call(ctx, "cues.delete", {"trackId": analysed, "slot": 0})["deleted"] is False
    call(ctx, "cues.set", {"trackId": analysed, "slot": 3, "positionSec": 1.0})
    call(ctx, "settings.set", {"cueCount": 3})
    reset = call(ctx, "cues.resetAuto", {"trackId": analysed})["cues"]
    assert [c["source"] for c in reset] == ["auto"] * 3
    assert [c["label"] for c in reset] == ["intro", "drop", "breakdown"]
    call(ctx, "settings.set", {"cueCount": 0})
    assert call(ctx, "cues.resetAuto", {"trackId": analysed})["cues"] == []


def test_cue_validation(ctx: EngineContext, analysed: int) -> None:
    bad = [
        {"trackId": analysed, "slot": 8, "positionSec": 1.0},
        {"trackId": analysed, "slot": 0, "positionSec": -1.0},
        {"trackId": analysed, "slot": 0, "positionSec": 1.0, "color": "red"},
        {"trackId": 999, "slot": 0, "positionSec": 1.0},
    ]
    for params in bad:
        assert call_error(ctx, "cues.set", params)["code"] == -32602
