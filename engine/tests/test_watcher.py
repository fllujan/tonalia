"""Watched folders (SPEC 2.14): new tracks are imported and analysed on their own."""

import time
import wave
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest

from tests.conftest import RecordingNotifier
from tests.test_analysis_queue import call, events
from tests.test_track_update import call_error
from tonalia_engine.server import EngineContext
from tonalia_engine.watcher import FolderWatcher


def write_wav(path: Path, frames: int = 4410) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(44100)
        w.writeframes(b"\x00\x00" * frames)
    return path


# ---- FolderWatcher unit (no threads: ticks are driven by hand) ----


class Recorder:
    def __init__(self, folders: list[Path]) -> None:
        self.folders = folders
        self.known: dict[str, tuple[int, float]] = {}
        self.imports: list[list[str]] = []

    def watcher(self) -> FolderWatcher:
        return FolderWatcher(
            folders=lambda: [str(f) for f in self.folders],
            known=lambda: self.known,
            start_import=lambda paths: self.imports.append(sorted(str(p) for p in paths)),
        )


def test_imports_new_files_once_they_stop_changing(tmp_path: Path) -> None:
    folder = tmp_path / "Vigilada 👀"
    rec = Recorder([folder])
    w = rec.watcher()
    write_wav(folder / "uno.wav")
    (folder / "notas.txt").write_text("x", encoding="utf-8")
    (folder / ".oculto.wav").write_bytes(b"x")

    assert w.tick() is True  # seen once: wait for a second look
    assert rec.imports == []
    assert w.tick() is False
    assert rec.imports == [[str(folder / "uno.wav")]]

    # Still growing between ticks: not imported until two ticks agree.
    big = write_wav(folder / "sub" / "dos.wav", frames=10)
    w.tick()
    write_wav(big, frames=20)
    w.tick()
    assert len(rec.imports) == 1
    w.tick()
    assert rec.imports[-1] == [str(big)]


def test_known_and_attempted_files_are_not_imported_again(tmp_path: Path) -> None:
    folder = tmp_path / "música"
    rec = Recorder([folder])
    known = write_wav(folder / "conocida.wav")
    st = known.stat()
    rec.known[str(known)] = (st.st_size, st.st_mtime)
    dup = write_wav(folder / "duplicado.wav")
    w = rec.watcher()
    w.tick()
    w.tick()
    assert rec.imports == [[str(dup)]]
    # The import skipped it (e.g. a duplicate copy): no retry while it is unchanged...
    w.tick()
    w.tick()
    assert len(rec.imports) == 1
    # ...but a changed file is tried again.
    write_wav(dup, frames=99)
    w.tick()
    w.tick()
    assert rec.imports[-1] == [str(dup)]


def test_missing_folders_are_ignored(tmp_path: Path) -> None:
    rec = Recorder([tmp_path / "no existe"])
    w = rec.watcher()
    assert w.tick() is False
    assert rec.imports == []


# ---- through the engine ----


@pytest.fixture
def fast_ctx(isolated_data_dir: Path) -> Iterator[EngineContext]:
    ctx = EngineContext(
        isolated_data_dir, RecordingNotifier(), analysis_workers=1, watch_interval=0.2
    )
    yield ctx
    ctx.close()


def wait_for(predicate: Any, timeout: float = 30.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(0.05)
    raise AssertionError("timed out")


def test_settings_store_watched_folders(fast_ctx: EngineContext, tmp_path: Path) -> None:
    folder = tmp_path / "Carpeta ñ 🎧"
    folder.mkdir()
    assert call(fast_ctx, "settings.get")["watchedFolders"] == []
    updated = call(fast_ctx, "settings.set", {"watchedFolders": [str(folder), str(folder)]})
    assert updated["watchedFolders"] == [str(folder)]
    assert call_error(fast_ctx, "settings.set", {"watchedFolders": ["relativa/x"]})["code"] == (
        -32602
    )


def test_new_tracks_in_a_watched_folder_are_imported_and_analysed(
    fast_ctx: EngineContext, tmp_path: Path
) -> None:
    folder = tmp_path / "Descargas 🎶"
    folder.mkdir()
    call(fast_ctx, "settings.set", {"watchedFolders": [str(folder)]})
    write_wav(folder / "nuevo tema.wav", frames=44100 * 3)

    wait_for(lambda: call(fast_ctx, "library.list", {})["total"] == 1)
    wait_for(lambda: [e for e in events(fast_ctx, "job.finished") if e["kind"] == "watch.import"])
    finished = [e for e in events(fast_ctx, "job.finished") if e["kind"] == "watch.import"]
    assert finished[0]["result"]["added"] == 1
    # Analysis is chained, as for a manual import.
    wait_for(lambda: any(e["kind"] == "analysis" for e in events(fast_ctx, "job.started")))
