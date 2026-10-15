"""Engine DJ export (SPEC 10.5): key, hot cues, beat grid and playlists in ``m.db``.

The Engine Library schemas come from tests/data/engine_dj (Engine DJ 2.x and 3.x layouts);
the binary blobs are built here independently of the code under test.
"""

import sqlite3
import struct
import zlib
from pathlib import Path
from typing import Any

import pytest

from tests.test_analysis_queue import call, wait_job
from tests.test_export_rekordbox import BAR, BPM, library
from tonalia_engine.analysis.tempo import BeatGrid
from tonalia_engine.export import engine_dj
from tonalia_engine.keys import Key
from tonalia_engine.server import EngineContext

__all__ = ["library"]

SCHEMAS = Path(__file__).parent / "data" / "engine_dj"
UUID = "5a0d3c1e-6c2b-4a8e-9d1f-0123456789ab"


# ---- blobs, built by hand from the documented layout ----


def packed(payload: bytes) -> bytes:
    return struct.pack(">i", len(payload)) + zlib.compress(payload)


def unpacked(blob: bytes) -> bytes:
    assert struct.unpack(">i", blob[:4])[0] == len(zlib.decompress(blob[4:]))
    return zlib.decompress(blob[4:])


def quick_cues_payload(
    cues: list[tuple[str, float, tuple[int, int, int, int]]], main: float, default: float
) -> bytes:
    out = struct.pack(">q", len(cues))
    for label, offset, (a, r, g, b) in cues:
        raw = label.encode("utf-8")
        out += struct.pack(">B", len(raw)) + raw + struct.pack(">dBBBB", offset, a, r, g, b)
    return out + struct.pack(">dBd", main, 1, default)


def track_data_payload(sample_rate: float, samples: int, key: int) -> bytes:
    return struct.pack(">dqiddd", sample_rate, samples, key, 0.5, 0.25, 0.125)


def beat_data_payload(
    sample_rate: float, samples: float, grid: list[tuple[float, int, int, int]]
) -> bytes:
    def markers(items: list[tuple[float, int, int, int]]) -> bytes:
        return struct.pack(">q", len(items)) + b"".join(struct.pack("<dqii", *m) for m in items)

    return struct.pack(">ddB", sample_rate, samples, 1) + markers(grid) + markers(grid)


def decode_cues(blob: bytes) -> tuple[list[Any], float, float]:
    data = unpacked(blob)
    (count,) = struct.unpack_from(">q", data, 0)
    pos = 8
    cues = []
    for _ in range(count):
        size = data[pos]
        label = data[pos + 1 : pos + 1 + size].decode("utf-8")
        pos += 1 + size
        offset, a, r, g, b = struct.unpack_from(">dBBBB", data, pos)
        pos += 12
        cues.append((label, offset, (a, r, g, b)))
    main, _, default = struct.unpack_from(">dBd", data, pos)
    return cues, main, default


def decode_grid(blob: bytes) -> dict[str, Any]:
    data = unpacked(blob)
    sample_rate, samples, is_set = struct.unpack_from(">ddB", data, 0)
    pos = 17
    grids = []
    for _ in range(2):
        (count,) = struct.unpack_from(">q", data, pos)
        pos += 8
        grids.append([struct.unpack_from("<dqii", data, pos + 24 * i) for i in range(count)])
        pos += 24 * count
    return {
        "rate": sample_rate,
        "samples": samples,
        "set": is_set,
        "default": grids[0],
        "adjusted": grids[1],
    }


# ---- an Engine Library next to the test music ----


def make_library(root: Path, music: Path, version: str) -> Path:
    db_path = root / "Database2" / "m.db"
    db_path.parent.mkdir(parents=True)
    conn = sqlite3.connect(db_path)
    conn.executescript((SCHEMAS / f"schema_{version}.sql").read_text(encoding="utf-8"))
    major, minor, patch = (int(x) for x in version.split("."))
    conn.execute(
        "INSERT INTO Information (uuid, schemaVersionMajor, schemaVersionMinor,"
        " schemaVersionPatch, currentPlayedIndiciator, lastRekordBoxLibraryImportReadCounter)"
        " VALUES (?, ?, ?, ?, 0, 0)",
        (UUID, major, minor, patch),
    )
    relative = "../" + music.relative_to(root.parent).as_posix()
    rows = [
        ("01 Midnight Bloom.mp3", 300.4),
        ("Neon & Cathedral.flac", 300.4),
        ("Ajeno.mp3", 200.0),
    ]
    for name, length in rows:
        conn.execute(
            "INSERT INTO Track (path, filename, length, title, key, bpmAnalyzed, isAnalyzed,"
            " isAvailable, dateAdded) VALUES (?, ?, ?, ?, 5, 120.0, 1, 1, 1700000000)",
            (f"{relative}/{name}", name, length, name.rsplit(".", 1)[0]),
        )
    perf_table = "Track" if version.startswith("2.") else "PerformanceData"
    id_column = "id" if perf_table == "Track" else "trackId"
    # Midnight Bloom was analysed by Engine: a user cue in pad 8, a moved main cue, a grid.
    mine = ("Mine", 88200.0, (255, 1, 2, 3))
    old = ("Old drop", 44100.0 * 9, (255, 9, 9, 9))
    empty = ("", -1.0, (0, 0, 0, 0))
    cues = [old, empty, empty, empty, empty, empty, empty, mine]
    conn.execute(
        f"UPDATE {perf_table} SET trackData = ?, quickCues = ?, beatData = ? WHERE {id_column} = 1",
        (
            packed(track_data_payload(44100.0, int(300.4 * 44100), 5)),
            packed(quick_cues_payload(cues, 1234.0, 1000.0)),
            packed(
                beat_data_payload(44100.0, 300.4 * 44100, [(-500.0, -4, 600, 0), (1e7, 596, 0, 0)])
            ),
        ),
    )
    # A playlist of the user's own, which must survive.
    conn.execute(
        "INSERT INTO Playlist (title, parentListId, isPersisted, nextListId, lastEditTime,"
        " isExplicitlyExported) VALUES ('Mis cosas', 0, 1, 0, 1700000000, 1)"
    )
    conn.execute(
        "INSERT INTO PlaylistEntity (listId, trackId, databaseUuid, nextEntityId,"
        " membershipReference) VALUES (1, 3, ?, 0, 0)",
        (UUID,),
    )
    conn.commit()
    conn.close()
    return db_path


@pytest.fixture(params=["3.0.2", "2.21.2"])
def m_db(
    request: pytest.FixtureRequest,
    engine_ctx: EngineContext,
    library: dict[str, int],
    tmp_path: Path,
) -> Path:
    row = engine_ctx.db.conn.execute(
        "SELECT path FROM tracks WHERE id = ?", (library["bloom"],)
    ).fetchone()
    return make_library(tmp_path / "Engine Library ✨", Path(row[0]).parent, request.param)


@pytest.fixture(autouse=True)
def engine_closed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(engine_dj, "engine_running", lambda: False)


def export(ctx: EngineContext, **options: Any) -> dict[str, Any]:
    finished = wait_job(ctx, call(ctx, "export.engineDj", options)["jobId"])
    return finished


def done(ctx: EngineContext, **options: Any) -> dict[str, Any]:
    finished = export(ctx, **options)
    assert finished["status"] == "done", finished
    result: dict[str, Any] = finished["result"]
    return result


def performance(db_path: Path, track_id: int) -> sqlite3.Row:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    row = conn.execute(
        "SELECT t.key, t.bpmAnalyzed, p.trackData, p.quickCues, p.beatData FROM Track t"
        " JOIN PerformanceData p ON p.trackId = t.id WHERE t.id = ?",
        (track_id,),
    ).fetchone()
    conn.close()
    assert isinstance(row, sqlite3.Row)
    return row


def playlists(db_path: Path) -> dict[str, Any]:
    """Playlist tree by title, each with its tracks in linked-list order."""
    conn = sqlite3.connect(db_path)

    def ordered(rows: list[tuple[int, int]]) -> list[int]:
        nxt = {r[0]: r[1] for r in rows}
        ids = set(nxt)
        heads = [i for i in ids if i not in set(nxt.values())]
        assert len(heads) <= 1, rows
        out = []
        cur = heads[0] if heads else 0
        while cur:
            out.append(cur)
            cur = nxt[cur]
        assert len(out) == len(rows), rows
        return out

    def tree(parent: int) -> dict[str, Any]:
        lists = conn.execute(
            "SELECT id, nextListId, title FROM Playlist WHERE parentListId = ?", (parent,)
        ).fetchall()
        titles = {r[0]: r[2] for r in lists}
        out: dict[str, Any] = {}
        for list_id in ordered([(r[0], r[1]) for r in lists]):
            entities = conn.execute(
                "SELECT id, nextEntityId, trackId, databaseUuid FROM PlaylistEntity"
                " WHERE listId = ?",
                (list_id,),
            ).fetchall()
            assert all(e[3] == UUID for e in entities)
            track_of = {e[0]: e[2] for e in entities}
            tracks = [track_of[i] for i in ordered([(e[0], e[1]) for e in entities])]
            out[titles[list_id]] = {"tracks": tracks, "children": tree(list_id)}
        return out

    result = tree(0)
    conn.close()
    return result


# ---- pure pieces ----


def test_engine_key_numbers_follow_the_wheel() -> None:
    assert engine_dj.engine_key(Key(0, "major")) == 0  # C
    assert engine_dj.engine_key(Key(9, "minor")) == 1  # Am
    assert engine_dj.engine_key(Key(7, "major")) == 2  # G
    assert engine_dj.engine_key(Key(1, "minor")) == 9  # C#m / Dbm
    assert engine_dj.engine_key(Key(5, "minor")) == 17  # Fm
    assert engine_dj.engine_key(Key(5, "major")) == 22  # F
    assert engine_dj.engine_key(Key(2, "minor")) == 23  # Dm
    assert sorted(
        engine_dj.engine_key(Key(r, m)) for r in range(12) for m in ("major", "minor")
    ) == list(range(24))


def test_quick_cue_blobs_round_trip_and_match_the_layout() -> None:
    cues = [("Intro ✨", 11025.5, (255, 76, 195, 255)), ("", -1.0, (0, 0, 0, 0))]
    blob = packed(quick_cues_payload(cues, 11025.5, 11025.5))
    decoded = engine_dj.QuickCues.decode(blob)
    assert [(c.label, c.sample_offset, c.color) for c in decoded.cues] == cues
    assert (decoded.adjusted_main_cue, decoded.default_main_cue) == (11025.5, 11025.5)
    assert unpacked(decoded.encode()) == unpacked(blob)
    empty = engine_dj.QuickCues.decode(b"")
    assert empty.cues == [] and empty.default_main_cue == 0


def test_track_and_beat_data_keep_unknown_bytes() -> None:
    blob = packed(track_data_payload(48000.0, 123456, 7) + b"tail")
    data = engine_dj.TrackData.decode(blob)
    assert data is not None
    assert (data.sample_rate, data.samples, data.key, data.extra) == (48000.0, 123456, 7, b"tail")
    data.key = 1
    assert unpacked(data.encode()) == track_data_payload(48000.0, 123456, 1) + b"tail"

    grid = [(-500.0, -4, 600, 0), (1e7, 596, 0, 0)]
    beat = engine_dj.BeatData.decode(packed(beat_data_payload(44100.0, 9e6, grid) + b"x"))
    assert beat is not None
    assert beat.default == beat.adjusted == [engine_dj.Marker(*m) for m in grid]
    assert beat.extra == b"x"
    assert unpacked(beat.encode()) == beat_data_payload(44100.0, 9e6, grid) + b"x"


def test_constant_grid_markers_bracket_the_track() -> None:
    grid = BeatGrid("constant", 120.0, 0.25, None)
    markers = engine_dj.grid_markers(grid, duration=10.0, sample_rate=44100.0)
    spb = 0.5 * 44100
    assert markers[0] == engine_dj.Marker(0.25 * 44100 - 4 * spb, -4, markers[1].beat_number + 4, 0)
    last = markers[1]
    assert last.number_of_beats == 0
    assert last.sample_offset == pytest.approx(0.25 * 44100 + last.beat_number * spb)
    assert last.sample_offset >= 10.0 * 44100  # past the end
    assert len(markers) == 2


def test_variable_grid_has_one_marker_per_bar() -> None:
    beats = [0.5 + i * 0.5 for i in range(8)] + [4.5 + i * 0.4 for i in range(8)]
    grid = BeatGrid("variable", 126.0, 0.5, beats)
    markers = engine_dj.grid_markers(grid, duration=20.0, sample_rate=1000.0)
    assert [m.beat_number for m in markers[:5]] == [-4, 0, 4, 8, 12]
    assert [m.sample_offset for m in markers[:5]] == pytest.approx([-1500, 500, 2500, 4500, 6100])
    assert all(m.number_of_beats == 4 for m in markers[:4])
    last = markers[5]
    assert len(markers) == 6 and last.beat_number % 4 == 0
    assert markers[4].number_of_beats == last.beat_number - 12
    # Past the end, at the tempo of the last bar (0.4 s per beat).
    assert last.sample_offset == pytest.approx(6100 + (last.beat_number - 12) * 400)
    assert last.number_of_beats == 0 and last.sample_offset >= 20_000


# ---- finding the database ----


def test_finds_the_library_in_music_and_accepts_folders(tmp_path: Path) -> None:
    assert engine_dj.find_database(tmp_path) is None
    m_db = tmp_path / "Music" / "Engine Library" / "Database2" / "m.db"
    m_db.parent.mkdir(parents=True)
    m_db.write_bytes(b"")
    assert engine_dj.find_database(tmp_path) == m_db
    assert engine_dj.resolve_database(str(tmp_path / "Music" / "Engine Library")) == m_db
    assert engine_dj.resolve_database(str(m_db)) == m_db


# ---- the export ----


def test_simulation_changes_nothing_and_reports_missing_tracks(
    engine_ctx: EngineContext, library: dict[str, int], m_db: Path
) -> None:
    before = m_db.read_bytes()
    result = done(engine_ctx, path=str(m_db))
    assert (result["target"], result["simulated"], result["tracks"]) == ("engine_dj", True, 3)
    assert result["cues"] == 3 and result["playlists"] == 2 and result["skipped"] == 1
    codes = sorted((w["code"], w.get("trackId")) for w in result["warnings"])
    # A file that is not on disk cannot be added to Engine's collection.
    assert ("not_in_collection", library["pending"]) in codes
    assert ("missing_file", library["pending"]) in codes
    assert ("not_in_collection", library["ogg"]) not in codes
    assert {i["trackId"]: i["action"] for i in result["items"]} == {
        library["bloom"]: "updated",
        library["neon"]: "updated",
        library["ogg"]: "added",
    }
    assert m_db.read_bytes() == before
    assert result["backupPath"] is None


def test_writes_key_cues_grid_and_playlists_keeping_the_rest(
    engine_ctx: EngineContext, library: dict[str, int], m_db: Path
) -> None:
    original = m_db.read_bytes()
    result = done(engine_ctx, path=str(m_db), simulate=False, language="es")
    assert result["simulated"] is False and result["tracks"] == 3
    backup = Path(result["backupPath"])
    assert backup.read_bytes() == original

    conn = sqlite3.connect(m_db)
    assert conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    conn.close()

    bloom = performance(m_db, 1)
    assert bloom["key"] == 1  # Am
    track_data = engine_dj.TrackData.decode(bloom["trackData"])
    assert track_data is not None
    assert (track_data.key, track_data.sample_rate) == (1, 44100.0)
    cues, main, default = decode_cues(bloom["quickCues"])
    assert len(cues) == 8
    assert (cues[0][0], cues[0][2]) == ("Intro", (255, 0x4C, 0xC3, 0xFF))
    assert cues[0][1] == pytest.approx(0.25 * 44100)
    assert (cues[1][0], cues[1][2]) == ("Drop", (255, 0xFF, 0x5F, 0x8A))
    assert cues[1][1] == pytest.approx((0.25 + 16 * BAR) * 44100)
    assert cues[2] == ("", -1.0, (0, 0, 0, 0))
    assert cues[3][0] == "Vocal in"
    assert cues[7] == ("Mine", 88200.0, (255, 1, 2, 3))  # the user's pad 8 is kept
    assert (main, default) == (1234.0, 1000.0)  # Engine's main cue is kept
    grid = decode_grid(bloom["beatData"])
    assert grid["default"][0] == (-500.0, -4, 600, 0)  # Engine's own analysis stays as default
    assert grid["adjusted"][0][1] == -4
    assert grid["adjusted"][0][0] == pytest.approx((0.25 - 4 * 60 / BPM) * 44100)
    assert bloom["bpmAnalyzed"] == pytest.approx(BPM)

    neon = performance(m_db, 2)
    assert neon["key"] == 0  # C
    cues, main, default = decode_cues(neon["quickCues"])
    assert len(cues) == 8 and all(c == ("", -1.0, (0, 0, 0, 0)) for c in cues)
    assert main == default == pytest.approx(0.5 * 44100)  # first downbeat
    grid = decode_grid(neon["beatData"])
    assert grid["set"] == 1 and grid["rate"] == 44100.0
    assert grid["samples"] == pytest.approx(300.4 * 44100)
    assert [m[1] for m in grid["adjusted"]][:4] == [-4, 0, 4, 8]

    assert performance(m_db, 3)["key"] == 5  # a track Tonalia does not know is untouched

    tree = playlists(m_db)
    assert list(tree) == ["Mis cosas", "Tonalia"]
    assert tree["Mis cosas"]["tracks"] == [3]
    tonalia = tree["Tonalia"]["children"]
    assert list(tonalia) == ["📁 Bolos", "Alta"]
    assert tonalia["📁 Bolos"]["children"]["🌅 Warm-up"]["tracks"] == [2, 1]
    assert tonalia["Alta"]["tracks"] == [2]


def test_adds_the_tracks_engine_does_not_have_yet(
    engine_ctx: EngineContext, library: dict[str, int], m_db: Path
) -> None:
    # As Engine DJ itself imports a file: path relative to the Engine Library folder, the
    # file's facts, and left for Engine to analyse (waveform) when it opens it.
    def vorbis() -> list[sqlite3.Row]:
        # The export replaces the file: open it afresh every time.
        conn = sqlite3.connect(m_db)
        conn.row_factory = sqlite3.Row
        try:
            assert conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
            return conn.execute("SELECT * FROM Track WHERE filename = 'Vorbis.ogg'").fetchall()
        finally:
            conn.close()

    done(engine_ctx, path=str(m_db), simulate=False, playlistIds=[1])
    assert vorbis() == []  # not in the chosen playlist: not added
    done(engine_ctx, path=str(m_db), simulate=False)
    [row] = vorbis()
    music = m_db.parent.parent / row["path"]
    assert not row["path"].startswith("/") and row["path"].startswith("../")
    source = engine_ctx.db.conn.execute(
        "SELECT path FROM tracks WHERE id = ?", (library["ogg"],)
    ).fetchone()[0]
    assert music.resolve() == Path(source).resolve()
    assert (row["title"], row["fileType"], row["fileBytes"]) == (
        "Vorbis",
        "ogg",
        music.stat().st_size,
    )
    assert row["key"] == engine_dj.engine_key(Key(4, "minor"))
    assert (row["isAvailable"], row["isAnalyzed"], row["isPlayed"], row["rating"]) == (1, 0, 0, 0)
    assert row["originDatabaseUuid"] == UUID and row["originTrackId"] == row["id"]
    assert row["dateAdded"] > 1_700_000_000
    assert performance(m_db, row["id"])["quickCues"] is not None  # 8 empty pads, like Engine
    # A second export finds it in the collection and does not add it twice.
    done(engine_ctx, path=str(m_db), simulate=False)
    assert len(vorbis()) == 1


def test_exporting_again_replaces_the_tonalia_playlists(
    engine_ctx: EngineContext, library: dict[str, int], m_db: Path
) -> None:
    done(engine_ctx, path=str(m_db), simulate=False)
    engine_ctx.db.conn.execute("DELETE FROM playlist_tracks WHERE track_id = ?", (library["neon"],))
    done(engine_ctx, path=str(m_db), simulate=False)
    tree = playlists(m_db)
    assert list(tree) == ["Mis cosas", "Tonalia"]
    assert tree["Tonalia"]["children"]["📁 Bolos"]["children"]["🌅 Warm-up"]["tracks"] == [1]
    conn = sqlite3.connect(m_db)
    assert conn.execute("SELECT COUNT(*) FROM Playlist").fetchone()[0] == 5
    conn.close()


def test_options_leave_parts_untouched(
    engine_ctx: EngineContext, library: dict[str, int], m_db: Path
) -> None:
    before = performance(m_db, 1)
    done(
        engine_ctx,
        path=str(m_db),
        simulate=False,
        cues=False,
        beatgrid=False,
        key=False,
        includePlaylists=False,
    )
    after = performance(m_db, 1)
    assert after["key"] == before["key"]
    assert unpacked(after["quickCues"]) == unpacked(before["quickCues"])
    assert unpacked(after["beatData"]) == unpacked(before["beatData"])
    assert list(playlists(m_db)) == ["Mis cosas"]


def test_without_colours_the_pads_use_engine_defaults(
    engine_ctx: EngineContext, library: dict[str, int], m_db: Path
) -> None:
    done(engine_ctx, path=str(m_db), simulate=False, colors=False)
    cues, _, _ = decode_cues(performance(m_db, 1)["quickCues"])
    assert cues[0][2] == (0xFF, 0xEA, 0xC5, 0x32)
    assert cues[1][2] == (0xFF, 0xEA, 0x8F, 0x32)


def test_refuses_while_engine_dj_is_open(
    engine_ctx: EngineContext, library: dict[str, int], m_db: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(engine_dj, "engine_running", lambda: True)
    before = m_db.read_bytes()
    simulated = done(engine_ctx, path=str(m_db))
    assert any(w["code"] == "app_running" for w in simulated["warnings"])
    failed = export(engine_ctx, path=str(m_db), simulate=False)
    assert failed["status"] == "failed"
    assert failed["error"].startswith("Engine DJ is open")
    assert failed["errorInfo"] == {"reason": "program_running", "params": {"program": "Engine DJ"}}
    assert m_db.read_bytes() == before


def test_refuses_a_database_with_pending_changes(
    engine_ctx: EngineContext, library: dict[str, int], m_db: Path
) -> None:
    (m_db.parent / "m.db-wal").write_bytes(b"\x00" * 32)
    before = m_db.read_bytes()
    failed = export(engine_ctx, path=str(m_db), simulate=False)
    assert failed["status"] == "failed"
    assert "did not close cleanly" in failed["error"]
    assert m_db.read_bytes() == before


def test_refuses_unknown_schema_versions(
    engine_ctx: EngineContext, library: dict[str, int], m_db: Path
) -> None:
    conn = sqlite3.connect(m_db)
    conn.execute("UPDATE Information SET schemaVersionMajor = 4")
    conn.commit()
    conn.close()
    failed = export(engine_ctx, path=str(m_db))
    assert failed["status"] == "failed"
    assert failed["error"].startswith("Engine Library version 4.")


def test_status_reports_the_library(
    engine_ctx: EngineContext, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setattr(engine_dj, "find_database", lambda home=None: tmp_path / "m.db")
    status = call(engine_ctx, "export.engineDjStatus")
    assert status == {"collectionPath": str(tmp_path / "m.db"), "running": False}


def test_a_wal_database_keeps_its_mode_and_leaves_no_temporary_files(
    engine_ctx: EngineContext, library: dict[str, int], m_db: Path
) -> None:
    conn = sqlite3.connect(m_db)
    assert conn.execute("PRAGMA journal_mode = WAL").fetchone()[0] == "wal"
    conn.close()  # a clean close folds the WAL back and removes it
    assert not (m_db.parent / "m.db-wal").exists()
    before = set(m_db.parent.iterdir())
    done(engine_ctx, path=str(m_db), simulate=False)
    assert set(m_db.parent.iterdir()) == before
    conn = sqlite3.connect(m_db)
    assert conn.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
    assert conn.execute("SELECT key FROM Track WHERE id = 1").fetchone()[0] == 1
    conn.close()


def test_a_cancelled_export_leaves_the_library_untouched(
    engine_ctx: EngineContext, library: dict[str, int], m_db: Path
) -> None:
    from tonalia_engine.rpc_schema import ExportOptions

    class StopError(Exception):
        pass

    def cancel() -> None:
        raise StopError

    before = m_db.read_bytes()
    files = set(m_db.parent.iterdir())
    with pytest.raises(StopError):
        engine_dj.export_engine_dj(
            engine_ctx.db,
            ExportOptions(path=str(m_db), simulate=False),
            m_db.parent.parent / "backups",
            cancel,
        )
    assert m_db.read_bytes() == before
    assert set(m_db.parent.iterdir()) == files


def test_refuses_a_schema_without_the_playlist_triggers(
    engine_ctx: EngineContext, library: dict[str, int], m_db: Path
) -> None:
    conn = sqlite3.connect(m_db)
    conn.execute("DROP TRIGGER trigger_after_insert_List")
    conn.commit()
    conn.close()
    failed = export(engine_ctx, path=str(m_db))
    assert failed["status"] == "failed"
    assert "missing trigger_after_insert_List" in failed["error"]
