# ruff: noqa: E501  (the collection fixtures keep each program's one-line elements)
"""Import from DJ programs (SPEC 13.1): readers, matching, policy, apply and undo.

Every collection here is written by hand from each program's documented layout; none
comes from Tonalia's own exporters, so a reader cannot simply mirror a writer's mistake.
"""

from __future__ import annotations

import json
import shutil
import sqlite3
import struct
import time
from pathlib import Path, PureWindowsPath
from typing import Any
from urllib.parse import quote
from xml.sax.saxutils import quoteattr

import pytest
from mutagen.id3 import GEOB, ID3

from tests.fixtures.generate import make_all
from tests.test_analysis_queue import call, wait_job
from tests.test_export_engine_dj import make_library
from tests.test_export_rekordbox import BAR, add_track, library
from tonalia_engine.export import serato_markers as sm
from tonalia_engine.export.engine_dj import _append_list
from tonalia_engine.export.traktor_nml import nml_location
from tonalia_engine.import_ import engine_dj as engine_reader
from tonalia_engine.import_ import rekordbox as rb_reader
from tonalia_engine.import_ import serato as serato_reader
from tonalia_engine.import_ import service
from tonalia_engine.import_ import traktor as traktor_reader
from tonalia_engine.import_ import virtualdj as vdj_reader
from tonalia_engine.import_.model import ImportedCue
from tonalia_engine.keys import Key
from tonalia_engine.rpc_schema import PathMap
from tonalia_engine.server import EngineContext

__all__ = ["library"]

VOLUME = "Macintosh HD"
TABLES = {
    "tracks": "id", "analysis": "track_id", "cues": "id", "segments": "id", "markers": "id",
    "playlists": "id", "playlist_tracks": "playlist_id, position",
}  # fmt: skip


@pytest.fixture(autouse=True)
def programs_closed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(service, "running", lambda source: False)
    monkeypatch.setattr(traktor_reader, "root_volume_name", lambda: VOLUME)


@pytest.fixture
def lib(engine_ctx: EngineContext, library: dict[str, int]) -> dict[str, int]:
    """The export tests' library, with the sections an analysed track has."""
    conn = engine_ctx.db.conn
    conn.executemany(
        "INSERT INTO segments (track_id, start_sec, end_sec, label) VALUES (?, ?, ?, ?)",
        [
            (library["bloom"], 0.25, 0.25 + 16 * BAR, "intro"),
            (library["bloom"], 0.25 + 16 * BAR, 0.25 + 48 * BAR, "drop"),
            (library["bloom"], 0.25 + 48 * BAR, 300.0, "outro"),
        ],
    )
    return library


def path_of(ctx: EngineContext, tid: int) -> Path:
    return Path(ctx.db.conn.execute("SELECT path FROM tracks WHERE id = ?", (tid,)).fetchone()[0])


def diff(a: dict[str, list[tuple[Any, ...]]], b: dict[str, list[tuple[Any, ...]]]) -> list[Any]:
    return [
        (t, [(i, u, v) for i, (u, v) in enumerate(zip(x, y, strict=False)) if u != v])
        for t in a
        for x, y in zip(a[t], b[t], strict=False)
        if x != y
    ] + [(t, len(a[t]), len(b[t])) for t in a if len(a[t]) != len(b[t])]


def dump(ctx: EngineContext) -> dict[str, list[tuple[Any, ...]]]:
    return {
        table: [tuple(r) for r in ctx.db.conn.execute(f"SELECT * FROM {table} ORDER BY {order}")]
        for table, order in TABLES.items()
    }


def run_import(ctx: EngineContext, method: str, **options: Any) -> dict[str, Any]:
    finished = wait_job(ctx, call(ctx, method, options)["jobId"])
    assert finished["status"] == "done", finished
    result: dict[str, Any] = finished["result"]
    return result


def cues_of(ctx: EngineContext, tid: int) -> dict[int, tuple[Any, ...]]:
    return {
        r[0]: tuple(r[1:])
        for r in ctx.db.conn.execute(
            "SELECT slot, round(position_sec, 3), label, color, source FROM cues WHERE track_id = ?",
            (tid,),
        )
    }


# ---- the collections, one per program ----


def url(path: Path) -> str:
    return "file://localhost" + quote(
        path.as_posix() if path.as_posix().startswith("/") else "/" + path.as_posix(), safe="/:"
    )


def rekordbox_xml(bloom: Path, neon: Path, new: Path, gone: Path) -> str:
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<DJ_PLAYLISTS Version="1.0.0"><PRODUCT Name="rekordbox" Version="6.8.5" Company="AlphaTheta"/>
<COLLECTION Entries="4">
<TRACK TrackID="11" Name="Midnight Bloom" Artist="Lumen Drift" Size="64" TotalTime="300" AverageBpm="125.00" Tonality="Fm" Rating="204" PlayCount="12" Comments="Peak time" Location="{url(bloom)}">
<TEMPO Inizio="0.300" Bpm="125.00" Metro="4/4" Battito="1"/>
<POSITION_MARK Name="Drop!" Type="0" Start="31.050" Num="1" Red="255" Green="0" Blue="128"/>
<POSITION_MARK Name="Mine" Type="0" Start="70.000" Num="3" Red="0" Green="255" Blue="0"/>
<POSITION_MARK Name="Memo" Type="0" Start="12.000" Num="-1"/>
<POSITION_MARK Name="Loop 4" Type="4" Start="40.000" End="47.680" Num="-1"/>
</TRACK>
<TRACK TrackID="12" Name="Neon" AverageBpm="126.00" Tonality="C" Rating="0" Location="{url(neon)}">
<TEMPO Inizio="0.500" Bpm="120.00" Metro="4/4" Battito="1"/>
<TEMPO Inizio="16.500" Bpm="130.00" Metro="4/4" Battito="1"/>
</TRACK>
<TRACK TrackID="13" Name="Nuevo" Tonality="8A" AverageBpm="122.00" Location="{url(new)}">
<POSITION_MARK Name="Start" Type="0" Start="1.000" Num="0"/>
</TRACK>
<TRACK TrackID="14" Name="Perdido" Location="{url(gone)}"/>
</COLLECTION>
<PLAYLISTS><NODE Type="0" Name="ROOT" Count="3">
<NODE Name="Bolos" Type="0" Count="2">
<NODE Name="Warm-up" Type="1" KeyType="0" Entries="2"><TRACK Key="12"/><TRACK Key="11"/></NODE>
<NODE Name="Por ruta" Type="1" KeyType="1" Entries="1"><TRACK Key="{url(bloom)}"/></NODE>
</NODE>
<NODE Name="Tonalia" Type="0" Count="1"><NODE Name="Viejo" Type="1" KeyType="0" Entries="0"/></NODE>
<NODE Name="Suelta" Type="1" KeyType="0" Entries="1"><TRACK Key="13"/></NODE>
</NODE></PLAYLISTS>
</DJ_PLAYLISTS>
"""


def traktor_nml(bloom: Path, neon: Path) -> str:
    def loc(path: Path) -> str:
        vol, folder, name = nml_location(path, VOLUME)
        return f"<LOCATION DIR={quoteattr(folder)} FILE={quoteattr(name)} VOLUME={quoteattr(vol)} VOLUMEID={quoteattr(vol)}></LOCATION>"

    vol, folder, name = nml_location(bloom, VOLUME)
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="no" ?>
<NML VERSION="19"><HEAD COMPANY="www.native-instruments.com" PROGRAM="Traktor"></HEAD>
<COLLECTION ENTRIES="2">
<ENTRY TITLE="Midnight Bloom" ARTIST="Lumen Drift">{loc(bloom)}
<INFO BITRATE="320000" KEY="4A" PLAYCOUNT="7" RANKING="153" COMMENT="De Traktor"></INFO>
<TEMPO BPM="124.000000" BPM_QUALITY="100.000000"></TEMPO>
<MUSICAL_KEY VALUE="17"></MUSICAL_KEY>
<CUE_V2 NAME="AutoGrid" DISPL_ORDER="0" TYPE="4" START="250.000000" LEN="0.000000" REPEATS="-1" HOTCUE="-1"></CUE_V2>
<CUE_V2 NAME="Build" DISPL_ORDER="0" TYPE="0" START="15730.000000" LEN="0.000000" REPEATS="-1" HOTCUE="2"></CUE_V2>
<CUE_V2 NAME="n.n." DISPL_ORDER="0" TYPE="3" START="500.000000" LEN="0.000000" REPEATS="-1" HOTCUE="-1"></CUE_V2>
<CUE_V2 NAME="Bucle" DISPL_ORDER="0" TYPE="5" START="20000.000000" LEN="7741.935484" REPEATS="-1" HOTCUE="5"></CUE_V2>
</ENTRY>
<ENTRY TITLE="Neon">{loc(neon)}<INFO KEY="8B"></INFO></ENTRY>
</COLLECTION>
<PLAYLISTS><NODE TYPE="FOLDER" NAME="$ROOT"><SUBNODES COUNT="2">
<NODE TYPE="PLAYLIST" NAME="Mía"><PLAYLIST ENTRIES="1" TYPE="LIST" UUID="abc">
<ENTRY><PRIMARYKEY TYPE="TRACK" KEY={quoteattr(vol + folder + name)}></PRIMARYKEY></ENTRY>
</PLAYLIST></NODE>
<NODE TYPE="FOLDER" NAME="Tonalia"><SUBNODES COUNT="0"></SUBNODES></NODE>
</SUBNODES></NODE></PLAYLISTS>
</NML>
"""


def record(tag: bytes, data: bytes) -> bytes:
    return tag + struct.pack(">I", len(data)) + data


def text(value: str) -> bytes:
    return value.encode("utf-16-be")


def serato_library(folder: Path, tracks: list[tuple[Path, str, str]]) -> None:
    """``_Serato_`` with a database V2 and a "Bolos%%Warm" crate (paths without the root)."""
    (folder / "Subcrates").mkdir(parents=True)

    def rel(p: Path) -> str:
        return Path(*p.parts[1:]).as_posix()

    db = record(b"vrsn", text("2.0/Serato Scratch LIVE Database"))
    for path, bpm, key in tracks:
        db += record(
            b"otrk",
            record(b"ttyp", text("mp3")) + record(b"pfil", text(rel(path)))
            + record(b"tsng", text(path.stem)) + record(b"tbpm", text(bpm))
            + record(b"tkey", text(key)),
        )  # fmt: skip
    (folder / "database V2").write_bytes(db)
    crate = record(b"vrsn", text("1.0/Serato ScratchLive Crate"))
    crate += b"".join(record(b"otrk", record(b"ptrk", text(rel(p)))) for p, _, _ in tracks)
    (folder / "Subcrates" / "Bolos.crate").write_bytes(
        record(b"vrsn", text("1.0/Serato ScratchLive Crate"))
    )
    (folder / "Subcrates" / "Bolos%%Warm.crate").write_bytes(crate)
    (folder / "Subcrates" / "Tonalia.crate").write_bytes(crate)


def serato_file(path: Path, source: Path) -> None:
    """A real MP3 with two hot cues, a loop and a one-marker beatgrid, as Serato writes."""
    shutil.copy2(source, path)
    loop = (
        b"\x00\x00" + struct.pack(">II", 40000, 47680) + b"\xff\xff\xff\xff\x00"
        + bytes.fromhex("27AAE1") + b"\x00\x00" + b"Bucle\x00"
    )  # fmt: skip
    entries = [
        sm.Entry("COLOR", b"\x00\xff\xff\xff"),
        sm.CueMarker(1, 31050, "#CC0000", "Drop").entry(),
        sm.CueMarker(4, 60000, "#00CC00", "").entry(),
        sm.Entry("LOOP", loop),
        sm.Entry("BPMLOCK", b"\x00"),
    ]
    sm.write_entries(path, entries)
    tags = ID3(path)
    grid = b"\x01\x00" + struct.pack(">I", 1) + struct.pack(">ff", 0.3, 125.0) + b"\x00"
    tags.add(GEOB(encoding=0, mime="application/octet-stream", desc="Serato BeatGrid", data=grid))
    tags.save(path)


def vdj_database(bloom: Path, neon: Path) -> str:
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<VirtualDJ_Database Version="8.5">
 <Song FilePath={quoteattr(str(bloom))} FileSize="64">
  <Tags Author="Lumen Drift" Title="Midnight Bloom" Stars="3" />
  <Infos SongLength="300.4" PlayCount="9" />
  <Comment>Desde VDJ</Comment>
  <Scan Version="801" Bpm="0.480000" Key="Gm" />
  <Poi Pos="0.290000" Type="beatgrid" />
  <Poi Name="Vocal" Pos="47.000000" Num="3" Type="cue" />
  <Poi Name="Guardado" Pos="5.000000" Type="cue" />
  <Poi Pos="20.000000" Size="16" Type="loop" />
 </Song>
 <Song FilePath={quoteattr(str(neon))} FileSize="64"><Scan Bpm="0.500000" Key="C" /></Song>
</VirtualDJ_Database>
"""


def vdj_lists(folder: Path, paths: list[Path]) -> None:
    lists = folder / "MyLists"
    (lists / "Bolos.subfolders").mkdir(parents=True)
    (lists / "Bolos.vdjfolder").write_text('<?xml version="1.0"?>\r\n<VirtualFolder />\r\n')
    songs = "".join(
        f'\t<song path={quoteattr(str(p))} idx="{i}" />\r\n' for i, p in enumerate(paths)
    )
    (lists / "Bolos.subfolders" / "Warm.vdjfolder").write_text(
        f'<?xml version="1.0" encoding="UTF-8"?>\r\n<VirtualFolder noDuplicates="no">\r\n{songs}</VirtualFolder>\r\n'
    )
    (lists / "Tonalia.vdjfolder").write_text('<?xml version="1.0"?>\r\n<VirtualFolder />\r\n')
    (lists / "order").write_text("Bolos\nTonalia\n")


def engine_library(root: Path, music: Path) -> Path:
    db_path = make_library(root, music, "3.0.2")
    conn = sqlite3.connect(db_path, isolation_level=None)
    folder = _append_list(conn, "Bolos", 0)
    warm = _append_list(conn, "Warm", folder)
    conn.execute(
        "INSERT INTO PlaylistEntity (listId, trackId, databaseUuid, nextEntityId, membershipReference)"
        " VALUES (?, 1, 'x', 0, 0)",
        (warm,),
    )
    _append_list(conn, "Tonalia", 0)
    conn.execute("UPDATE Track SET rating = 80, comment = 'Engine' WHERE id = 1")
    conn.close()
    return db_path


# ---- readers ----


def test_rekordbox_reader(tmp_path: Path) -> None:
    bloom, neon = tmp_path / "Mú sica" / "a b.mp3", tmp_path / "n.flac"
    xml = tmp_path / "rekordbox.xml"
    xml.write_text(rekordbox_xml(bloom, neon, tmp_path / "c.mp3", tmp_path / "d.mp3"))
    out = rb_reader.read(xml)
    first = out.tracks[0]
    assert first.path == str(bloom) and first.key == Key(5, "minor")
    assert first.rating == 4 and first.play_count == 12 and first.comment == "Peak time"
    assert first.grid is not None and first.grid.bpm == 125.0 and first.grid.first_downbeat == 0.3
    assert ImportedCue("hot", 31.05, slot=1, name="Drop!", color="#FF0080") in first.cues
    assert ImportedCue("memory", 12.0, name="Memo") in first.cues
    assert any(c.kind == "loop" and abs((c.length or 0) - 7.68) < 1e-6 for c in first.cues)
    tempo = out.tracks[1].grid
    assert tempo is not None and tempo.anchors and tempo.anchors[0].beat == 32
    assert out.tracks[1].rating is None
    names = [p.name for p in out.playlists]
    assert names == ["Bolos", "Suelta"]  # Tonalia's own folder is not imported back
    warm, by_path = out.playlists[0].children
    assert warm.paths == [str(neon), str(bloom)] and by_path.paths == [str(bloom)]
    assert [w.code for w in out.warnings] == ["own_folder_skipped"]
    assert rb_reader.local_path("file://localhost/C:/M%C3%BAsica/a.mp3") == str(
        PureWindowsPath("C:/Música/a.mp3")
    )


def test_traktor_reader(tmp_path: Path) -> None:
    bloom, neon = tmp_path / "a.mp3", tmp_path / "b.mp3"
    nml = tmp_path / "collection.nml"
    nml.write_text(traktor_nml(bloom, neon))
    out = traktor_reader.read(nml, VOLUME)
    first = out.tracks[0]
    assert first.path == str(bloom)
    assert first.key == Key(5, "minor")  # MUSICAL_KEY wins over the text
    assert first.rating == 3 and first.play_count == 7 and first.comment == "De Traktor"
    assert first.grid is not None and first.grid.first_downbeat == 0.25 and first.grid.bpm == 124
    kinds = sorted((c.kind, c.slot, c.name) for c in first.cues)
    assert kinds == [
        ("hot", 2, "Build"), ("hot", 5, "Bucle"), ("loop", None, "Bucle"), ("memory", None, None),
    ]  # fmt: skip
    assert out.tracks[1].key == Key(0, "major")
    assert [p.name for p in out.playlists] == ["Mía"] and out.playlists[0].paths == [str(bloom)]
    assert traktor_reader.location_path("D:", "/:Música/:", "x.mp3", VOLUME) == str(
        PureWindowsPath("D:/Música/x.mp3")
    )
    assert (
        traktor_reader.location_path("USB", "/:Sets/:", "x.mp3", VOLUME)
        == "/Volumes/USB/Sets/x.mp3"
    )


def test_serato_reader(tmp_path: Path) -> None:
    sources = make_all(tmp_path / "gen")
    music = tmp_path / "Música"
    music.mkdir()
    real = music / "Real ñ.mp3"
    serato_file(real, sources["mp3"])
    folder = tmp_path / "Music" / "_Serato_"
    serato_library(folder, [(real, "125.00", "Fm")])
    out = serato_reader.read(folder)
    (track,) = out.tracks
    assert track.path == str(real) and track.key == Key(5, "minor") and track.bpm == 125.0
    hot = sorted((c.slot, c.position, c.name, c.color) for c in track.cues if c.kind == "hot")
    assert hot == [(1, 31.05, "Drop", "#CC0000"), (4, 60.0, None, "#00CC00")]
    (loop,) = [c for c in track.cues if c.kind == "loop"]
    assert (loop.position, loop.length, loop.name) == (40.0, pytest.approx(7.68), "Bucle")
    assert track.grid is not None and track.grid.bpm == 125.0
    assert track.grid.first_downbeat == pytest.approx(0.3, abs=1e-4)
    (bolos,) = out.playlists
    assert bolos.name == "Bolos" and bolos.is_folder
    assert [(c.name, c.paths) for c in bolos.children] == [("Warm", [str(real)])]
    assert [w.code for w in out.warnings] == ["own_folder_skipped"]


def test_serato_beatgrid_with_tempo_changes() -> None:
    data = (
        b"\x01\x00" + struct.pack(">I", 2) + struct.pack(">fI", 1.0, 32)
        + struct.pack(">ff", 17.0, 130.0) + b"\x00"
    )  # fmt: skip
    grid = serato_reader.parse_grid(data)
    assert grid is not None and grid.first_downbeat == 1.0
    assert (grid.anchors[0].beat, grid.anchors[0].time) == (32, 17.0)


def test_virtualdj_reader(tmp_path: Path) -> None:
    bloom, neon = tmp_path / "a.mp3", tmp_path / "b.mp3"
    db = tmp_path / "database.xml"
    db.write_text(vdj_database(bloom, neon))
    vdj_lists(tmp_path, [bloom])
    out = vdj_reader.read(db)
    first = out.tracks[0]
    assert first.bpm == 125.0 and first.key == Key(7, "minor") and first.rating == 3
    assert first.play_count == 9 and first.comment == "Desde VDJ"
    assert first.grid is not None and first.grid.first_downbeat == 0.29
    assert ImportedCue("hot", 47.0, slot=2, name="Vocal") in first.cues
    assert ImportedCue("memory", 5.0, name="Guardado") in first.cues
    (loop,) = [c for c in first.cues if c.kind == "loop"]
    assert loop.length == pytest.approx(16 * 0.48)
    (bolos,) = out.playlists
    assert bolos.is_folder and bolos.children[0].paths == [str(bloom)]


def test_engine_dj_reader(tmp_path: Path) -> None:
    music = tmp_path / "Música ñ" / "🎧 Mix"
    music.mkdir(parents=True)
    db = engine_library(tmp_path / "Engine Library", music)
    out = engine_reader.read(db)
    first = out.tracks[0]
    assert Path(first.path).resolve() == (music / "01 Midnight Bloom.mp3").resolve()
    assert first.key == Key(11, "minor")  # Engine key 5: 10A (Bm)
    assert first.rating == 4 and first.comment == "Engine"
    pads = sorted((c.slot, round(c.position, 3), c.name) for c in first.cues)
    assert pads == [(0, 9.0, "Old drop"), (7, 2.0, "Mine")]
    assert first.grid is not None
    # The DJ's own list from make_library, then ours; "Tonalia" (an export's) is left out.
    assert [p.name for p in out.playlists] == ["Mis cosas", "Bolos"]
    assert [Path(p).name for p in out.playlists[1].children[0].paths] == ["01 Midnight Bloom.mp3"]
    # Engine's key numbers go around the wheel: 0 = C (8B), 1 = Am (8A), 2 = G (9B).
    assert [engine_reader.engine_key(n) for n in (0, 1, 2)] == [
        Key(0, "major"), Key(9, "minor"), Key(7, "major"),
    ]  # fmt: skip


def test_engine_dj_reader_survives_a_crafted_database(tmp_path: Path) -> None:
    from tonalia_engine.export import engine_dj as ex

    # A blob that inflates past the limit, or claims to, is refused instead of filling memory.
    with pytest.raises(ValueError):
        ex.decompress(ex.compress(bytes(ex.MAX_BLOB + 1)))
    with pytest.raises(ValueError):
        ex.decompress(struct.pack(">i", -1) + b"x")
    # Beats that go backwards would never reach 0 s: no grid, and no endless loop.
    backwards = ex.BeatData(44100, 0, True, [ex.Marker(-44100, 0, 0), ex.Marker(-22050, -4, 0)], [])
    assert engine_reader.grid(backwards, 44100) is None
    # A playlist that is its own ancestor (and one with id 0) does not recurse forever.
    conn = sqlite3.connect(":memory:")
    conn.execute("CREATE TABLE Playlist (id, title, parentListId, nextListId)")
    conn.execute("CREATE TABLE PlaylistEntity (id, listId, trackId, nextEntityId)")
    conn.executemany(
        "INSERT INTO Playlist VALUES (?, ?, ?, 0)", [(0, "Zero", 0), (1, "A", 0), (2, "B", 1)]
    )
    conn.execute("UPDATE Playlist SET parentListId = 2 WHERE id = 1")
    conn.execute("INSERT INTO Playlist VALUES (3, 'Top', 0, 0)")
    assert [p.name for p in engine_reader._playlists(conn, {}, [])] == ["Top"]
    # A track with a broken blob is read without its cues, and said so.
    music = tmp_path / "music"
    music.mkdir()
    db = engine_library(tmp_path / "Engine Library", music)
    with sqlite3.connect(db) as raw:
        layout = ex._layout(raw)
        raw.execute(f"UPDATE {layout.table} SET quickCues = ?", (b"\x00\x00\x00\x10junk",))
    out = engine_reader.read(db)
    assert out.tracks and all(not t.cues for t in out.tracks)
    assert any(w.code == "unreadable_file" for w in out.warnings)


def test_a_collection_cannot_make_tonalia_open_unknown_network_shares(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from tonalia_engine.import_.model import ImportedTrack, network_share

    assert network_share(r"\\Evil\Share\a.mp3") == r"\\evil\share"
    assert network_share("//nas/music/a.mp3") == r"\\nas\music"
    assert network_share(r"\\?\UNC\nas\music\a.mp3") == r"\\nas\music"
    assert network_share(r"\\?\C:\Music\a.mp3") is None
    assert network_share("/Users/dj/a.mp3") is None
    # The same spellings Windows accepts: mixed separators and device paths.
    assert network_share("\\/evil/share/a.mp3") == r"\\evil\share"
    assert network_share("/\\evil\\share\\a.mp3") == r"\\evil\share"
    assert network_share(r"\\.\unc\evil\share\a.mp3") == r"\\evil\share"
    assert network_share(r"\\.\GLOBALROOT\Device\Mup\evil\share\a.mp3") == ""
    assert network_share(r"\\evil") == ""
    # Only ASCII case is folded: "maß" is another server than "mass".
    assert network_share(r"\\maß\x\a.mp3") != network_share(r"\\mass\x\a.mp3")
    index = service._Index({}, {}, [], {r"\\nas\music"})
    touched: list[str] = []
    monkeypatch.setattr(Path, "stat", lambda self, **_: touched.append(str(self)) or 1 / 0)
    service._match_one(ImportedTrack(path=r"\\evil\share\a.mp3"), index, [], {})
    assert touched == []
    with pytest.raises(ZeroDivisionError):  # a share the user keeps music on is looked at
        service._match_one(ImportedTrack(path=r"\\NAS\Music\a.mp3"), index, [], {})


def test_path_maps_stay_inside_their_folder() -> None:
    from pydantic import ValidationError

    folder = PathMap(from_="D:\\Music", to="/Volumes/Música", tracks=0)
    assert service.apply_map(r"D:\Music\..\..\etc\passwd", [folder]) is None
    with pytest.raises(ValidationError):
        PathMap.model_validate({"from": "D:\\Music", "to": "/Volumes/../etc"})


# ---- matching ----


def test_path_mappings_are_detected_from_file_names() -> None:
    library = ["/Volumes/Música/House/a.mp3", "/Volumes/Música/House/b.mp3", "/x/solo.mp3"]
    unmatched = [r"D:\Music\House\a.mp3", r"D:\Music\House\b.mp3", r"D:\Other\nada.mp3"]
    (found,) = service.detect_maps(unmatched, library)
    assert (found.from_, found.to) == (str(PureWindowsPath("D:/Music")), "/Volumes/Música")
    assert service.apply_map(r"D:\Music\House\a.mp3", [found]) == "/Volumes/Música/House/a.mp3"
    assert service.apply_map(r"E:\Music\a.mp3", [found]) is None


# ---- through the engine ----


def files(ctx: EngineContext, lib: dict[str, int], tmp_path: Path) -> tuple[Path, Path, Path, Path]:
    bloom, neon = path_of(ctx, lib["bloom"]), path_of(ctx, lib["neon"])
    new = bloom.parent / "Nuevo tema.mp3"
    shutil.copy2(make_all(tmp_path / "gen")["mp3"], new)
    return bloom, neon, new, bloom.parent / "Perdido.mp3"


def test_preview_changes_nothing_and_reports_the_plan(
    engine_ctx: EngineContext, lib: dict[str, int], tmp_path: Path
) -> None:
    xml = tmp_path / "rekordbox.xml"
    xml.write_text(rekordbox_xml(*files(engine_ctx, lib, tmp_path)))
    before = dump(engine_ctx)
    report = run_import(engine_ctx, "import.preview", source="rekordbox", path=str(xml))
    assert dump(engine_ctx) == before
    assert report["simulated"] and report["batchId"] is None
    assert report["tracks"] == 4 and report["matched"] == {"path": 2, "hash": 0, "map": 0}
    assert report["new"] == 1 and report["missing"] == 1
    assert {u["title"]: u["onDisk"] for u in report["unmatched"]} == {
        "Nuevo": True,
        "Perdido": False,
    }
    fields = {f["field"]: f for f in report["fields"]}
    # Bloom's key, BPM and grid come from the analysis: by default they stay (Neon's key
    # is the same in both).
    assert fields["key"]["kept"] == 1 and fields["key"]["changes"] == 0
    assert fields["grid"]["kept"] == 2 and fields["bpm"]["kept"] == 1
    # Its automatic drop cue makes room; the DJ's own cue in pad 4 stays.
    assert fields["cues"] == {"field": "cues", "changes": 1, "conflicts": 0, "kept": 1}
    assert fields["rating"]["changes"] == 1 and fields["comment"]["changes"] == 1
    assert report["playlists"] == 3 and report["folder"] == "Imported from Rekordbox"
    assert [w["code"] for w in report["warnings"]] == ["own_folder_skipped"]


def test_apply_fills_what_tonalia_lacks_and_undo_puts_everything_back(
    engine_ctx: EngineContext, lib: dict[str, int], tmp_path: Path
) -> None:
    xml = tmp_path / "rekordbox.xml"
    xml.write_text(rekordbox_xml(*files(engine_ctx, lib, tmp_path)))
    before = dump(engine_ctx)
    report = run_import(
        engine_ctx, "import.apply", source="rekordbox", path=str(xml), addMissing=True,
        language="es",
    )  # fmt: skip
    assert report["batchId"] and report["added"] == 1
    bloom, neon = lib["bloom"], lib["neon"]
    cues = cues_of(engine_ctx, bloom)
    assert cues[1] == (31.05, "Drop!", "#FF0080", "import")
    assert cues[3][3] == "user"  # the DJ's cue in Tonalia stays
    detail = call(engine_ctx, "library.get", {"trackId": bloom})
    assert detail["rating"] == 4 and detail["playCount"] == 12 and detail["comment"] == "Peak time"
    assert detail["keyRoot"] == 9  # the analysed key stays
    assert sorted((m["kind"], m["positionSec"]) for m in detail["markers"]) == [
        ("loop", 40.0), ("memory", 12.0),
    ]  # fmt: skip
    neon_detail = call(engine_ctx, "library.get", {"trackId": neon})
    assert neon_detail["gridSource"] == "auto"  # it had a grid: kept
    # The added file brings its pad 1 and key, and waits for its analysis.
    added = engine_ctx.db.conn.execute(
        "SELECT id FROM tracks WHERE path LIKE '%Nuevo tema.mp3'"
    ).fetchone()[0]
    assert cues_of(engine_ctx, added)[0] == (1.0, "Start", None, "import")
    imported = engine_ctx.db.conn.execute(
        "SELECT key_root, key_mode, imported_fields FROM analysis WHERE track_id = ?", (added,)
    ).fetchone()
    assert tuple(imported[:2]) == (9, "minor") and set(json.loads(imported[2])) == {"key", "bpm"}
    tree = call(engine_ctx, "playlists.tree")["playlists"]

    def children(parent: int) -> list[dict[str, Any]]:
        return [p for p in tree if p["parentId"] == parent]

    folder = next(p for p in tree if p["name"] == "Importado de Rekordbox")
    assert folder["parentId"] is None and folder["isFolder"]
    bolos, suelta = children(folder["id"])
    assert (bolos["name"], suelta["name"], suelta["trackCount"]) == ("Bolos", "Suelta", 1)
    assert [c["name"] for c in children(bolos["id"])] == ["Warm-up", "Por ruta"]
    warm = children(bolos["id"])[0]["id"]
    order = [r[0] for r in engine_ctx.db.conn.execute(
        "SELECT track_id FROM playlist_tracks WHERE playlist_id = ? ORDER BY position", (warm,))]  # fmt: skip
    assert order == [neon, bloom]

    history = call(engine_ctx, "import.history")["batches"]
    assert history[0]["batchId"] == report["batchId"] and history[0]["undoneAt"] is None
    undo = call(engine_ctx, "import.undo", {"batchId": report["batchId"]})
    assert undo["removed"] == 1 and undo["skipped"] == 0
    assert diff(dump(engine_ctx), before) == []
    assert call(engine_ctx, "import.history")["batches"][0]["undoneAt"]


def test_take_replaces_user_data_and_undo_keeps_later_changes(
    engine_ctx: EngineContext, lib: dict[str, int], tmp_path: Path
) -> None:
    xml = tmp_path / "rekordbox.xml"
    xml.write_text(rekordbox_xml(*files(engine_ctx, lib, tmp_path)))
    take = dict.fromkeys(("cues", "grid", "key", "bpm", "rating", "playCount", "comment"), "take")
    preview = run_import(
        engine_ctx, "import.preview", source="rekordbox", path=str(xml), policy=take
    )
    mine = next(
        c
        for c in preview["changes"]
        if c["field"] == "cues" and c["before"] and "Vocal in" in c["before"]
    )
    assert mine["conflict"] and mine["user"]
    report = run_import(engine_ctx, "import.apply", source="rekordbox", path=str(xml), policy=take)
    bloom = lib["bloom"]
    assert cues_of(engine_ctx, bloom)[3][1:] == ("Mine", "#00FF00", "import")
    detail = call(engine_ctx, "library.get", {"trackId": bloom})
    assert (detail["keyRoot"], detail["keyMode"]) == (5, "minor") and detail["bpm"] == 125.0
    assert detail["gridSource"] == "import" and detail["gridLocked"]
    assert detail["beatGrid"]["first_downbeat"] == pytest.approx(0.3, abs=0.001)
    neon = call(engine_ctx, "library.get", {"trackId": lib["neon"]})
    assert neon["beatGrid"]["kind"] == "variable" and neon["gridSource"] == "import"
    # After the import the DJ changes the rating: undo leaves that one alone.
    engine_ctx.db.conn.execute("UPDATE tracks SET rating = 1 WHERE id = ?", (bloom,))
    undo = call(engine_ctx, "import.undo", {"batchId": report["batchId"]})
    assert undo["skipped"] == 1
    after = call(engine_ctx, "library.get", {"trackId": bloom})
    assert after["rating"] == 1
    assert (after["keyRoot"], after["gridSource"]) == (9, "auto")
    assert cues_of(engine_ctx, bloom)[3][1:] == ("Vocal in", "#FFB547", "user")
    again = call_error(engine_ctx, "import.undo", {"batchId": report["batchId"]})
    assert again["data"]["reason"] == "undo_changed"


def call_error(ctx: EngineContext, method: str, params: dict[str, Any]) -> dict[str, Any]:
    from tests.test_track_update import call_error as base

    return base(ctx, method, params)


def test_matching_by_mapping_and_by_contents(
    engine_ctx: EngineContext, lib: dict[str, int], tmp_path: Path
) -> None:
    """The DJ's other computer kept the music on D:\\Música; one more file was renamed."""
    from tonalia_engine.library import file_hash

    bloom, neon = path_of(engine_ctx, lib["bloom"]), path_of(engine_ctx, lib["neon"])
    renamed = tmp_path / "copia renombrada.mp3"
    shutil.copy2(make_all(tmp_path / "gen")["mp3"], renamed)
    original = tmp_path / "otra carpeta" / "Original.mp3"
    original.parent.mkdir()
    shutil.copy2(renamed, original)
    tid = add_track(engine_ctx, original, create=False, title="Original")
    engine_ctx.db.conn.execute(
        "UPDATE tracks SET size = ?, file_hash = ? WHERE id = ?",
        (original.stat().st_size, file_hash(original), tid),
    )
    windows = [PureWindowsPath("D:/Música/🎧 Mix") / p.name for p in (bloom, neon)]
    xml = tmp_path / "rekordbox.xml"
    xml.write_text(
        f"""<?xml version="1.0"?><DJ_PLAYLISTS><COLLECTION>
<TRACK TrackID="1" Name="a" Rating="255" Location="file://localhost/{quote(windows[0].as_posix())}"/>
<TRACK TrackID="2" Name="b" Rating="51" Location="file://localhost/{quote(windows[1].as_posix())}"/>
<TRACK TrackID="3" Name="c" Rating="102" Location="{url(renamed)}"/>
</COLLECTION></DJ_PLAYLISTS>"""
    )
    report = run_import(engine_ctx, "import.preview", source="rekordbox", path=str(xml))
    assert report["matched"] == {"path": 0, "hash": 1, "map": 2}
    (found,) = report["pathMaps"]
    # The folders both sides share ("🎧 Mix") stay out of the mapping.
    assert found["from"] == str(PureWindowsPath("D:/Música"))
    assert found["to"] == str(bloom.parent.parent) and found["tracks"] == 2
    # Without the mapping, those two are not found.
    off = run_import(engine_ctx, "import.preview", source="rekordbox", path=str(xml), pathMaps=[])
    assert off["matched"]["map"] == 0 and off["missing"] == 2
    run_import(engine_ctx, "import.apply", source="rekordbox", path=str(xml))
    ratings = dict(engine_ctx.db.conn.execute("SELECT id, rating FROM tracks"))
    assert (ratings[lib["bloom"]], ratings[lib["neon"]], ratings[tid]) == (5, 1, 2)
    assert PathMap(**{"from": "x", "to": "y"}).from_ == "x"


def test_reanalysis_keeps_imported_cues_grid_and_key(
    engine_ctx: EngineContext, tmp_path: Path
) -> None:
    from tests.test_cues_rpc import write_club_track

    folder = tmp_path / "Club"
    folder.mkdir()
    track = folder / "club.flac"
    write_club_track(track)
    wait_job(engine_ctx, call(engine_ctx, "library.addPaths", {"paths": [str(folder)]})["jobId"])
    tid = engine_ctx.db.conn.execute("SELECT id FROM tracks").fetchone()[0]
    wait_job(engine_ctx, call(engine_ctx, "analysis.start", {"trackIds": [tid]})["jobId"])
    xml = tmp_path / "rekordbox.xml"
    xml.write_text(
        f"""<?xml version="1.0"?><DJ_PLAYLISTS><COLLECTION>
<TRACK TrackID="1" Name="club" Tonality="F#m" Location="{url(track)}">
<TEMPO Inizio="0.120" Bpm="128.00" Metro="4/4" Battito="1"/>
<POSITION_MARK Name="Mío" Type="0" Start="20.000" Num="6"/>
</TRACK></COLLECTION></DJ_PLAYLISTS>"""
    )
    take = {"key": "take", "grid": "take", "bpm": "take"}
    run_import(engine_ctx, "import.apply", source="rekordbox", path=str(xml), policy=take)
    wait_job(engine_ctx, call(engine_ctx, "analysis.reanalyze", {"trackIds": [tid]})["jobId"])
    detail = call(engine_ctx, "library.get", {"trackId": tid})
    assert (detail["keyRoot"], detail["keyMode"]) == (6, "minor")
    assert detail["gridSource"] == "import" and detail["bpm"] == 128.0
    assert detail["beatGrid"]["bpm"] == 128.0
    mine = [c for c in detail["cues"] if c["slot"] == 6]
    assert mine == [
        {"slot": 6, "positionSec": 20.0, "label": "Mío", "color": None, "source": "import"}
    ]
    assert all(c["source"] == "auto" for c in detail["cues"] if c["slot"] != 6)


# ---- the acceptance test: every program, then undo ----


def build_collection(
    source: str, ctx: EngineContext, lib: dict[str, int], tmp_path: Path
) -> tuple[str, int]:
    """The collection file and the track that must get a new cue from it."""
    bloom, neon = path_of(ctx, lib["bloom"]), path_of(ctx, lib["neon"])
    if source == "rekordbox":
        xml = tmp_path / "rekordbox.xml"
        xml.write_text(rekordbox_xml(bloom, neon, tmp_path / "x.mp3", tmp_path / "y.mp3"))
        return str(xml), lib["bloom"]
    if source == "traktor":
        nml = tmp_path / "Traktor 4.0.0" / "collection.nml"
        nml.parent.mkdir()
        nml.write_text(traktor_nml(bloom, neon))
        return str(nml), lib["bloom"]
    if source == "virtualdj":
        db = tmp_path / "VirtualDJ" / "database.xml"
        db.parent.mkdir()
        db.write_text(vdj_database(bloom, neon))
        vdj_lists(db.parent, [bloom, neon])
        return str(db), lib["bloom"]
    if source == "engine_dj":
        db = engine_library(tmp_path / "Engine Library", bloom.parent)
        return str(db), lib["bloom"]
    real = bloom.parent / "Serato real.mp3"
    serato_file(real, make_all(tmp_path / "gen")["mp3"])
    tid = add_track(ctx, real, create=False, title="Serato real", key=(5, "minor"))
    folder = tmp_path / "Music" / "_Serato_"
    serato_library(folder, [(real, "125.00", "Fm"), (bloom, "124.00", "Am")])
    return str(folder), tid


@pytest.mark.parametrize("source", ["rekordbox", "traktor", "serato", "virtualdj", "engine_dj"])
def test_every_program_imports_and_undo_leaves_tonalia_as_it_was(
    engine_ctx: EngineContext, lib: dict[str, int], tmp_path: Path, source: str
) -> None:
    path, tid = build_collection(source, engine_ctx, lib, tmp_path)
    original = Path(path).read_bytes() if Path(path).is_file() else None
    before = dump(engine_ctx)
    report = run_import(engine_ctx, "import.apply", source=source, path=path)
    assert report["matched"]["path"] >= 1, report
    assert report["cues"] >= 1 and report["playlists"] >= 1, report
    assert any(c[3] == "import" for c in cues_of(engine_ctx, tid).values())
    assert dump(engine_ctx) != before
    # Reading never writes to the program's collection.
    if original is not None:
        assert Path(path).read_bytes() == original
    call(engine_ctx, "import.undo", {"batchId": report["batchId"]})
    assert diff(dump(engine_ctx), before) == []


def test_detect_lists_the_five_programs(engine_ctx: EngineContext, tmp_path: Path) -> None:
    out = call(engine_ctx, "import.detect")["sources"]
    assert [s["source"] for s in out] == [
        "rekordbox",
        "traktor",
        "serato",
        "virtualdj",
        "engine_dj",
    ]
    assert out[0]["path"] is None


def test_a_missing_collection_is_reported(engine_ctx: EngineContext, tmp_path: Path) -> None:
    finished = wait_job(
        engine_ctx,
        call(engine_ctx, "import.preview", {"source": "traktor", "path": str(tmp_path / "no.nml")})[
            "jobId"
        ],
    )
    assert finished["status"] == "failed"
    assert finished["errorInfo"]["reason"] == "collection_not_found"


def test_twenty_thousand_tracks_in_under_thirty_seconds(
    engine_ctx: EngineContext, tmp_path: Path
) -> None:
    conn = engine_ctx.db.conn
    music = tmp_path / "big"
    rows = [(str(music / f"{i:05d}.mp3"), f"T{i}", f"T{i}") for i in range(20_000)]
    conn.execute("BEGIN")
    conn.executemany(
        "INSERT INTO tracks (path, title, display_title, status) VALUES (?, ?, ?, 'ready')", rows
    )
    conn.execute("COMMIT")
    body = "".join(
        f'<TRACK TrackID="{i}" Name="T{i}" Rating="153" Tonality="Am" Location="{url(Path(p))}">'
        f'<POSITION_MARK Name="A" Type="0" Start="{1 + i % 50}.000" Num="0"/>'
        f'<POSITION_MARK Name="B" Type="0" Start="{60 + i % 50}.000" Num="1"/></TRACK>'
        for i, (p, _, _) in enumerate(rows)
    )
    xml = tmp_path / "rekordbox.xml"
    xml.write_text(
        f'<?xml version="1.0"?><DJ_PLAYLISTS><COLLECTION>{body}</COLLECTION></DJ_PLAYLISTS>'
    )
    start = time.monotonic()
    report = run_import(engine_ctx, "import.apply", source="rekordbox", path=str(xml))
    elapsed = time.monotonic() - start
    assert report["matched"]["path"] == 20_000 and report["cues"] == 40_000
    assert elapsed < 30, f"{elapsed:.1f} s"
