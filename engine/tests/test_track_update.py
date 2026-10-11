"""Manual edits (SPEC 2.14: they prevail over the analysis) and settings (notation)."""

import json
from pathlib import Path
from typing import Any

import pytest

from tests.test_analysis_queue import call, ctx, import_folder, track_id, wait_job, write_track
from tonalia_engine.keys import Key
from tonalia_engine.server import EngineContext, build_dispatcher

__all__ = ["ctx"]  # re-exported fixture


def call_error(context: EngineContext, method: str, params: Any) -> dict[str, Any]:
    msg = {"jsonrpc": "2.0", "id": 1, "method": method, "params": params}
    out = build_dispatcher(context).handle_line(json.dumps(msg))
    assert out is not None
    reply = json.loads(out)
    assert "error" in reply, reply
    error: dict[str, Any] = reply["error"]
    return error


def test_settings_defaults_and_partial_update(ctx: EngineContext) -> None:
    assert call(ctx, "settings.get") == {"notation": "alphanumeric", "bpmDecimals": 2}
    updated = call(ctx, "settings.set", {"notation": "open_key"})
    assert updated == {"notation": "open_key", "bpmDecimals": 2}
    assert call(ctx, "settings.get")["notation"] == "open_key"
    assert call(ctx, "settings.set", {"bpmDecimals": 0})["notation"] == "open_key"


def test_settings_reject_unknown_notation(ctx: EngineContext) -> None:
    assert call_error(ctx, "settings.set", {"notation": "camelot"})["code"] == -32602
    assert call(ctx, "settings.get")["notation"] == "alphanumeric"


def test_manual_key_and_bpm_survive_reanalysis(ctx: EngineContext, tmp_path: Path) -> None:
    folder = tmp_path / "Edición ✏️"
    folder.mkdir()
    write_track(folder / "edit.flac", Key(9, "minor"), 124.0, seconds=20.0)
    import_folder(ctx, folder)
    tid = track_id(ctx, "edit")

    # Edit before the first analysis: the analysis must not overwrite it.
    edited = call(ctx, "track.update", {"trackId": tid, "key": {"root": 2, "mode": "major"}})
    assert (edited["keyRoot"], edited["keyMode"]) == (2, "major")
    assert edited["editedFields"] == ["key"]
    assert edited["keyConfidence"] is None

    wait_job(ctx, call(ctx, "analysis.start", {"trackIds": [tid]})["jobId"])
    after = call(ctx, "library.get", {"trackId": tid})
    assert (after["keyRoot"], after["keyMode"]) == (2, "major")
    assert after["bpm"] == pytest.approx(124.0, abs=0.1)  # not edited: analysed

    call(ctx, "track.update", {"trackId": tid, "bpm": 62.0, "energy": 9})
    wait_job(ctx, call(ctx, "analysis.reanalyze", {"trackIds": [tid]})["jobId"])
    final = call(ctx, "library.get", {"trackId": tid})
    assert final["bpm"] == 62.0
    assert final["energy"] == 9
    assert (final["keyRoot"], final["keyMode"]) == (2, "major")
    assert sorted(final["editedFields"]) == ["bpm", "energy", "key"]
    listed = call(ctx, "library.list", {"search": "edit"})["items"][0]
    assert sorted(listed["editedFields"]) == ["bpm", "energy", "key"]


def test_update_validation(ctx: EngineContext, tmp_path: Path) -> None:
    assert call_error(ctx, "track.update", {"trackId": 999, "bpm": 120})["code"] == -32602
    folder = tmp_path / "v"
    folder.mkdir()
    write_track(folder / "v.flac", Key(0, "major"), 120.0, seconds=8.0)
    import_folder(ctx, folder)
    tid = track_id(ctx, "v")
    assert call_error(ctx, "track.update", {"trackId": tid, "bpm": 0})["code"] == -32602
    assert call_error(ctx, "track.update", {"trackId": tid, "energy": 11})["code"] == -32602
    bad_key = {"trackId": tid, "key": {"root": 12, "mode": "major"}}
    assert call_error(ctx, "track.update", bad_key)["code"] == -32602
    # Clearing a value is a manual edit too ("no key").
    cleared = call(ctx, "track.update", {"trackId": tid, "key": None})
    assert cleared["keyRoot"] is None and cleared["editedFields"] == ["key"]
