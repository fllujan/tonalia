"""Phase 1 acceptance (SPEC §4): import 1000 test files without blocking, with correct
metadata and paths containing accents/emojis."""

import json
import threading
import time
from pathlib import Path
from typing import Any

import pytest

from tests.conftest import RecordingNotifier
from tonalia_engine.rpc import Dispatcher
from tonalia_engine.rpc_schema import EventParams
from tonalia_engine.server import EngineContext, build_dispatcher
from tools.make_test_library import make_library

COUNT = 1000


def call(d: Dispatcher, method: str, params: Any = None) -> Any:
    msg: dict[str, Any] = {"jsonrpc": "2.0", "id": 1, "method": method}
    if params is not None:
        msg["params"] = params
    out = d.handle_line(json.dumps(msg, ensure_ascii=False))
    assert out is not None
    reply = json.loads(out)
    assert "error" not in reply, reply
    return reply["result"]


def finished(notifier: RecordingNotifier) -> dict[str, Any] | None:
    for method, params in list(notifier.messages):
        if method == "event" and isinstance(params, EventParams) and params.type == "job.finished":
            payload: dict[str, Any] = params.payload
            return payload
    return None


def test_import_1000_files(engine_ctx: EngineContext, tmp_path: Path) -> None:
    root = tmp_path / "Música de prueba 🎧"
    generated = make_library(root, COUNT)
    d = build_dispatcher(engine_ctx)
    notifier = engine_ctx.notifier
    assert isinstance(notifier, RecordingNotifier)

    start = time.monotonic()
    # Import only: chained analysis has its own tests and would race the status checks.
    job = call(d, "library.addPaths", {"paths": [str(root)], "analyze": False})
    assert job["jobId"]

    # The engine must keep answering while the import runs (the UI never blocks).
    latencies: list[float] = []
    while finished(notifier) is None:
        t0 = time.monotonic()
        assert call(d, "engine.ping") == {"pong": True}
        page = call(d, "library.list", {"limit": 50})
        latencies.append(time.monotonic() - t0)
        assert page["total"] <= COUNT
        assert time.monotonic() - start < 300, "import took too long"
        time.sleep(0.02)
    elapsed = time.monotonic() - start

    result = finished(notifier)
    assert result is not None and result["status"] == "done", result
    assert result["result"]["added"] == COUNT
    assert result["result"]["failed"] == []
    assert max(latencies, default=0) < 0.5, f"UI-facing calls blocked: {max(latencies):.3f}s"
    progress = [p for m, p in notifier.messages if m == "progress"]
    assert progress, "no progress notifications"

    # Metadata and Unicode paths come back intact.
    page = call(d, "library.list", {"limit": 5000, "sort": "title", "descending": False})
    assert page["total"] == COUNT
    by_path = {item["path"]: item for item in page["items"]}
    for track in generated[:: COUNT // 50]:
        item = by_path[str(track.path)]
        assert item["title"] == track.title
        assert item["artist"] == track.artist
        assert item["genre"] == track.genre
        assert item["status"] == "pending"
        assert item["duration"] == pytest.approx(0.2, abs=0.08)
    assert {item["format"] for item in page["items"]} == {"flac", "mp3", "m4a"}

    # Accent-insensitive search across titles, artists and paths.
    assert call(d, "library.list", {"search": "musica de prueba"})["total"] == COUNT
    assert call(d, "library.list", {"search": "LUMEN drift"})["total"] == COUNT // 10

    # Re-importing is fast and changes nothing.
    notifier.messages.clear()
    call(d, "library.addPaths", {"paths": [str(root)], "analyze": False})
    while (again := finished(notifier)) is None:
        time.sleep(0.02)
    assert again["result"]["unchanged"] == COUNT

    print(f"\nimported {COUNT} files in {elapsed:.2f}s; max call latency {max(latencies):.3f}s")


def test_engine_thread_safety_smoke(engine_ctx: EngineContext, tmp_path: Path) -> None:
    """Concurrent list calls while an import writes must not raise."""
    root = tmp_path / "pocos"
    make_library(root, 60)
    d = build_dispatcher(engine_ctx)
    errors: list[BaseException] = []

    def reader() -> None:
        try:
            for _ in range(50):
                call(d, "library.list", {"search": "midnight"})
        except BaseException as exc:
            errors.append(exc)

    call(d, "library.addPaths", {"paths": [str(root)], "analyze": False})
    threads = [threading.Thread(target=reader) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert not errors
