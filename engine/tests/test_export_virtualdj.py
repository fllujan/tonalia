"""VirtualDJ database.xml export (SPEC 2.12): Poi cues, beatgrid and key, merged safely."""

import os
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

import pytest

from tests.test_analysis_queue import call, wait_job
from tests.test_export_rekordbox import BAR, library
from tonalia_engine.export import virtualdj
from tonalia_engine.export.virtualdj import find_database, list_file_names
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
    assert result["playlists"] == 2  # "Warm-up" (inside the "Bolos" folder) and "Alta"
    assert database.read_bytes() == before
    assert not (database.parent / "MyLists").exists()


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


def assert_virtualdj_layout(raw: bytes) -> list[str]:
    """VirtualDJ reads its database line by line and resets one written any other way (it
    reports it as corrupt): one element per line, one space of indent per level, CRLF."""
    text = raw.decode("utf-8")
    assert "\n" not in text.replace("\r\n", ""), "bare LF or CR"
    lines = text.split("\r\n")
    assert lines[0] == '<?xml version="1.0" encoding="UTF-8"?>'
    assert lines[1].startswith("<VirtualDJ_Database ") and lines[-2] == "</VirtualDJ_Database>"
    assert lines[-1] == ""  # ends with CRLF
    for line in lines[2:-2]:
        inline = "</" in line and not line.lstrip().startswith("</")  # <Comment>text</Comment>
        assert line.count("<") == (2 if inline else 1), line
        if line.startswith("  "):
            assert line.startswith("  <") and not line.startswith("   "), line
        else:
            assert line.startswith((" <Song ", " </Song>")), line
    return lines


def test_writes_the_database_the_way_virtualdj_does(
    engine_ctx: EngineContext, library: dict[str, int], database: Path
) -> None:
    # A real database: CRLF, a comment with text, quotes and apostrophes in attributes.
    database.write_bytes(
        database.read_text(encoding="utf-8")
        .replace('Title="Midnight Bloom"', 'Title="Midnight Bloom (DJ&apos;s &quot;Edit&quot;)"')
        .replace('  <Poi Name="Cue 1"', '  <Comment>Clean</Comment>\n  <Poi Name="Cue 1"')
        .replace("\n", "\r\n")
        .encode("utf-8")
    )
    finished = export(engine_ctx, path=str(database), simulate=False, language="es")
    assert finished["status"] == "done", finished
    lines = assert_virtualdj_layout(database.read_bytes())
    assert lines[1] == '<VirtualDJ_Database Version="8.1">'
    assert "  <Comment>Clean</Comment>" in lines
    assert any("DJ&apos;s &quot;Edit&quot;" in line for line in lines)
    assert any("Neon &amp; &lt;Cathedral&gt;" in line for line in lines)
    found = songs(database)
    assert found["otro.mp3"].find("Comment").text == "Clean"  # type: ignore[union-attr]
    assert len(found) == 5  # the 4 exported tracks and VirtualDJ's own


def test_an_empty_database_gets_virtualdj_layout(
    engine_ctx: EngineContext, library: dict[str, int], database: Path
) -> None:
    # What VirtualDJ leaves after resetting a database it could not read.
    database.write_bytes(
        b'<?xml version="1.0" encoding="UTF-8"?>\r\n<VirtualDJ_Database Version="2026">\r\n'
        b"</VirtualDJ_Database>\r\n"
    )
    finished = export(engine_ctx, path=str(database), simulate=False, language="es")
    assert finished["status"] == "done", finished
    lines = assert_virtualdj_layout(database.read_bytes())
    assert lines[1] == '<VirtualDJ_Database Version="2026">'
    assert sum(line.startswith(" <Song ") for line in lines) == 4


def test_reads_the_leftovers_virtualdj_writes_past_its_database(
    engine_ctx: EngineContext, library: dict[str, int], database: Path
) -> None:
    # VirtualDJ saves in place without truncating: a database shorter than the file it
    # overwrites keeps a NUL and the tail of the old one after the closing tag, and the
    # songs it rewrote keep spaces after </Song>. VirtualDJ itself reads this file fine.
    raw = database.read_text(encoding="utf-8").replace("\n", "\r\n")
    raw = raw.replace(" </Song>\r\n", " </Song>      \r\n", 1)
    database.write_bytes(
        raw.encode() + b'\x00="6" Type="cue" />\r\n </Song>\r\n</VirtualDJ_Database>\r\n'
    )
    finished = export(engine_ctx, path=str(database), simulate=False, language="es")
    assert finished["status"] == "done", finished
    written = database.read_bytes()
    assert b"\x00" not in written
    lines = assert_virtualdj_layout(written)
    assert lines.count("</VirtualDJ_Database>") == 1
    found = songs(database)
    assert found["otro.mp3"].find("Poi").get("Name") == "Cue 1"  # type: ignore[union-attr]
    assert len(found) == 5


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


# VirtualDJ's own files, as VirtualDJ 8.5 writes them for a list with one song, a folder
# and the "order" of My Lists (captured from a real installation).
VDJ_LIST = (
    b'<?xml version="1.0" encoding="UTF-8"?>\r\n<VirtualFolder noDuplicates="no">\r\n'
    b'\t<song path="/Users/dj/M\xc3\xbasica/a &amp; b.mp3" size="2390064" idx="0" />\r\n'
    b"</VirtualFolder>\r\n"
)
VDJ_FOLDER = b'<?xml version="1.0" encoding="UTF-8"?>\r\n<VirtualFolder />\r\n'


def read_list(path: Path) -> tuple[list[str], ET.Element]:
    raw = path.read_bytes()
    text = raw.decode("utf-8")
    assert "\n" not in text.replace("\r\n", ""), "bare LF or CR"
    lines = text.split("\r\n")
    assert lines[0] == '<?xml version="1.0" encoding="UTF-8"?>'
    assert lines[1] == '<VirtualFolder noDuplicates="no">'
    assert lines[-2:] == ["</VirtualFolder>", ""]
    for line in lines[2:-2]:
        assert line.startswith('\t<song path="') and line.endswith(" />"), line
        # Only what VirtualDJ writes itself: path, size and position.
        assert set(ET.fromstring(line.strip()).attrib) <= {"path", "size", "idx"}, line
    return lines, ET.fromstring(raw)


def order(path: Path) -> list[str]:
    raw = path.read_bytes()
    assert b"\r" not in raw and raw.endswith(b"\n")  # one name per line, LF, as VirtualDJ
    return raw.decode("utf-8").splitlines()


def test_playlists_are_a_tonalia_folder_of_my_lists_in_virtualdj_layout(
    engine_ctx: EngineContext, library: dict[str, int], database: Path
) -> None:
    lists = database.parent / "MyLists"
    lists.mkdir()
    # The DJ's own lists and folder, and the order VirtualDJ keeps for them.
    (lists / "Prueba.vdjfolder").write_bytes(VDJ_LIST)
    (lists / "Carpeta.vdjfolder").write_bytes(VDJ_FOLDER)
    (lists / "Carpeta.subfolders").mkdir()
    (lists / "Carpeta.subfolders" / "order").write_bytes(b"Dentro\n")
    (lists / "Carpeta.subfolders" / "Dentro.vdjfolder").write_bytes(VDJ_LIST)
    (lists / "order").write_bytes(b"Carpeta\nPrueba\n")
    mine = {p: p.read_bytes() for p in lists.rglob("*") if p.is_file()}
    # An earlier Tonalia folder inside it, to be replaced.
    (lists / "Tonalia.subfolders").mkdir()
    (lists / "Tonalia.subfolders" / "Gone.vdjfolder").write_bytes(VDJ_LIST)
    (lists / "Tonalia.vdjfolder").write_bytes(VDJ_FOLDER)

    first = export(engine_ctx, path=str(database), simulate=False)
    assert first["status"] == "done", first
    assert first["result"]["playlists"] == 2
    export(engine_ctx, path=str(database), simulate=False)

    for path, data in mine.items():
        assert path.read_bytes() == (
            b"Carpeta\nPrueba\nTonalia\n" if path.name == "order" and path.parent == lists else data
        ), path
    assert order(lists / "order") == ["Carpeta", "Prueba", "Tonalia"]  # added once
    # A VirtualDJ folder: an empty list plus a ".subfolders" folder with its own order.
    assert (lists / "Tonalia.vdjfolder").read_bytes() == VDJ_FOLDER
    if os.name != "nt":  # readable like VirtualDJ's own lists, not private to Tonalia
        assert (lists / "Tonalia.vdjfolder").stat().st_mode & 0o777 == 0o644
    tonalia = lists / "Tonalia.subfolders"
    assert sorted(p.relative_to(tonalia).as_posix() for p in tonalia.rglob("*")) == [
        "Alta.vdjfolder",
        "order",
        "📁 Bolos.subfolders",
        "📁 Bolos.subfolders/order",
        "📁 Bolos.subfolders/🌅 Warm-up.vdjfolder",
        "📁 Bolos.vdjfolder",
    ]
    assert order(tonalia / "order") == ["📁 Bolos", "Alta"]  # Tonalia's own order
    assert order(tonalia / "📁 Bolos.subfolders" / "order") == ["🌅 Warm-up"]
    assert (tonalia / "📁 Bolos.vdjfolder").read_bytes() == VDJ_FOLDER
    # What the export replaced is in the backups folder, next to the database's copy.
    backups = engine_ctx.data_dir / "backups" / "virtualdj"
    assert any(
        (b / "Tonalia.subfolders" / "Gone.vdjfolder").is_file()
        for b in backups.glob("*-MyLists-Tonalia")
    )

    lines, warm = read_list(tonalia / "📁 Bolos.subfolders" / "🌅 Warm-up.vdjfolder")
    assert len(lines) == 6  # declaration, folder, two songs, closing tag, final CRLF
    assert "Neon &amp; Cathedral.flac" in lines[2]
    songs_in = warm.findall("song")
    assert [Path(s.get("path", "")).name for s in songs_in] == [
        "Neon & Cathedral.flac",
        "01 Midnight Bloom.mp3",
    ]
    assert [s.get("idx") for s in songs_in] == ["0", "1"]
    neon = songs_in[0]
    assert Path(neon.get("path", "")).is_absolute()
    assert neon.get("size") == str(Path(neon.get("path", "")).stat().st_size)
    _, alta = read_list(tonalia / "Alta.vdjfolder")
    # A smart playlist, with what matches it now (energy 8 or more).
    assert [Path(s.get("path", "")).name for s in alta.findall("song")] == ["Neon & Cathedral.flac"]


def test_my_lists_without_an_order_file_and_the_folder_of_version_0_1_2(
    engine_ctx: EngineContext, library: dict[str, int], database: Path
) -> None:
    lists = database.parent / "MyLists"
    lists.mkdir()
    (lists / "Zeta.vdjfolder").write_bytes(VDJ_LIST)
    (lists / "Alfa.vdjfolder").write_bytes(VDJ_LIST)
    # Tonalia 0.1.2 wrote a plain "Tonalia" folder, which keeps VirtualDJ from opening My Lists.
    (lists / "Tonalia").mkdir()
    (lists / "Tonalia" / "Mias.vdjfolder").write_bytes(VDJ_LIST)
    finished = export(engine_ctx, path=str(database), simulate=False)
    assert finished["status"] == "done", finished
    assert not (lists / "Tonalia").exists()
    backups = engine_ctx.data_dir / "backups" / "virtualdj"
    assert any(
        (b / "Tonalia" / "Mias.vdjfolder").is_file() for b in backups.glob("*-MyLists-Tonalia")
    )
    # The DJ's lists keep their place (VirtualDJ's own sorting) and Tonalia goes last.
    assert order(lists / "order") == ["Alfa", "Zeta", "Tonalia"]
    assert (lists / "Tonalia.vdjfolder").is_file() and (lists / "Tonalia.subfolders").is_dir()


def test_one_playlist_or_no_playlists(
    engine_ctx: EngineContext, library: dict[str, int], database: Path
) -> None:
    lists = database.parent / "MyLists" / "Tonalia.subfolders"
    warm = export(engine_ctx, path=str(database), simulate=False, playlistIds=[2])
    assert (warm["result"]["tracks"], warm["result"]["playlists"]) == (2, 1)
    assert sorted(p.name for p in lists.iterdir()) == ["order", "🌅 Warm-up.vdjfolder"]
    none = export(engine_ctx, path=str(database), simulate=False, includePlaylists=False)
    assert none["result"]["playlists"] == 0
    assert sorted(p.name for p in lists.iterdir()) == ["order", "🌅 Warm-up.vdjfolder"]


def test_list_file_names_are_safe_and_unique() -> None:
    assert list_file_names(["Mias", "A/B: C?", "mias", " .. ", "Con\\barra*", "Mias"]) == [
        "Mias",
        "A_B_ C_",
        "mias (2)",
        "Playlist",
        "Con_barra_",
        "Mias (3)",
    ]
    # "order" is VirtualDJ's file in every list folder, and a name may not end in ".subfolders".
    assert list_file_names(["order", "Bolos.subfolders"]) == ["order (2)", "Bolos.subfolders_"]
