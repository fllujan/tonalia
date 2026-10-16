# ruff: noqa: E501  (the history fixtures keep each program's one-line elements)
"""Play history (SPEC 13.4): each program's history, the table columns and filters, sets
marked by hand, and the set builder and the Pro ideas leaving recent tracks out.

Every history here is written by hand in the shape each program stores it (see the
docstring of ``tonalia_engine/history.py``); none comes from a Tonalia writer.
"""

from __future__ import annotations

import sqlite3
import struct
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any
from urllib.parse import quote

import pytest

from tests.test_analysis_queue import call, wait_job
from tests.test_export_rekordbox import add_track
from tonalia_engine import history
from tonalia_engine.import_ import service
from tonalia_engine.import_ import traktor as traktor_reader
from tonalia_engine.server import EngineContext, build_dispatcher

VOLUME = "Macintosh HD"
NOW = datetime.now(UTC).replace(microsecond=0)


@pytest.fixture(autouse=True)
def programs_closed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(service, "running", lambda source: False)
    monkeypatch.setattr(traktor_reader, "root_volume_name", lambda: VOLUME)
    monkeypatch.setattr(history, "root_volume_name", lambda: VOLUME)


@pytest.fixture
def music(tmp_path: Path) -> Path:
    return tmp_path / "Música ñ" / "🎧 Sets"


@pytest.fixture
def lib(engine_ctx: EngineContext, music: Path) -> dict[str, int]:
    def track(name: str, key: tuple[int, str], bpm: float, energy: int) -> int:
        return add_track(
            engine_ctx, music / name, title=name.rsplit(".", 1)[0], key=key, bpm=bpm,
            energy=energy, duration=360.0,
        )  # fmt: skip

    return {
        "bloom": track("Midnight Bloom.mp3", (9, "minor"), 124.0, 7),
        "tide": track("Golden Hour Tide.flac", (4, "minor"), 124.0, 6),
        "neon": track("Neon Cathedral.aiff", (0, "major"), 126.0, 8),
        "velvet": track("Velvet Static.mp3", (2, "minor"), 122.0, 5),
    }


def error(ctx: EngineContext, method: str, params: Any) -> dict[str, Any]:
    import json

    out = build_dispatcher(ctx).handle_line(
        json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
    )
    assert out is not None
    reply = json.loads(out)
    assert "error" in reply, reply
    return dict(reply["error"])


def run_import(ctx: EngineContext, source: str, path: Path) -> dict[str, Any]:
    job = call(ctx, "history.import", {"source": source, "path": str(path)})
    finished = wait_job(ctx, job["jobId"])
    assert finished["status"] == "done", finished
    return dict(finished["result"])


def rows(ctx: EngineContext, **query: Any) -> dict[str, dict[str, Any]]:
    page = call(ctx, "library.list", {"limit": 100, **query})
    return {item["title"]: item for item in page["items"]}


# ---- the hand-made histories ----


def traktor_history(folder: Path, music: Path, when: datetime) -> Path:
    local = when.astimezone()
    history_dir = folder / "Traktor 3.11.1" / "History"
    history_dir.mkdir(parents=True)
    packed = (local.year << 16) | (local.month << 8) | local.day
    seconds = local.hour * 3600 + local.minute * 60 + local.second
    directory = "/:" + "/:".join(music.parts[1:]) + "/:"

    def entry(name: str, offset: int, public: str = "1") -> str:
        return (
            f'<ENTRY TITLE="{name}"><LOCATION DIR="{directory}" FILE="{name}" VOLUME="{VOLUME}" VOLUMEID="{VOLUME}"></LOCATION>'
            f'<EXTENDEDDATA DECK="1" DURATION="300" EXTENDEDTYPE="HistoryData" PLAYEDPUBLIC="{public}" STARTDATE="{packed}" STARTTIME="{seconds + offset}"></EXTENDEDDATA></ENTRY>'
        )

    name = local.strftime("history_%Yy%mm%dd_%Hh%Mm%Ss.nml")
    (history_dir / name).write_text(
        '<?xml version="1.0" encoding="UTF-8" standalone="no" ?>\n'
        '<NML VERSION="19"><HEAD COMPANY="www.native-instruments.com" PROGRAM="Traktor"></HEAD>'
        '<COLLECTION ENTRIES="4">'
        + entry("Golden Hour Tide.flac", 300)
        + entry("Midnight Bloom.mp3", 0)
        + entry("Neon Cathedral.aiff", 400, public="0")  # only on the headphones
        + entry("Not In Library.mp3", 600)
        + "</COLLECTION></NML>\n",
        encoding="utf-8",
    )
    (history_dir.parent / "collection.nml").write_text("<NML/>", encoding="utf-8")
    return history_dir


def rekordbox_history(path: Path, music: Path, day: date) -> Path:
    def location(name: str) -> str:
        return "file://localhost" + quote((music / name).as_posix())

    path.write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n<DJ_PLAYLISTS Version="1.0.0">'
        '<PRODUCT Name="rekordbox" Version="6.8.5" Company="AlphaTheta"/>'
        '<COLLECTION Entries="3">'
        f'<TRACK TrackID="11" Name="Midnight Bloom" Location="{location("Midnight Bloom.mp3")}" PlayCount="9"/>'
        f'<TRACK TrackID="12" Name="Velvet Static" Location="{location("Velvet Static.mp3")}"/>'
        f'<TRACK TrackID="13" Name="Neon Cathedral" Location="{location("Neon Cathedral.aiff")}"/>'
        "</COLLECTION><PLAYLISTS>"
        '<NODE Type="0" Name="ROOT" Count="2">'
        '<NODE Type="0" Name="HISTORY" Count="1">'
        f'<NODE Name="HISTORY {day.isoformat()}" Type="1" KeyType="0" Entries="3">'
        '<TRACK Key="12"/><TRACK Key="11"/><TRACK Key="12"/></NODE>'
        "</NODE>"
        '<NODE Name="Peak time" Type="1" KeyType="0" Entries="1"><TRACK Key="13"/></NODE>'
        "</NODE></PLAYLISTS></DJ_PLAYLISTS>\n",
        encoding="utf-8",
    )
    return path


def _rec(tag: bytes, body: bytes) -> bytes:
    return tag + struct.pack(">I", len(body)) + body


def _field(number: int, value: bytes) -> bytes:
    return struct.pack(">II", number, len(value)) + value


def serato_history(folder: Path, music: Path, start: datetime) -> Path:
    sessions = folder / "_Serato_" / "History" / "Sessions"
    sessions.mkdir(parents=True)

    def entry(name: str, offset: int, played: int = 1) -> bytes:
        at = int(start.timestamp()) + offset
        adat = (
            _field(1, struct.pack(">I", offset))
            + _field(2, (music / name).as_posix().encode("utf-16-be") + b"\x00\x00")
            + _field(6, name.encode("utf-16-be"))
            + _field(28, struct.pack(">I", at))
            + _field(29, struct.pack(">I", at + 240))
            + _field(31, struct.pack(">I", 1))
            + _field(50, bytes([played]))
        )
        return _rec(b"oent", _rec(b"adat", adat))

    data = (
        _rec(b"vrsn", "1.0/Serato Scratch LIVE Review".encode("utf-16-be"))
        + entry("Velvet Static.mp3", 0)
        + entry("Neon Cathedral.aiff", 250, played=0)  # loaded, never played
        + entry("Neon Cathedral.aiff", 500)
    )
    (sessions / "17.session").write_bytes(data)
    (sessions / "18.session").write_bytes(b"oent\xff\xff\xff\xffbroken")
    return sessions


def virtualdj_history(folder: Path, music: Path, start: datetime) -> Path:
    local = start.astimezone()
    day_dir = folder / "VirtualDJ" / "History" / f"{local.year}" / f"{local.month:02d}"
    day_dir.mkdir(parents=True)
    lines = ["#EXTM3U"]
    for n, name in enumerate(["Neon Cathedral.aiff", "Golden Hour Tide.flac"]):
        lines.append(
            f"#EXTVDJ:<time>{local:%H:%M}</time><lastplaytime>{int(start.timestamp()) + 300 * n}</lastplaytime><artist>Kairo</artist><title>{name}</title>"
        )
        lines.append(str(music / name))
    (day_dir / f"{local.day:02d}.m3u").write_text("\n".join(lines) + "\n", encoding="utf-8")
    (folder / "VirtualDJ" / "database.xml").write_text("<VirtualDJ_Database/>", encoding="utf-8")
    return folder / "VirtualDJ"


def engine_history(folder: Path, music: Path, start: datetime) -> Path:
    database2 = folder / "Engine Library" / "Database2"
    database2.mkdir(parents=True)
    relative = "../" + music.relative_to(folder).as_posix()
    sqlite3.connect(database2 / "m.db").close()
    conn = sqlite3.connect(database2 / "hm.db")
    conn.executescript(
        "CREATE TABLE Track (id INTEGER PRIMARY KEY, path TEXT, filename TEXT);"
        "CREATE TABLE Historylist (id INTEGER PRIMARY KEY, sessionId INTEGER, title TEXT, startTime INTEGER, timezone TEXT);"
        "CREATE TABLE HistorylistEntity (id INTEGER PRIMARY KEY, listId INTEGER, trackId INTEGER, startTime INTEGER);"
    )
    conn.executemany(
        "INSERT INTO Track (id, path, filename) VALUES (?, ?, ?)",
        [(1, f"{relative}/Midnight Bloom.mp3", "Midnight Bloom.mp3"),
         (2, f"{relative}/Velvet Static.mp3", "Velvet Static.mp3")],
    )  # fmt: skip
    t = int(start.timestamp())
    conn.execute("INSERT INTO Historylist VALUES (1, 1, 'Viernes', ?, 'Europe/Madrid')", (t,))
    conn.executemany(
        "INSERT INTO HistorylistEntity (listId, trackId, startTime) VALUES (1, ?, ?)",
        [(2, t + 10), (1, t + 400)],
    )
    conn.commit()
    conn.close()
    return database2 / "m.db"


# ---- each program ----


def test_traktor_history_shows_in_the_table_and_counts_only_public_plays(
    engine_ctx: EngineContext, lib: dict[str, int], music: Path, tmp_path: Path
) -> None:
    when = NOW - timedelta(days=3)
    folder = traktor_history(tmp_path / "NI", music, when)
    result = run_import(engine_ctx, "traktor", folder.parent / "collection.nml")
    assert result["sessions"] == 1 and result["newSessions"] == 1
    assert result["plays"] == 2 and result["tracks"] == 2
    assert result["unmatched"] == 1
    assert result["unmatchedPaths"][0].endswith("Not In Library.mp3")
    table = rows(engine_ctx)
    assert table["Midnight Bloom"]["timesPlayed"] == 1
    assert table["Midnight Bloom"]["lastPlayed"] == history.iso(when)
    assert table["Golden Hour Tide"]["lastPlayed"] == history.iso(when + timedelta(seconds=300))
    assert table["Neon Cathedral"]["timesPlayed"] == 0  # heard on the headphones only
    assert table["Neon Cathedral"]["lastPlayed"] is None
    sessions = call(engine_ctx, "history.list", {})
    assert sessions["total"] == 1 and sessions["plays"] == 2 and sessions["playedTracks"] == 2
    session = sessions["sessions"][0]
    assert session["program"] == "traktor" and session["source"] == "import"
    assert session["startedAt"] == history.iso(when)
    # The session reads like a read-only playlist, in the order it was played.
    played = call(
        engine_ctx,
        "library.list",
        {"sessionId": session["id"], "sort": "position", "descending": False},
    )
    assert [t["title"] for t in played["items"]] == ["Midnight Bloom", "Golden Hour Tide"]


def test_importing_again_brings_the_session_up_to_date_without_counting_twice(
    engine_ctx: EngineContext, lib: dict[str, int], music: Path, tmp_path: Path
) -> None:
    folder = traktor_history(tmp_path / "NI", music, NOW - timedelta(days=3))
    run_import(engine_ctx, "traktor", folder)
    again = run_import(engine_ctx, "traktor", folder)
    assert again["sessions"] == 1 and again["newSessions"] == 0
    assert rows(engine_ctx)["Midnight Bloom"]["timesPlayed"] == 1
    assert call(engine_ctx, "history.list", {})["plays"] == 2


def test_rekordbox_history_playlists_and_the_play_counter(
    engine_ctx: EngineContext, lib: dict[str, int], music: Path, tmp_path: Path
) -> None:
    day = (NOW - timedelta(days=40)).astimezone().date()
    xml = rekordbox_history(tmp_path / "rekordbox.xml", music, day)
    engine_ctx.db.conn.execute(
        "UPDATE tracks SET play_count = 9 WHERE id = ?", (lib["bloom"],)
    )  # brought by an earlier import of the collection (SPEC 13.1)
    result = run_import(engine_ctx, "rekordbox", xml)
    assert result["sessions"] == 1 and result["plays"] == 3 and result["tracks"] == 2
    table = rows(engine_ctx)
    assert table["Velvet Static"]["timesPlayed"] == 2
    # The program's counter is higher than its history: it wins, and is not added twice.
    assert table["Midnight Bloom"]["timesPlayed"] == 9
    assert table["Velvet Static"]["lastPlayed"].startswith(history.iso(history._local(day))[:10])
    # Regular playlists are not history.
    assert table["Neon Cathedral"]["timesPlayed"] == 0
    session = call(engine_ctx, "history.list", {})["sessions"][0]
    assert session["name"] == f"HISTORY {day.isoformat()}" and session["tracks"] == 3


def test_serato_sessions_skip_tracks_loaded_but_not_played_and_survive_a_broken_file(
    engine_ctx: EngineContext, lib: dict[str, int], music: Path, tmp_path: Path
) -> None:
    start = NOW - timedelta(days=1)
    sessions = serato_history(tmp_path, music, start)
    result = run_import(engine_ctx, "serato", sessions.parent.parent)
    assert result["sessions"] == 1 and result["plays"] == 2
    assert [w["code"] for w in result["warnings"]] == ["unreadable_file"]
    table = rows(engine_ctx)
    assert table["Velvet Static"]["lastPlayed"] == history.iso(start)
    assert table["Neon Cathedral"]["timesPlayed"] == 1
    assert table["Neon Cathedral"]["lastPlayed"] == history.iso(start + timedelta(seconds=500))


def test_virtualdj_daily_lists(
    engine_ctx: EngineContext, lib: dict[str, int], music: Path, tmp_path: Path
) -> None:
    start = NOW - timedelta(days=5)
    folder = virtualdj_history(tmp_path, music, start)
    result = run_import(engine_ctx, "virtualdj", folder / "database.xml")
    assert result["sessions"] == 1 and result["plays"] == 2
    table = rows(engine_ctx)
    assert table["Neon Cathedral"]["lastPlayed"] == history.iso(start)
    assert table["Golden Hour Tide"]["lastPlayed"] == history.iso(start + timedelta(seconds=300))


def test_engine_dj_history_database(
    engine_ctx: EngineContext, lib: dict[str, int], music: Path, tmp_path: Path
) -> None:
    start = NOW - timedelta(days=2)
    m_db = engine_history(tmp_path, music, start)
    result = run_import(engine_ctx, "engine_dj", m_db.parent.parent)
    assert result["sessions"] == 1 and result["plays"] == 2, result
    session = call(engine_ctx, "history.list", {})["sessions"][0]
    assert session["name"] == "Viernes" and session["program"] == "engine_dj"
    played = call(
        engine_ctx,
        "library.list",
        {"sessionId": session["id"], "sort": "position", "descending": False},
    )
    assert [t["title"] for t in played["items"]] == ["Velvet Static", "Midnight Bloom"]


def test_a_folder_moved_to_another_disk_is_still_matched(
    engine_ctx: EngineContext, lib: dict[str, int], music: Path, tmp_path: Path
) -> None:
    old = Path("/Volumes/Viejo/Música/🎧 Sets")
    day = (NOW - timedelta(days=1)).astimezone().date()
    xml = rekordbox_history(tmp_path / "rekordbox.xml", old, day)
    result = run_import(engine_ctx, "rekordbox", xml)
    assert result["plays"] == 3 and result["unmatched"] == 0


def test_a_missing_history_is_a_coded_error(engine_ctx: EngineContext, tmp_path: Path) -> None:
    job = call(engine_ctx, "history.import", {"source": "traktor", "path": str(tmp_path / "nope")})
    finished = wait_job(engine_ctx, job["jobId"])
    assert finished["status"] == "failed"
    assert finished["errorInfo"]["reason"] == "collection_not_found"
    err = error(engine_ctx, "library.list", {"sessionId": 99})
    assert err["data"]["reason"] == "session_not_found"


# ---- by hand ----


def test_mark_a_playlist_as_played_and_forget_it(
    engine_ctx: EngineContext, lib: dict[str, int]
) -> None:
    playlist = call(engine_ctx, "playlists.create", {"name": "Bolo sábado", "isFolder": False})
    call(
        engine_ctx,
        "playlists.addTracks",
        {"playlistId": playlist["id"], "trackIds": [lib["neon"], lib["tide"]]},
    )
    day = (NOW - timedelta(days=10)).astimezone().date().isoformat()
    marked = call(engine_ctx, "history.markPlayed", {"playlistId": playlist["id"], "playedAt": day})
    assert marked["plays"] == 2
    session = call(engine_ctx, "history.list", {})["sessions"][0]
    assert session["source"] == "manual" and session["program"] is None
    assert session["name"] == "Bolo sábado"
    table = rows(engine_ctx)
    assert table["Neon Cathedral"]["timesPlayed"] == 1
    assert table["Neon Cathedral"]["lastPlayed"][:10] <= day
    # A play marked by hand adds to the program's counter.
    engine_ctx.db.conn.execute("UPDATE tracks SET play_count = 4 WHERE id = ?", (lib["tide"],))
    assert rows(engine_ctx)["Golden Hour Tide"]["timesPlayed"] == 5
    call(engine_ctx, "history.deleteSession", {"sessionId": marked["sessionId"]})
    assert rows(engine_ctx)["Neon Cathedral"]["timesPlayed"] == 0
    assert call(engine_ctx, "history.list", {})["total"] == 0
    err = error(engine_ctx, "history.deleteSession", {"sessionId": marked["sessionId"]})
    assert err["data"]["reason"] == "session_not_found"


def test_marking_checks_its_input(engine_ctx: EngineContext, lib: dict[str, int]) -> None:
    future = (NOW + timedelta(days=5)).date().isoformat()
    err = error(engine_ctx, "history.markPlayed", {"trackIds": [lib["bloom"]], "playedAt": future})
    assert err["data"]["reason"] == "invalid_params"
    err = error(engine_ctx, "history.markPlayed", {"trackIds": [999]})
    assert err["data"]["reason"] == "track_not_found"
    err = error(engine_ctx, "history.markPlayed", {"trackIds": []})
    assert err["data"]["reason"] == "invalid_params"
    marked = call(engine_ctx, "history.markPlayed", {"trackIds": [lib["bloom"], lib["bloom"]]})
    assert marked["plays"] == 1


# ---- filters, smart playlists and order ----


def mark(ctx: EngineContext, ids: list[int], days_ago: int, times: int = 1) -> None:
    day = (NOW - timedelta(days=days_ago)).astimezone().date().isoformat()
    for _ in range(times):
        call(ctx, "history.markPlayed", {"trackIds": ids, "playedAt": day})


def test_filters_and_sorting_by_plays(engine_ctx: EngineContext, lib: dict[str, int]) -> None:
    mark(engine_ctx, [lib["bloom"]], 2, times=3)
    mark(engine_ctx, [lib["tide"]], 45)
    not_recent = rows(engine_ctx, filter={"notPlayedDays": 30})
    assert set(not_recent) == {"Golden Hour Tide", "Neon Cathedral", "Velvet Static"}
    recent = rows(engine_ctx, filter={"playedDays": 7})
    assert set(recent) == {"Midnight Bloom"}
    most = rows(engine_ctx, filter={"minPlays": 2})
    assert set(most) == {"Midnight Bloom"}
    page = call(engine_ctx, "library.list", {"sort": "times_played", "descending": True})
    assert [t["title"] for t in page["items"]][:2] == ["Midnight Bloom", "Golden Hour Tide"]
    page = call(engine_ctx, "library.list", {"sort": "last_played", "descending": True})
    assert page["items"][0]["title"] == "Midnight Bloom"
    # A smart playlist keeps the condition (and counts it in the sidebar).
    smart = call(
        engine_ctx, "playlists.create",
        {"name": "No tocados en 30 días", "isFolder": False, "smart": {"notPlayedDays": 30}},
    )  # fmt: skip
    assert smart["trackCount"] == 3


# ---- the set builder and the Pro ideas ----


def test_the_builder_and_the_ideas_leave_out_recent_tracks(
    engine_ctx: EngineContext, lib: dict[str, int]
) -> None:
    mark(engine_ctx, [lib["tide"]], 3)
    base = {"pool": {"library": True}, "count": 4}
    full = call(engine_ctx, "builder.generate", base)
    assert len(full["items"]) == 4 and full["playedRecently"] == 0
    avoided = call(engine_ctx, "builder.generate", {**base, "avoidPlayedDays": 7})
    assert avoided["playedRecently"] == 1
    assert "Golden Hour Tide" not in [i["track"]["title"] for i in avoided["items"]]
    # Played longer ago than the window: it stays.
    longer = call(engine_ctx, "builder.generate", {**base, "avoidPlayedDays": 2})
    assert longer["playedRecently"] == 0 and len(longer["items"]) == 4
    # The chosen first track always stays.
    first = call(
        engine_ctx, "builder.generate", {**base, "avoidPlayedDays": 7, "startTrackId": lib["tide"]}
    )
    assert first["items"][0]["track"]["title"] == "Golden Hour Tide"
    ideas = call(engine_ctx, "suggest.mixouts", {"trackId": lib["bloom"], "avoidPlayedDays": 7})
    assert ideas["playedRecently"] == 1
    assert lib["tide"] not in [s["track"]["id"] for s in ideas["items"]]
    alternatives = call(
        engine_ctx, "builder.alternatives",
        {"trackIds": [lib["bloom"], lib["neon"]], "position": 1, "avoidPlayedDays": 7},
    )  # fmt: skip
    assert lib["tide"] not in [a["track"]["id"] for a in alternatives["items"]]


def test_merging_duplicates_moves_the_plays(engine_ctx: EngineContext, lib: dict[str, int]) -> None:
    from tonalia_engine import duplicates

    mark(engine_ctx, [lib["velvet"]], 1)
    conn = engine_ctx.db.conn
    conn.executemany(
        "INSERT INTO duplicate_groups (group_id, track_id, kind) VALUES ('audio:x', ?, 'audio')",
        [(lib["bloom"],), (lib["velvet"],)],
    )
    duplicates.merge(engine_ctx.db, "audio:x", lib["bloom"], None)
    bloom = rows(engine_ctx)["Midnight Bloom"]
    assert bloom["timesPlayed"] == 1 and bloom["lastPlayed"] is not None
