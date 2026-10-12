"""Analysis settings (SPEC 2.4 and 2.14): BPM range and parallel processes."""

from tests.test_analysis_queue import call, ctx
from tests.test_track_update import call_error
from tonalia_engine.analysis.queue import default_workers
from tonalia_engine.db import Database
from tonalia_engine.server import EngineContext

__all__ = ["ctx"]


def test_defaults(ctx: EngineContext) -> None:
    settings = call(ctx, "settings.get", {})
    assert settings["bpmRange"] == [70.0, 180.0]
    assert settings["analysisWorkers"] == 0  # automatic: cores - 1


def test_the_queue_reads_what_settings_store(ctx: EngineContext) -> None:
    call(ctx, "settings.set", {"bpmRange": [85, 175], "analysisWorkers": 3})
    db = Database.open(ctx.db_path)
    try:
        analysis, workers = ctx.analysis._settings(db)
    finally:
        db.close()
    assert (analysis.min_bpm, analysis.max_bpm, workers) == (85.0, 175.0, 3)

    call(ctx, "settings.set", {"analysisWorkers": 0})
    db = Database.open(ctx.db_path)
    try:
        assert ctx.analysis._settings(db)[1] in (default_workers(), ctx.analysis_workers)
    finally:
        db.close()


def test_validation(ctx: EngineContext) -> None:
    for bad in ([180, 70], [30, 180], [70, 300], [120, 125], [100]):
        assert call_error(ctx, "settings.set", {"bpmRange": bad})["code"] == -32602, bad
    for bad in (-1, 65):
        assert call_error(ctx, "settings.set", {"analysisWorkers": bad})["code"] == -32602, bad
