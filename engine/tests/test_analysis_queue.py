import json
import time
import wave
from pathlib import Path
from typing import Any

import numpy as np
import pytest

from tests.conftest import RecordingNotifier
from tests.fixtures.generate import encode
from tests.fixtures.music import SR, progression
from tests.fixtures.rhythm import click_track
from tonalia_engine.analysis.pipeline import ANALYSIS_VERSION
from tonalia_engine.analysis.queue import recover_interrupted
from tonalia_engine.keys import Key
from tonalia_engine.rpc_schema import EventParams
from tonalia_engine.server import EngineContext, build_dispatcher


def write_track(path: Path, key: Key, bpm: float, seconds: float = 30.0) -> Path:
    music = progression(key, seconds)
    drums = click_track(bpm, seconds)
    audio = np.clip(0.5 * music + 0.6 * drums[: len(music)], -1, 1)
    wav = path.with_suffix(".wav")
    with wave.open(str(wav), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((audio * 32767).astype("<i2").tobytes())
    out = encode(wav, path, "flac")
    wav.unlink()
    return out


@pytest.fixture
def ctx(isolated_data_dir: Path) -> Any:
    context = EngineContext(isolated_data_dir, RecordingNotifier(), analysis_workers=2)
    yield context
    context.close()


def call(ctx: EngineContext, method: str, params: Any = None) -> Any:
    msg: dict[str, Any] = {"jsonrpc": "2.0", "id": 1, "method": method}
    if params is not None:
        msg["params"] = params
    out = build_dispatcher(ctx).handle_line(json.dumps(msg))
    assert out is not None
    reply = json.loads(out)
    assert "error" not in reply, reply
    return reply["result"]


def events(ctx: EngineContext, kind: str) -> list[dict[str, Any]]:
    notifier = ctx.notifier
    assert isinstance(notifier, RecordingNotifier)
    return [
        p.payload
        for m, p in list(notifier.messages)
        if m == "event" and isinstance(p, EventParams) and p.type == kind
    ]


def wait_job(ctx: EngineContext, job_id: str, timeout: float = 120) -> dict[str, Any]:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        for e in events(ctx, "job.finished"):
            if e["jobId"] == job_id:
                return e
        time.sleep(0.05)
    raise AssertionError(f"job {job_id} did not finish")


def import_folder(ctx: EngineContext, folder: Path) -> None:
    job = call(ctx, "library.addPaths", {"paths": [str(folder)], "analyze": False})
    assert wait_job(ctx, job["jobId"])["status"] == "done"


def track_id(ctx: EngineContext, name: str) -> int:
    page = call(ctx, "library.list", {"search": name})
    assert page["total"] == 1, page
    return int(page["items"][0]["id"])


def test_analyses_tracks_and_stores_results(ctx: EngineContext, tmp_path: Path) -> None:
    folder = tmp_path / "Análisis 🎛️"
    folder.mkdir()
    write_track(folder / "uno.flac", Key(9, "minor"), 124.0)
    write_track(folder / "dos.flac", Key(7, "major"), 128.0)
    (folder / "roto.mp3").write_bytes(b"\x00" * 4096)
    import_folder(ctx, folder)

    started = call(ctx, "analysis.start", {"includeErrors": True})
    assert started["queued"] == 3
    finished = wait_job(ctx, started["jobId"])
    assert finished["status"] == "done"
    assert finished["result"] == {"analyzed": 2, "failed": 1, "cancelled": 0}

    one = call(ctx, "library.get", {"trackId": track_id(ctx, "uno")})
    assert (one["keyRoot"], one["keyMode"]) == (9, "minor")
    assert one["bpm"] == pytest.approx(124.0, abs=0.1)
    assert one["status"] == "ready"
    assert one["analysisVersion"] == ANALYSIS_VERSION
    assert len(one["keyAlternatives"]) == 2
    assert one["tuningHz"] == pytest.approx(440.0, abs=2.0)
    assert one["beatGrid"]["kind"] == "constant"
    assert 1 <= one["energy"] <= 10
    assert one["energyCurve"] and {"start", "end", "level"} <= set(one["energyCurve"][0])
    assert one["energyCurve"][0]["start"] == 0.0
    two = call(ctx, "library.get", {"trackId": track_id(ctx, "dos")})
    assert (two["keyRoot"], two["keyMode"], round(two["bpm"])) == (7, "major", 128)

    broken = call(ctx, "library.get", {"trackId": track_id(ctx, "roto")})
    assert broken["status"] == "error" and broken["error"]

    done = {e["trackId"]: e["status"] for e in events(ctx, "analysis.trackDone")}
    assert sorted(done.values()) == ["error", "ready", "ready"]


def test_import_chains_analysis(ctx: EngineContext, tmp_path: Path) -> None:
    folder = tmp_path / "auto"
    folder.mkdir()
    write_track(folder / "auto.flac", Key(0, "major"), 120.0, seconds=20.0)
    job = call(ctx, "library.addPaths", {"paths": [str(folder)]})
    wait_job(ctx, job["jobId"])
    deadline = time.monotonic() + 60
    while not events(ctx, "job.started") and time.monotonic() < deadline:
        time.sleep(0.05)
    analysis_job = events(ctx, "job.started")[0]
    assert analysis_job["kind"] == "analysis"
    assert wait_job(ctx, analysis_job["jobId"])["result"]["analyzed"] == 1


def test_reanalyze_and_cancel(ctx: EngineContext, tmp_path: Path) -> None:
    folder = tmp_path / "varios"
    folder.mkdir()
    for i in range(6):
        write_track(folder / f"t{i}.flac", Key(i, "major"), 120.0 + i, seconds=20.0)
    import_folder(ctx, folder)
    started = call(ctx, "analysis.start")
    time.sleep(0.5)
    assert call(ctx, "job.cancel", {"jobId": started["jobId"]})["cancelled"]
    finished = wait_job(ctx, started["jobId"])
    assert finished["status"] == "cancelled"
    statuses = [i["status"] for i in call(ctx, "library.list")["items"]]
    assert "analyzing" not in statuses
    assert statuses.count("pending") >= 1

    tid = track_id(ctx, "t3")
    again = call(ctx, "analysis.reanalyze", {"trackIds": [tid]})
    assert wait_job(ctx, again["jobId"])["result"]["analyzed"] == 1
    assert call(ctx, "library.get", {"trackId": tid})["keyRoot"] == 3


def test_requests_during_a_run_join_the_same_job(ctx: EngineContext, tmp_path: Path) -> None:
    folder = tmp_path / "cola"
    folder.mkdir()
    for i in range(3):
        # Distinct content per file (identical audio would be deduplicated on import).
        write_track(folder / f"c{i}.flac", Key(2, "minor"), 124.0 + i, seconds=15.0)
    import_folder(ctx, folder)
    ids = [i["id"] for i in call(ctx, "library.list")["items"]]
    first = call(ctx, "analysis.start", {"trackIds": ids[:1]})
    second = call(ctx, "analysis.start", {"trackIds": ids})
    assert second["jobId"] == first["jobId"]
    assert second["queued"] == 2  # the first id was already queued
    assert wait_job(ctx, first["jobId"])["result"]["analyzed"] == 3


def test_interrupted_analysis_is_recovered(ctx: EngineContext) -> None:
    ctx.db.conn.execute("INSERT INTO tracks(path, status) VALUES ('/x.flac', 'analyzing')")
    assert recover_interrupted(ctx.db) == 1
    status = ctx.db.conn.execute("SELECT status FROM tracks WHERE path = '/x.flac'").fetchone()
    assert status[0] == "pending"
