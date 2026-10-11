import json
import shutil
import time
from pathlib import Path
from typing import Any

from tests.conftest import RecordingNotifier
from tests.fixtures.generate import encode, write_tone_wav
from tonalia_engine.rpc import INVALID_PARAMS
from tonalia_engine.rpc_schema import EventParams
from tonalia_engine.server import EngineContext, build_dispatcher


def call(ctx: EngineContext, method: str, params: Any = None) -> Any:
    msg: dict[str, Any] = {"jsonrpc": "2.0", "id": 1, "method": method}
    if params is not None:
        msg["params"] = params
    out = build_dispatcher(ctx).handle_line(json.dumps(msg, ensure_ascii=False))
    assert out is not None
    return json.loads(out)


def wait_finished(ctx: EngineContext, job_id: str) -> dict[str, Any]:
    notifier = ctx.notifier
    assert isinstance(notifier, RecordingNotifier)
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        for method, params in notifier.messages:
            if (
                method == "event"
                and isinstance(params, EventParams)
                and params.type == "job.finished"
                and params.payload["jobId"] == job_id
            ):
                return params.payload
        time.sleep(0.02)
    raise AssertionError("job did not finish")


def test_import_list_get_remove(engine_ctx: EngineContext, tmp_path: Path) -> None:
    folder = tmp_path / "Bolos 🌅"
    src = encode(write_tone_wav(tmp_path / "s.wav", seconds=0.5), tmp_path / "s.flac", "flac")
    for name in ("Velvet Static.flac", "Cobalt Rain.flac"):
        folder.mkdir(exist_ok=True)
        shutil.copyfile(src, folder / name)
        # distinct content so they are not duplicates
        with (folder / name).open("ab") as f:
            f.write(name.encode())

    started = call(engine_ctx, "library.addPaths", {"paths": [str(folder)]})
    job_id = started["result"]["jobId"]
    finished = wait_finished(engine_ctx, job_id)
    assert finished["status"] == "done"
    assert finished["result"]["added"] == 2

    page = call(engine_ctx, "library.list", {"sort": "title", "descending": False})["result"]
    assert page["total"] == 2
    first = page["items"][0]
    assert {"id", "path", "addedAt", "artworkPath", "keyRoot", "cueCount"} <= set(first)
    assert first["path"].endswith("Cobalt Rain.flac")

    detail = call(engine_ctx, "library.get", {"trackId": first["id"]})["result"]
    assert detail["fileHash"] and detail["size"] > 0

    removed = call(engine_ctx, "library.remove", {"trackIds": [first["id"]]})["result"]
    assert removed == {"removed": 1}
    assert (folder / "Cobalt Rain.flac").exists()


def test_invalid_params_are_reported(engine_ctx: EngineContext) -> None:
    err = call(engine_ctx, "library.addPaths", {"paths": []})["error"]
    assert err["code"] == INVALID_PARAMS
    assert err["data"][0]["loc"] == "paths"
    err = call(engine_ctx, "library.list", {"sort": "nonsense"})["error"]
    assert err["code"] == INVALID_PARAMS
    err = call(engine_ctx, "library.get", {"trackId": 12345})["error"]
    assert err["code"] == INVALID_PARAMS


def test_progress_notifications_use_camel_case(engine_ctx: EngineContext, tmp_path: Path) -> None:
    started = call(engine_ctx, "library.addPaths", {"paths": [str(tmp_path / "vacía")]})
    wait_finished(engine_ctx, started["result"]["jobId"])
    notifier = engine_ctx.notifier
    assert isinstance(notifier, RecordingNotifier)
    progress = [p for m, p in notifier.messages if m == "progress"]
    assert progress and progress[0].model_dump(by_alias=True)["jobId"]


def test_genres_for_autocomplete(engine_ctx: EngineContext) -> None:
    db = engine_ctx.db
    for i, genre in enumerate(
        ["Techno", "Deep House", "techno", "Techno", None, "Deep House", "Afro House"]
    ):
        db.conn.execute(
            "INSERT INTO tracks (path, file_hash, size, mtime, genre, status) "
            "VALUES (?, ?, 1, 0, ?, 'pending')",
            (f"/m/{i}.mp3", f"h{i}", genre),
        )
    genres = call(engine_ctx, "library.genres")["result"]["genres"]
    # Most used first, case variants counted together under the most common spelling.
    assert genres == [
        {"name": "Techno", "count": 3},
        {"name": "Deep House", "count": 2},
        {"name": "Afro House", "count": 1},
    ]
