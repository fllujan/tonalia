"""Take a library from one DJ program to another (SPEC 13.2): import + export, with a
preview that changes nothing, what does not survive the trip, and a trip that fails
leaving Tonalia as it was."""

from __future__ import annotations

import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

import pytest

from tests.test_analysis_queue import call, wait_job
from tests.test_export_rekordbox import library
from tests.test_export_traktor import collection_xml
from tests.test_import import VOLUME, diff, dump, lib, path_of, programs_closed, rekordbox_xml
from tonalia_engine import convert
from tonalia_engine.export import traktor_nml
from tonalia_engine.import_ import service as import_service
from tonalia_engine.rpc_schema import ConvertOptions, ExportOptions, ExportResult
from tonalia_engine.server import EngineContext

__all__ = ["lib", "library", "programs_closed"]


@pytest.fixture(autouse=True)
def traktor_closed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(traktor_nml, "traktor_running", lambda: False)
    monkeypatch.setattr(traktor_nml, "root_volume_name", lambda: VOLUME)
    monkeypatch.setitem(convert.RUNNING, "traktor", lambda: False)


def trip(
    ctx: EngineContext, lib: dict[str, int], tmp_path: Path
) -> tuple[dict[str, Any], Path, Path]:
    """Options for Rekordbox → Traktor, the rekordbox.xml and the target collection.nml."""
    bloom, neon = path_of(ctx, lib["bloom"]), path_of(ctx, lib["neon"])
    xml = tmp_path / "rekordbox.xml"
    xml.write_text(rekordbox_xml(bloom, neon, tmp_path / "x.mp3", tmp_path / "y.mp3"))
    nml = tmp_path / "Native Instruments" / "Traktor 4.0.2" / "collection.nml"
    nml.parent.mkdir(parents=True)
    nml.write_text(collection_xml(bloom), encoding="utf-8")
    options = {
        "source": "rekordbox",
        "target": "traktor",
        "sourcePath": str(xml),
        "targetPath": str(nml),
        "language": "es",
    }
    return options, xml, nml


def run(ctx: EngineContext, method: str, options: dict[str, Any]) -> dict[str, Any]:
    return wait_job(ctx, call(ctx, method, options)["jobId"])


def test_the_plan_changes_nothing_and_says_what_is_lost(
    engine_ctx: EngineContext, lib: dict[str, int], tmp_path: Path
) -> None:
    options, _, nml = trip(engine_ctx, lib, tmp_path)
    before, target = dump(engine_ctx), nml.read_bytes()
    finished = run(engine_ctx, "convert.plan", options)
    assert finished["status"] == "done", finished
    report = finished["result"]
    assert report["simulated"] and report["importReport"]["simulated"]
    assert report["importReport"]["batchId"] is None
    assert report["exportResult"]["simulated"]
    # The export sees the tracks as the import leaves them: the collection's two tracks.
    assert report["exportResult"]["tracks"] == 2
    losses = {loss["code"]: loss for loss in report["losses"]}
    # Traktor keeps no cue colours and one tempo per track; nothing exports the memory cue
    # and the loop, the stars, the plays or the comment yet; two files are not on disk.
    # (Rekordbox's two coloured pads plus Tonalia's automatic cues, coloured by section.)
    assert losses["cue_colors"]["tracks"] == 1 and losses["cue_colors"]["items"] >= 2
    assert losses["variable_tempo"]["tracks"] == 1
    assert losses["markers"]["items"] == 2
    assert losses["rating"]["tracks"] == 1 and losses["play_count"]["tracks"] == 1
    assert losses["comment"]["tracks"] == 1
    assert losses["not_in_tonalia"]["tracks"] == 2
    assert "beatgrid" not in losses  # Traktor gets the grid
    # Nothing changed: not Tonalia, not the target, not the source.
    assert diff(dump(engine_ctx), before) == []
    assert nml.read_bytes() == target


def test_rekordbox_to_traktor_keeps_cues_and_grid(
    engine_ctx: EngineContext, lib: dict[str, int], tmp_path: Path
) -> None:
    options, xml, nml = trip(engine_ctx, lib, tmp_path)
    source = xml.read_bytes()
    before = dump(engine_ctx)
    finished = run(engine_ctx, "convert.apply", options)
    assert finished["status"] == "done", finished
    report = finished["result"]
    assert not report["simulated"] and report["importReport"]["batchId"]
    assert report["exportResult"]["backupPath"]  # the old collection.nml was kept
    assert xml.read_bytes() == source  # the source is only read

    root = ET.parse(nml).getroot()
    bloom = path_of(engine_ctx, lib["bloom"]).name
    entry = next(
        e for e in root.iter("ENTRY") if (loc := e.find("LOCATION")) is not None
        and loc.get("FILE") == bloom
    )  # fmt: skip
    hot = {
        int(c.get("HOTCUE", "-1")): (round(float(c.get("START", "0"))), c.get("NAME"))
        for c in entry.findall("CUE_V2")
        if c.get("HOTCUE") not in (None, "-1")
    }
    # Rekordbox's pads 1 and 3, on the same millisecond.
    assert hot[1] == (31050, "Drop!") and hot[3] == (70000, "Mine")
    tempo = entry.find("TEMPO")
    assert tempo is not None and float(tempo.get("BPM", "0")) == pytest.approx(125.0)
    grid = [c for c in entry.findall("CUE_V2") if c.get("TYPE") == "4"]
    assert [round(float(c.get("START", "0"))) for c in grid] == [300]  # Inizio 0.300
    # The DJ's playlists, in Traktor's "Tonalia" folder (not inside "Imported from …").
    folder = next(n for n in root.iter("NODE") if n.get("NAME") == "Tonalia")
    names = [n.get("NAME") for n in folder.findall("SUBNODES/NODE")]
    assert names == ["Bolos", "Suelta"]

    # Undoing the import leaves Tonalia as it was (the target keeps its backup).
    call(engine_ctx, "import.undo", {"batchId": report["importReport"]["batchId"]})
    assert diff(dump(engine_ctx), before) == []


def test_an_open_target_stops_the_trip_before_anything_is_written(
    engine_ctx: EngineContext,
    lib: dict[str, int],
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    options, _, nml = trip(engine_ctx, lib, tmp_path)
    monkeypatch.setitem(convert.RUNNING, "traktor", lambda: True)
    before, target = dump(engine_ctx), nml.read_bytes()
    finished = run(engine_ctx, "convert.apply", options)
    assert finished["status"] == "failed"
    assert finished["errorInfo"]["reason"] == "program_running"
    assert diff(dump(engine_ctx), before) == [] and nml.read_bytes() == target


class _Job:
    def progress(self, *_: Any, **__: Any) -> None:
        pass

    def check_cancelled(self) -> None:
        pass


def test_a_failed_export_undoes_the_import(
    engine_ctx: EngineContext, lib: dict[str, int], tmp_path: Path
) -> None:
    options, _, _ = trip(engine_ctx, lib, tmp_path)
    before = dump(engine_ctx)

    def export(db: Any, p: ExportOptions, job: Any) -> ExportResult:
        if not p.simulate:
            raise OSError("disk full")
        return ExportResult(
            target="traktor", simulated=True, path="", tracks=0, cues=0, playlists=0,
            skipped=0, warnings=[], backup_path=None,
        )  # fmt: skip

    with pytest.raises(OSError):
        convert.apply(
            engine_ctx.db,
            engine_ctx.library(),
            ConvertOptions.model_validate(options),
            export,
            _Job(),  # type: ignore[arg-type]
        )
    assert diff(dump(engine_ctx), before) == []
    assert import_service.history(engine_ctx.db).batches[0].undone_at is not None


def test_the_two_programs_must_differ(engine_ctx: EngineContext) -> None:
    with pytest.raises(Exception, match="different"):
        call(engine_ctx, "convert.plan", {"source": "traktor", "target": "traktor"})


def test_each_target_loses_what_it_cannot_store(
    engine_ctx: EngineContext, lib: dict[str, int]
) -> None:
    conn = engine_ctx.db.conn
    bloom = lib["bloom"]
    conn.execute("UPDATE cues SET color = '#FF0000' WHERE track_id = ?", (bloom,))
    ids = [r[0] for r in conn.execute("SELECT id FROM tracks")]
    applied = import_service.Applied(ids, None)

    def codes(target: Any) -> set[str]:
        return {loss.code for loss in convert.losses(engine_ctx.db, target, applied, 0)}

    assert "cue_colors" in codes("traktor") and "cue_colors" in codes("virtualdj")
    assert "cue_colors" not in codes("rekordbox") | codes("engine_dj")
    serato = codes("serato")
    assert {"cue_colors_palette", "beatgrid", "key_bpm_tags"} <= serato
    assert "not_in_tonalia" in {
        loss.code for loss in convert.losses(engine_ctx.db, "rekordbox", applied, 3)
    }
