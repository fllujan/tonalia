"""VirtualDJ database.xml export (SPEC 2.12): Poi cues, beatgrid and key, merged safely."""

import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

import pytest

from tests.test_analysis_queue import call, wait_job
from tests.test_export_rekordbox import BAR, library
from tonalia_engine.export import virtualdj
from tonalia_engine.export.virtualdj import find_database
from tonalia_engine.server import EngineContext

__all__ = ["library"]


def database_xml(bloom: Path) -> str:
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<VirtualDJ_Database Version="8.1">
 <Song FilePath="{bloom}" FileSize="64">
  <Tags Author="Lumen Drift" Title="Midnight Bloom" Stars="4" Flag="1" />
  <Infos SongLength="300.4" PlayCount="12" FirstSeen="1700000000" />
  <Scan Version="801" Flag="32768" Volume="0.9" Bpm="0.500000" AltBpm="1.0" Key="Dm" />
  <Poi Pos="0.100000" Type="beatgrid" />
  <Poi Name="Old" Pos="9.000000" Num="2" Type="cue" />
  <Poi Name="Mine" Pos="20.000000" Num="5" Type="cue" />
  <Poi Pos="200.000000" Type="automix" Point="realEnd" />
 </Song>
 <Song FilePath="/Users/dj/Otros/otro.mp3" FileSize="10">
  <Poi Name="Cue 1" Pos="1.000000" Num="1" Type="cue" />
 </Song>
</VirtualDJ_Database>
"""


@pytest.fixture
def database(engine_ctx: EngineContext, library: dict[str, int], tmp_path: Path) -> Path:
    row = engine_ctx.db.conn.execute(
        "SELECT path FROM tracks WHERE id = ?", (library["bloom"],)
    ).fetchone()
    path = tmp_path / "VirtualDJ" / "database.xml"
    path.parent.mkdir()
    path.write_text(database_xml(Path(row[0])), encoding="utf-8")
    return path


@pytest.fixture(autouse=True)
def virtualdj_closed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(virtualdj, "virtualdj_running", lambda: False)


def export(ctx: EngineContext, **options: Any) -> dict[str, Any]:
    return wait_job(ctx, call(ctx, "export.virtualdj", options)["jobId"])


def songs(path: Path) -> dict[str, ET.Element]:
    return {Path(s.get("FilePath", "")).name: s for s in ET.parse(path).getroot().iter("Song")}


def test_simulation_changes_nothing(
    engine_ctx: EngineContext, library: dict[str, int], database: Path
) -> None:
    before = database.read_bytes()
    finished = export(engine_ctx, path=str(database))
    assert finished["status"] == "done"
    result = finished["result"]
    assert (result["target"], result["simulated"], result["tracks"], result["cues"]) == (
        "virtualdj",
        True,
        4,
        3,
    )
    assert result["playlists"] == 0
    assert database.read_bytes() == before


def test_merges_scan_key_beatgrid_and_cues(
    engine_ctx: EngineContext, library: dict[str, int], database: Path
) -> None:
    finished = export(engine_ctx, path=str(database), simulate=False, language="es")
    assert finished["status"] == "done", finished
    assert finished["result"]["backupPath"]
    text = database.read_text(encoding="utf-8")
    assert text.startswith('<?xml version="1.0" encoding="UTF-8"?>')
    found = songs(database)

    bloom = found["01 Midnight Bloom.mp3"]
    scan = bloom.find("Scan")
    assert scan is not None
    assert scan.get("Bpm") == f"{60 / 124:.6f}" and scan.get("Key") == "Am"
    assert scan.get("Volume") == "0.9" and scan.get("Version") == "801"  # VirtualDJ's own data kept
    assert bloom.find("Tags").get("Stars") == "4"  # type: ignore[union-attr]
    assert bloom.find("Infos").get("PlayCount") == "12"  # type: ignore[union-attr]
    pois = [p.attrib for p in bloom.findall("Poi")]
    assert [p for p in pois if p["Type"] == "beatgrid"] == [{"Pos": "0.250000", "Type": "beatgrid"}]
    cues = {p["Num"]: (p["Name"], p["Pos"]) for p in pois if p["Type"] == "cue"}
    assert cues == {
        "1": ("Intro", "0.250000"),
        "2": ("Drop", f"{0.25 + 16 * BAR:.6f}"),
        "4": ("Vocal in", f"{0.25 + 32 * BAR:.6f}"),
        "5": ("Mine", "20.000000"),  # slot 5 (Num 5) is not exported: kept
    }
    assert any(p["Type"] == "automix" for p in pois)

    neon = found["Neon & Cathedral.flac"]
    assert neon.find("Tags").get("Title") == "Neon & <Cathedral>"  # type: ignore[union-attr]
    assert neon.find("Scan").get("Key") == "C"  # type: ignore[union-attr]
    assert found["otro.mp3"].find("Poi").get("Name") == "Cue 1"  # type: ignore[union-attr]


def test_refuses_while_virtualdj_is_open(
    engine_ctx: EngineContext,
    library: dict[str, int],
    database: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(virtualdj, "virtualdj_running", lambda: True)
    before = database.read_bytes()
    failed = export(engine_ctx, path=str(database), simulate=False)
    assert failed["status"] == "failed" and "VirtualDJ" in failed["error"]
    assert database.read_bytes() == before
    warned = export(engine_ctx, path=str(database))
    assert "app_running" in {w["code"] for w in warned["result"]["warnings"]}


def test_database_discovery_and_status(tmp_path: Path, engine_ctx: EngineContext) -> None:
    assert find_database(tmp_path) is None
    docs = tmp_path / "Documents" / "VirtualDJ" / "database.xml"
    docs.parent.mkdir(parents=True)
    docs.write_text("<VirtualDJ_Database/>", encoding="utf-8")
    assert find_database(tmp_path) == docs
    support = tmp_path / "Library" / "Application Support" / "VirtualDJ" / "database.xml"
    support.parent.mkdir(parents=True)
    support.write_text("<VirtualDJ_Database/>", encoding="utf-8")
    assert find_database(tmp_path) == support
    status = call(engine_ctx, "export.virtualdjStatus")
    assert set(status) == {"collectionPath", "running"}
