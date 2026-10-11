# ruff: noqa: E501  (the NML fixture keeps Traktor's real one-line elements)
"""Traktor collection.nml export (SPEC 2.12): merge into the user's collection safely."""

import xml.etree.ElementTree as ET
from pathlib import Path, PureWindowsPath
from typing import Any

import pytest

from tests.test_analysis_queue import call, wait_job
from tests.test_export_rekordbox import BAR, library
from tonalia_engine.export import traktor_nml
from tonalia_engine.export.traktor_nml import find_collection, nml_location
from tonalia_engine.server import EngineContext

__all__ = ["library"]  # re-exported fixture

VOLUME = "Macintosh HD"


def collection_xml(bloom: Path) -> str:
    vol, folder, name = nml_location(bloom, VOLUME)
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="no" ?>
<NML VERSION="19"><HEAD COMPANY="www.native-instruments.com" PROGRAM="Traktor"></HEAD>
<MUSICFOLDERS></MUSICFOLDERS>
<COLLECTION ENTRIES="2">
<ENTRY MODIFIED_DATE="2024/5/1" TITLE="Midnight Bloom" ARTIST="Lumen Drift">
<LOCATION DIR="{folder}" FILE="{name}" VOLUME="{vol}" VOLUMEID="{vol}"></LOCATION>
<INFO BITRATE="320000" KEY="5A" PLAYCOUNT="7"></INFO>
<TEMPO BPM="123.000000" BPM_QUALITY="100.000000"></TEMPO>
<LOUDNESS PEAK_DB="-0.5" PERCEIVED_DB="0.2" ANALYZED_DB="0.2"></LOUDNESS>
<MUSICAL_KEY VALUE="3"></MUSICAL_KEY>
<CUE_V2 NAME="AutoGrid" DISPL_ORDER="0" TYPE="4" START="80.000000" LEN="0.000000" REPEATS="-1" HOTCUE="-1"></CUE_V2>
<CUE_V2 NAME="Old" DISPL_ORDER="0" TYPE="0" START="9000.000000" LEN="0.000000" REPEATS="-1" HOTCUE="1"></CUE_V2>
<CUE_V2 NAME="My loop" DISPL_ORDER="0" TYPE="5" START="20000.000000" LEN="7741.935484" REPEATS="-1" HOTCUE="4"></CUE_V2>
</ENTRY>
<ENTRY TITLE="Otro tema">
<LOCATION DIR="/:Users/:dj/:Otros/:" FILE="otro.mp3" VOLUME="{VOLUME}" VOLUMEID="{VOLUME}"></LOCATION>
<CUE_V2 NAME="n.n." DISPL_ORDER="0" TYPE="0" START="1000.000000" LEN="0.000000" REPEATS="-1" HOTCUE="0"></CUE_V2>
</ENTRY>
</COLLECTION>
<SETS ENTRIES="0"></SETS>
<PLAYLISTS><NODE TYPE="FOLDER" NAME="$ROOT"><SUBNODES COUNT="2">
<NODE TYPE="PLAYLIST" NAME="Mine"><PLAYLIST ENTRIES="1" TYPE="LIST" UUID="abc">
<ENTRY><PRIMARYKEY TYPE="TRACK" KEY="{VOLUME}/:Users/:dj/:Otros/:otro.mp3"></PRIMARYKEY></ENTRY>
</PLAYLIST></NODE>
<NODE TYPE="FOLDER" NAME="Tonalia"><SUBNODES COUNT="1">
<NODE TYPE="PLAYLIST" NAME="Vieja"><PLAYLIST ENTRIES="0" TYPE="LIST" UUID="old"></PLAYLIST></NODE>
</SUBNODES></NODE>
</SUBNODES></NODE></PLAYLISTS>
<INDEXING></INDEXING>
</NML>
"""


@pytest.fixture
def nml(engine_ctx: EngineContext, library: dict[str, int], tmp_path: Path) -> Path:
    row = engine_ctx.db.conn.execute(
        "SELECT path FROM tracks WHERE id = ?", (library["bloom"],)
    ).fetchone()
    path = tmp_path / "Native Instruments" / "Traktor 4.0.2" / "collection.nml"
    path.parent.mkdir(parents=True)
    path.write_text(collection_xml(Path(row[0])), encoding="utf-8")
    return path


@pytest.fixture(autouse=True)
def traktor_closed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(traktor_nml, "traktor_running", lambda: False)
    monkeypatch.setattr(traktor_nml, "root_volume_name", lambda: VOLUME)


def export(ctx: EngineContext, **options: Any) -> dict[str, Any]:
    job = call(ctx, "export.traktor", options)
    return wait_job(ctx, job["jobId"])


def entries(root: ET.Element) -> dict[str, ET.Element]:
    out = {}
    for e in root.iter("ENTRY"):
        loc = e.find("LOCATION")
        if loc is not None:
            out[loc.get("FILE", "")] = e
    return out


def test_simulation_leaves_the_collection_untouched(
    engine_ctx: EngineContext, library: dict[str, int], nml: Path
) -> None:
    before = nml.read_bytes()
    finished = export(engine_ctx, path=str(nml))
    assert finished["status"] == "done"
    result = finished["result"]
    assert result["simulated"] is True and result["target"] == "traktor"
    assert (result["tracks"], result["cues"], result["playlists"]) == (4, 3, 2)
    assert nml.read_bytes() == before


def test_merges_tempo_key_grid_and_hot_cues(
    engine_ctx: EngineContext, library: dict[str, int], nml: Path
) -> None:
    finished = export(engine_ctx, path=str(nml), simulate=False, notation="open_key")
    assert finished["status"] == "done", finished
    result = finished["result"]
    assert result["backupPath"] is not None
    assert Path(result["backupPath"]).read_text(encoding="utf-8").startswith("<?xml")
    text = nml.read_text(encoding="utf-8")
    assert text.startswith('<?xml version="1.0" encoding="UTF-8" standalone="no" ?>')
    root = ET.fromstring(text)
    found = entries(root)

    bloom = found["01 Midnight Bloom.mp3"]
    assert bloom.find("TEMPO").get("BPM") == "124.000000"  # type: ignore[union-attr]
    assert bloom.find("MUSICAL_KEY").get("VALUE") == "21"  # Am  # type: ignore[union-attr]
    info = bloom.find("INFO")
    assert info is not None and info.get("KEY") == "1m" and info.get("PLAYCOUNT") == "7"
    assert bloom.find("LOUDNESS") is not None  # Traktor's own data is kept
    cues = [c.attrib for c in bloom.findall("CUE_V2")]
    grids = [c for c in cues if c["TYPE"] == "4"]
    assert grids == [
        {"NAME": "AutoGrid", "DISPL_ORDER": "0", "TYPE": "4", "START": "250.000000",
         "LEN": "0.000000", "REPEATS": "-1", "HOTCUE": "-1"}
    ]  # fmt: skip
    hot = {c["HOTCUE"]: (c["NAME"], c["TYPE"], c["START"]) for c in cues if c["TYPE"] != "4"}
    assert hot == {
        "0": ("Intro", "0", "250.000000"),
        "1": ("Drop", "0", f"{(0.25 + 16 * BAR) * 1000:.6f}"),
        "3": ("Vocal in", "0", f"{(0.25 + 32 * BAR) * 1000:.6f}"),
        "4": ("My loop", "5", "20000.000000"),  # a slot Tonalia does not use: kept
    }

    # Tracks missing from the collection are added with their location.
    neon = found["Neon & Cathedral.flac"]
    assert neon.get("TITLE") == "Neon & <Cathedral>"
    loc = neon.find("LOCATION")
    assert loc is not None and loc.get("VOLUME") == VOLUME
    assert loc.get("DIR", "").endswith("/:Música ñ/:🎧 Mix/:")
    assert neon.find("MUSICAL_KEY").get("VALUE") == "0"  # C major  # type: ignore[union-attr]
    assert "Vorbis.ogg" in found  # Traktor plays OGG
    # Untouched entries stay as they were; the entry count follows.
    assert found["otro.mp3"].find("CUE_V2").get("NAME") == "n.n."  # type: ignore[union-attr]
    assert root.find("COLLECTION").get("ENTRIES") == str(len(found))  # type: ignore[union-attr]


def test_playlists_go_into_a_tonalia_folder_replaced_on_each_export(
    engine_ctx: EngineContext, library: dict[str, int], nml: Path
) -> None:
    export(engine_ctx, path=str(nml), simulate=False)
    export(engine_ctx, path=str(nml), simulate=False)
    root = ET.parse(nml).getroot()
    top = root.find("PLAYLISTS/NODE/SUBNODES")
    assert top is not None
    names = [n.get("NAME") for n in top.findall("NODE")]
    assert names == ["Mine", "Tonalia"]
    assert top.get("COUNT") == "2"
    tonalia = top.findall("NODE")[1]
    sub = tonalia.find("SUBNODES")
    assert sub is not None
    assert [n.get("NAME") for n in sub.findall("NODE")] == ["📁 Bolos", "Alta"]
    warm = sub.find("NODE/SUBNODES/NODE")
    assert warm is not None and warm.get("NAME") == "🌅 Warm-up"
    playlist = warm.find("PLAYLIST")
    assert playlist is not None and playlist.get("ENTRIES") == "2"
    keys = [k.get("KEY") for k in playlist.iter("PRIMARYKEY")]
    assert keys[0] is not None and keys[0].startswith(VOLUME + "/:")
    assert keys[0].endswith("/:Neon & Cathedral.flac")
    assert playlist.get("UUID")


def test_refuses_to_write_while_traktor_is_open(
    engine_ctx: EngineContext, library: dict[str, int], nml: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(traktor_nml, "traktor_running", lambda: True)
    before = nml.read_bytes()
    failed = export(engine_ctx, path=str(nml), simulate=False)
    assert failed["status"] == "failed" and "Traktor" in failed["error"]
    assert nml.read_bytes() == before
    simulated = export(engine_ctx, path=str(nml))
    assert ("app_running", None) in {
        (w["code"], w["trackId"]) for w in simulated["result"]["warnings"]
    }


def test_status_and_collection_discovery(tmp_path: Path, engine_ctx: EngineContext) -> None:
    home = tmp_path / "home"
    for version in ("Traktor 3.11.1", "Traktor 4.0.2", "Traktor 4.0.10"):
        folder = home / "Documents" / "Native Instruments" / version
        folder.mkdir(parents=True)
        (folder / "collection.nml").write_text("<NML/>", encoding="utf-8")
    (home / "Documents" / "Native Instruments" / "Traktor 5.0.0").mkdir()  # no collection
    found = find_collection(home)
    assert found == home / "Documents" / "Native Instruments" / "Traktor 4.0.10" / "collection.nml"
    assert find_collection(tmp_path / "nadie") is None
    status = call(engine_ctx, "export.traktorStatus")
    assert set(status) == {"collectionPath", "running"} and status["running"] is False


def test_missing_collection_is_an_error(engine_ctx: EngineContext, tmp_path: Path) -> None:
    failed = export(engine_ctx, path=str(tmp_path / "no-hay.nml"), simulate=False)
    assert failed["status"] == "failed"


def test_nml_locations() -> None:
    assert nml_location(Path("/Users/dj/Música/a b.mp3"), "Macintosh HD") == (
        "Macintosh HD",
        "/:Users/:dj/:Música/:",
        "a b.mp3",
    )
    assert nml_location(Path("/Volumes/USB 1/Sets/x.mp3"), "Macintosh HD") == (
        "USB 1",
        "/:Sets/:",
        "x.mp3",
    )
    assert nml_location(PureWindowsPath("D:\\Música\\x.flac"), "") == ("D:", "/:Música/:", "x.flac")


def test_hostile_xml_is_rejected_untouched(engine_ctx: EngineContext, tmp_path: Path) -> None:
    hostile = tmp_path / "collection.nml"
    hostile.write_text(
        '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]>'
        "<NML><COLLECTION>&e;</COLLECTION></NML>",
        encoding="utf-8",
    )
    before = hostile.read_bytes()
    failed = export(engine_ctx, path=str(hostile), simulate=False)
    assert failed["status"] == "failed"
    assert hostile.read_bytes() == before


def test_results_tell_updated_from_added(
    engine_ctx: EngineContext, library: dict[str, int], nml: Path
) -> None:
    items = {i["title"]: i["action"] for i in export(engine_ctx, path=str(nml))["result"]["items"]}
    assert items["Midnight Bloom"] == "updated" and items["Neon & <Cathedral>"] == "added"
