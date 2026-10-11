"""rekordbox.xml export (SPEC 2.12): collection, beatgrid, hot cues, keys, playlists."""

import json
import xml.etree.ElementTree as ET
from pathlib import Path, PureWindowsPath
from typing import Any

import pytest

from tests.test_analysis_queue import call, wait_job
from tonalia_engine.export.rekordbox_xml import location
from tonalia_engine.server import EngineContext

BPM = 124.0
BAR = 240.0 / BPM


def add_track(ctx: EngineContext, path: Path, *, create: bool = True, **fields: Any) -> int:
    if create:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"\x00" * 64)
    conn = ctx.db.conn
    title = fields.get("title")
    cur = conn.execute(
        "INSERT INTO tracks (path, title, artist, album, genre, year, duration, bitrate,"
        " sample_rate, size, format, status, display_title, search_text, added_at)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', '2026-10-01T10:00:00.000Z')",
        (
            str(path), title, fields.get("artist"), fields.get("album"), fields.get("genre"),
            fields.get("year"), fields.get("duration", 300.4), fields.get("bitrate", 320),
            44100, 64, path.suffix.lstrip(".").lower(), fields.get("status", "ready"),
            title or path.stem,
        ),
    )  # fmt: skip
    tid = int(cur.lastrowid or 0)
    if "key" in fields:
        conn.execute(
            "INSERT INTO analysis (track_id, key_root, key_mode, bpm, energy, beat_grid)"
            " VALUES (?, ?, ?, ?, ?, ?)",
            (
                tid,
                fields["key"][0],
                fields["key"][1],
                fields.get("bpm", BPM),
                fields.get("energy", 7),
                json.dumps(fields["grid"]) if fields.get("grid") else None,
            ),
        )
    for slot, pos, label, color, source in fields.get("cues", []):
        conn.execute(
            "INSERT INTO cues (track_id, slot, position_sec, label, color, source)"
            " VALUES (?, ?, ?, ?, ?, ?)",
            (tid, slot, pos, label, color, source),
        )
    return tid


@pytest.fixture
def library(engine_ctx: EngineContext, tmp_path: Path) -> dict[str, int]:
    music = tmp_path / "Música ñ" / "🎧 Mix"
    ids = {
        "bloom": add_track(
            engine_ctx,
            music / "01 Midnight Bloom.mp3",
            title="Midnight Bloom",
            artist="Lumen Drift",
            album="Noches",
            genre="Melodic House",
            year=2024,
            key=(9, "minor"),
            energy=7,
            grid={"kind": "constant", "bpm": BPM, "first_downbeat": 0.25, "beats": None},
            cues=[
                (0, 0.25, "intro", "#4CC3FF", "auto"),
                (1, 0.25 + 16 * BAR, "drop", "#FF5F8A", "auto"),
                (3, 0.25 + 32 * BAR, "Vocal in", "#FFB547", "user"),
            ],
        ),
        "neon": add_track(
            engine_ctx,
            music / "Neon & Cathedral.flac",
            title="Neon & <Cathedral>",
            artist="Kairo",
            key=(0, "major"),
            bpm=126.0,
            energy=8,
            grid={
                "kind": "variable",
                "bpm": 126.0,
                "first_downbeat": 0.5,
                "beats": [0.5 + i * 0.5 for i in range(8)] + [4.5 + i * 0.4 for i in range(8)],
            },
        ),
        "ogg": add_track(engine_ctx, music / "Vorbis.ogg", title="Vorbis", key=(4, "minor")),
        "pending": add_track(
            engine_ctx, music / "Falta.wav", create=False, title="Falta", status="pending"
        ),
    }
    conn = engine_ctx.db.conn
    insert = "INSERT INTO playlists (id, parent_id, name, emoji, is_folder, sort_order) "
    conn.execute(insert + "VALUES (1, NULL, 'Bolos', '📁', 1, 0)")
    conn.execute(insert + "VALUES (2, 1, 'Warm-up', '🌅', 0, 0)")
    conn.execute(
        "INSERT INTO playlists (id, name, sort_order, smart_query) VALUES (3, 'Alta', 1, ?)",
        ('{"energyMin": 8}',),
    )
    conn.executemany(
        "INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (2, ?, ?)",
        [(ids["neon"], 0), (ids["bloom"], 1)],
    )
    return ids


def export(ctx: EngineContext, **options: Any) -> dict[str, Any]:
    job = call(ctx, "export.rekordbox", options)
    finished = wait_job(ctx, job["jobId"])
    assert finished["status"] == "done", finished
    result: dict[str, Any] = finished["result"]
    return result


def by_name(root: ET.Element) -> dict[str, ET.Element]:
    return {t.get("Name", ""): t for t in root.iter("TRACK") if t.get("Name")}


def test_simulation_reports_without_writing(
    engine_ctx: EngineContext, library: dict[str, int], tmp_path: Path
) -> None:
    out = tmp_path / "salida" / "rekordbox.xml"
    out.parent.mkdir()
    result = export(engine_ctx, path=str(out))
    assert result["simulated"] is True
    assert not out.exists()
    assert (result["tracks"], result["cues"], result["playlists"], result["skipped"]) == (
        3,
        3,
        2,
        1,
    )
    warnings = {(w["code"], w["trackId"]) for w in result["warnings"]}
    assert ("unsupported_format", library["ogg"]) in warnings
    assert ("missing_file", library["pending"]) in warnings
    assert ("not_analyzed", library["pending"]) in warnings
    assert result["backupPath"] is None


def test_collection_tracks_beatgrid_and_hot_cues(
    engine_ctx: EngineContext, library: dict[str, int], tmp_path: Path
) -> None:
    out = tmp_path / "rekordbox.xml"
    result = export(engine_ctx, path=str(out), simulate=False)
    assert result["simulated"] is False and result["path"] == str(out)
    root = ET.parse(out).getroot()
    assert root.tag == "DJ_PLAYLISTS" and root.get("Version") == "1.0.0"
    assert root.find("PRODUCT").get("Name") == "Tonalia"  # type: ignore[union-attr]
    collection = root.find("COLLECTION")
    assert collection is not None and collection.get("Entries") == "3"

    bloom = by_name(collection)["Midnight Bloom"]
    path = tmp_path / "Música ñ" / "🎧 Mix" / "01 Midnight Bloom.mp3"
    assert bloom.get("Location") == "file://localhost" + (
        str(path).replace(" ", "%20").replace("ú", "%C3%BA").replace("ñ", "%C3%B1")
        .replace("🎧", "%F0%9F%8E%A7")
    )  # fmt: skip
    assert {k: bloom.get(k) for k in ("Artist", "Album", "Genre", "Year", "Kind")} == {
        "Artist": "Lumen Drift",
        "Album": "Noches",
        "Genre": "Melodic House",
        "Year": "2024",
        "Kind": "MP3 File",
    }
    assert bloom.get("AverageBpm") == "124.00"
    assert bloom.get("TotalTime") == "300"
    assert bloom.get("Tonality") == "Am"
    assert bloom.get("DateAdded") == "2026-10-01"
    assert bloom.get("TrackID") == str(library["bloom"])

    tempo = bloom.findall("TEMPO")
    assert [t.attrib for t in tempo] == [
        {"Inizio": "0.250", "Bpm": "124.00", "Metro": "4/4", "Battito": "1"}
    ]
    marks = [m.attrib for m in bloom.findall("POSITION_MARK")]
    assert marks == [
        {"Name": "Intro", "Type": "0", "Start": "0.250", "Num": "0",
         "Red": "76", "Green": "195", "Blue": "255"},
        {"Name": "Drop", "Type": "0", "Start": f"{0.25 + 16 * BAR:.3f}", "Num": "1",
         "Red": "255", "Green": "95", "Blue": "138"},
        {"Name": "Vocal in", "Type": "0", "Start": f"{0.25 + 32 * BAR:.3f}", "Num": "3",
         "Red": "255", "Green": "181", "Blue": "71"},
    ]  # fmt: skip

    neon = by_name(collection)["Neon & <Cathedral>"]
    assert neon.get("Kind") == "FLAC File" and neon.get("Tonality") == "C"
    # Variable tempo: one TEMPO per bar with the bar's own tempo.
    tempos = [(t.get("Inizio"), t.get("Bpm")) for t in neon.findall("TEMPO")]
    assert tempos[:2] == [("0.500", "120.00"), ("2.500", "120.00")]
    assert tempos[2] == ("4.500", "150.00")
    assert all(t.get("Battito") == "1" for t in neon.findall("TEMPO"))

    pending = by_name(collection)["Falta"]
    assert pending.find("TEMPO") is None and pending.get("Tonality") is None
    assert "Vorbis" not in by_name(collection)


def test_playlists_folders_and_smart_playlists(
    engine_ctx: EngineContext, library: dict[str, int], tmp_path: Path
) -> None:
    out = tmp_path / "rekordbox.xml"
    export(engine_ctx, path=str(out), simulate=False)
    root = ET.parse(out).getroot()
    rootnode = root.find("PLAYLISTS/NODE")
    assert rootnode is not None
    assert (rootnode.get("Type"), rootnode.get("Name"), rootnode.get("Count")) == (
        "0",
        "ROOT",
        "2",
    )
    folder, smart = list(rootnode)
    assert (folder.get("Type"), folder.get("Name"), folder.get("Count")) == ("0", "📁 Bolos", "1")
    warm = folder[0]
    assert warm.attrib == {"Name": "🌅 Warm-up", "Type": "1", "KeyType": "0", "Entries": "2"}
    assert [t.get("Key") for t in warm] == [str(library["neon"]), str(library["bloom"])]
    # Smart playlists are written with their current matches.
    assert smart.get("Name") == "Alta" and [t.get("Key") for t in smart] == [str(library["neon"])]


def test_options_language_and_memory_cues(
    engine_ctx: EngineContext, library: dict[str, int], tmp_path: Path
) -> None:
    out = tmp_path / "r.xml"
    export(engine_ctx, path=str(out), simulate=False, language="es", memoryCues=True,
           notation="alphanumeric")  # fmt: skip
    bloom = by_name(ET.parse(out).getroot().find("COLLECTION"))["Midnight Bloom"]  # type: ignore[arg-type]
    assert bloom.get("Tonality") == "8A"
    marks = bloom.findall("POSITION_MARK")
    assert [m.get("Num") for m in marks] == ["0", "1", "3", "-1", "-1", "-1"]
    assert marks[0].get("Name") == "Intro" and marks[3].get("Red") is None

    export(engine_ctx, path=str(out), simulate=False, cues=False, beatgrid=False, key=False)
    bloom = by_name(ET.parse(out).getroot().find("COLLECTION"))["Midnight Bloom"]  # type: ignore[arg-type]
    assert bloom.find("POSITION_MARK") is None and bloom.find("TEMPO") is None
    assert bloom.get("Tonality") is None

    export(engine_ctx, path=str(out), simulate=False, colors=False)
    bloom = by_name(ET.parse(out).getroot().find("COLLECTION"))["Midnight Bloom"]  # type: ignore[arg-type]
    assert all(m.get("Red") is None for m in bloom.findall("POSITION_MARK"))


def test_selection_backup_and_default_path(
    engine_ctx: EngineContext, library: dict[str, int], tmp_path: Path
) -> None:
    out = tmp_path / "rekordbox.xml"
    first = export(engine_ctx, path=str(out), simulate=False, trackIds=[library["bloom"]],
                   includePlaylists=False)  # fmt: skip
    assert first["tracks"] == 1 and first["playlists"] == 0
    old = out.read_bytes()
    # With playlists, their tracks join the selection.
    second = export(engine_ctx, path=str(out), simulate=False, trackIds=[library["bloom"]])
    assert second["tracks"] == 2
    assert second["backupPath"] is not None
    assert Path(second["backupPath"]).read_bytes() == old

    default = export(engine_ctx, simulate=False, includePlaylists=False)
    assert Path(default["path"]) == engine_ctx.data_dir / "exports" / "rekordbox.xml"
    assert Path(default["path"]).exists()


def test_location_on_windows_paths() -> None:
    assert (
        location(PureWindowsPath("C:\\Música\\DJ Edits\\a b#1.mp3"))
        == "file://localhost/C:/M%C3%BAsica/DJ%20Edits/a%20b%231.mp3"
    )


def test_third_and_later_drops_are_numbered() -> None:
    from tonalia_engine.export.common import cue_name

    assert [cue_name("drop2", "auto", "en", n) for n in (2, 3, 4)] == ["Drop 2", "Drop 3", "Drop 4"]
    assert cue_name("build2", "auto", "es", 3) == "3.º build"
    assert cue_name("drop2", "user", "en", 5) == "drop2"
