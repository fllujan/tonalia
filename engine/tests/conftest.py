from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest

from tonalia_engine.server import EngineContext


@pytest.fixture(autouse=True)
def isolated_data_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Never let a test touch the user's real Tonalia data directory."""
    data = tmp_path / "datos de Tonalia ñ"
    monkeypatch.setenv("TONALIA_DATA_DIR", str(data))
    return data


class RecordingNotifier:
    def __init__(self) -> None:
        self.messages: list[tuple[str, Any]] = []

    def notify(self, method: str, params: Any) -> None:
        self.messages.append((method, params))


@pytest.fixture
def engine_ctx(isolated_data_dir: Path) -> Iterator[EngineContext]:
    ctx = EngineContext(isolated_data_dir, RecordingNotifier())
    yield ctx
    ctx.close()
