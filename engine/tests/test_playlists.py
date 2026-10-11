"""Playlists, folders, smart playlists and M3U (SPEC 2.11) through RPC."""

import wave
from pathlib import Path
from typing import Any

import pytest

from tests.test_analysis_queue import call
from tests.test_track_update import call_error
from tonalia_engine.server import EngineContext

TRACKS: list[dict[str, Any]] = [
    # title, genre, status, key (root, mode), bpm, energy, quality flags
    {"title": "Midnight Bloom", "genre": "Melodic House", "key": (9, "minor"), "bpm": 124.0,
     "energy": 7},
    {"title": "Golden Hour Tide", "genre": "deep house", "key": (4, "minor"), "bpm": 124.0,
     "energy": 6},
    {"title": "Neon Cathedral", "genre": "Techno", "key": (0, "major"), "bpm": 126.0,
     "energy": 8, "flags": ["clipping"]},
    {"title": "Cobalt Rain", "genre": "Drum & Bass", "key": (0, "minor"), "bpm": 174.0,
     "energy": 8},
    {"title": "Paper Satellites", "genre": "Downtempo", "key": (1, "major"), "bpm": 86.0,
     "energy": 4},
    {"title": "Sin analizar ñ", "genre": None, "status": "pending"},
]  # fmt: skip


def seed(ctx: EngineContext, folder: Path) -> list[int]:
    folder.mkdir(parents=True, exist_ok=True)
    ids: list[int] = []
    conn = ctx.db.conn
    for i, t in enumerate(TRACKS):
        path = folder / f"{i:02d} {t['title']} 🎧.mp3"
        cur = conn.execute(
            "INSERT INTO tracks (path, title, artist, genre, duration, status, display_title,"
            " search_text) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (
                str(path),
                t["title"],
                f"Artist {i}",
                t["genre"],
                300.0 + i,
                t.get("status", "ready"),
                t["title"],
                t["title"].lower(),
            ),
        )
        tid = int(cur.lastrowid or 0)
        ids.append(tid)
        if "key" in t:
            conn.execute(
                "INSERT INTO analysis (track_id, key_root, key_mode, bpm, energy, quality_flags)"
                " VALUES (?, ?, ?, ?, ?, ?)",
                (
                    tid,
                    t["key"][0],
                    t["key"][1],
                    t["bpm"],
                    t["energy"],
                    "[" + ",".join(f'"{f}"' for f in t.get("flags", [])) + "]",
                ),
            )
    return ids


@pytest.fixture
def ids(engine_ctx: EngineContext, tmp_path: Path) -> list[int]:
    return seed(engine_ctx, tmp_path / "Música ñ")


def create(ctx: EngineContext, name: str, **extra: Any) -> dict[str, Any]:
    result: dict[str, Any] = call(ctx, "playlists.create", {"name": name, **extra})
    return result


def tree(ctx: EngineContext) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = call(ctx, "playlists.tree")["playlists"]
    return result


def titles(ctx: EngineContext, query: dict[str, Any]) -> list[str]:
    page = call(ctx, "library.list", {"sort": "title", "descending": False, **query})
    return [item["title"] for item in page["items"]]


def playlist_titles(ctx: EngineContext, playlist_id: int) -> list[str]:
    page = call(ctx, "library.list", {"playlistId": playlist_id, "sort": "position",
                                      "descending": False})  # fmt: skip
    return [item["title"] or Path(item["path"]).stem for item in page["items"]]


# ---- tree ----


def test_nested_folders_and_playlists_with_emoji(engine_ctx: EngineContext) -> None:
    gigs = create(engine_ctx, "Bolos", emoji="📁", isFolder=True)
    warm = create(engine_ctx, "Warm-up Ibiza", emoji="🌅", parentId=gigs["id"])
    peak = create(engine_ctx, "Peak time", emoji="🔥", parentId=gigs["id"])
    inner = create(engine_ctx, "Más", isFolder=True, parentId=gigs["id"])
    deep = create(engine_ctx, "Profundo 🌊", parentId=inner["id"])
    loose = create(engine_ctx, "Por probar", emoji="🧪")

    nodes = tree(engine_ctx)
    assert [n["id"] for n in nodes] == [
        gigs["id"], warm["id"], peak["id"], inner["id"], deep["id"], loose["id"],
    ]  # fmt: skip
    assert nodes[1] == {
        "id": warm["id"],
        "parentId": gigs["id"],
        "name": "Warm-up Ibiza",
        "emoji": "🌅",
        "isFolder": False,
        "sortOrder": 0,
        "smart": None,
        "trackCount": 0,
    }
    assert [n["sortOrder"] for n in nodes if n["parentId"] == gigs["id"]] == [0, 1, 2]


def test_create_rejects_bad_parents_and_names(engine_ctx: EngineContext) -> None:
    plain = create(engine_ctx, "Plana")
    assert call_error(engine_ctx, "playlists.create",
                      {"name": "Dentro", "parentId": plain["id"]})["code"] == -32602  # fmt: skip
    assert call_error(engine_ctx, "playlists.create",
                      {"name": "X", "parentId": 999})["code"] == -32602  # fmt: skip
    assert call_error(engine_ctx, "playlists.create", {"name": "   "})["code"] == -32602
    smart_folder = {"name": "X", "isFolder": True, "smart": {"energyMin": 8}}
    assert call_error(engine_ctx, "playlists.create", smart_folder)["code"] == -32602
    assert create(engine_ctx, "  Espacios  ")["name"] == "Espacios"


def test_update_renames_and_changes_emoji(engine_ctx: EngineContext) -> None:
    node = create(engine_ctx, "Radio", emoji="🎙️")
    renamed = call(engine_ctx, "playlists.update", {"playlistId": node["id"], "name": "Show"})
    assert (renamed["name"], renamed["emoji"]) == ("Show", "🎙️")
    cleared = call(engine_ctx, "playlists.update", {"playlistId": node["id"], "emoji": ""})
    assert cleared["emoji"] is None
    # A regular playlist cannot become smart (its tracks would be lost silently).
    bad = {"playlistId": node["id"], "smart": {"energyMin": 5}}
    assert call_error(engine_ctx, "playlists.update", bad)["code"] == -32602
    assert call_error(engine_ctx, "playlists.update", {"playlistId": 404})["code"] == -32602


def test_move_reorders_and_reparents(engine_ctx: EngineContext) -> None:
    a = create(engine_ctx, "A")
    b = create(engine_ctx, "B")
    c = create(engine_ctx, "C")
    folder = create(engine_ctx, "Carpeta", isFolder=True)

    nodes = call(engine_ctx, "playlists.move", {"playlistId": c["id"], "index": 0})["playlists"]
    assert [n["name"] for n in nodes] == ["C", "A", "B", "Carpeta"]
    call(engine_ctx, "playlists.move", {"playlistId": a["id"], "parentId": folder["id"],
                                        "index": 0})  # fmt: skip
    call(engine_ctx, "playlists.move", {"playlistId": b["id"], "parentId": folder["id"],
                                        "index": 0})  # fmt: skip
    nodes = tree(engine_ctx)
    assert [(n["name"], n["sortOrder"]) for n in nodes] == [
        ("C", 0), ("Carpeta", 1), ("B", 0), ("A", 1),
    ]  # fmt: skip
    # Index past the end appends.
    call(engine_ctx, "playlists.move", {"playlistId": c["id"], "index": 99})
    assert [n["name"] for n in tree(engine_ctx) if n["parentId"] is None] == ["Carpeta", "C"]


def test_move_refuses_cycles_and_non_folder_parents(engine_ctx: EngineContext) -> None:
    outer = create(engine_ctx, "Fuera", isFolder=True)
    inner = create(engine_ctx, "Dentro", isFolder=True, parentId=outer["id"])
    plain = create(engine_ctx, "Plana")
    for parent in (outer["id"], inner["id"]):
        err = call_error(engine_ctx, "playlists.move",
                         {"playlistId": outer["id"], "parentId": parent, "index": 0})  # fmt: skip
        assert err["code"] == -32602
    err = call_error(engine_ctx, "playlists.move",
                     {"playlistId": inner["id"], "parentId": plain["id"], "index": 0})  # fmt: skip
    assert err["code"] == -32602


def test_delete_folder_removes_nested_playlists_not_tracks(
    engine_ctx: EngineContext, ids: list[int]
) -> None:
    folder = create(engine_ctx, "Bolos", isFolder=True)
    child = create(engine_ctx, "Peak", parentId=folder["id"])
    sub = create(engine_ctx, "Sub", isFolder=True, parentId=folder["id"])
    create(engine_ctx, "Hoja", parentId=sub["id"])
    keep = create(engine_ctx, "Queda")
    call(engine_ctx, "playlists.addTracks", {"playlistId": child["id"], "trackIds": ids[:2]})

    result = call(engine_ctx, "playlists.delete", {"playlistId": folder["id"]})
    assert result == {"deleted": 4}
    assert [n["id"] for n in tree(engine_ctx)] == [keep["id"]]
    assert call(engine_ctx, "library.list", {})["total"] == len(TRACKS)


# ---- regular playlist tracks ----


def test_add_insert_remove_and_reorder_tracks(engine_ctx: EngineContext, ids: list[int]) -> None:
    pl = create(engine_ctx, "Set 🌙")["id"]
    added = call(engine_ctx, "playlists.addTracks", {"playlistId": pl, "trackIds": ids[:3]})
    assert added == {"changed": 3, "trackCount": 3}
    # Insert at a position; tracks already in the playlist are skipped.
    added = call(engine_ctx, "playlists.addTracks",
                 {"playlistId": pl, "trackIds": [ids[4], ids[0]], "index": 1})  # fmt: skip
    assert added == {"changed": 1, "trackCount": 4}
    assert playlist_titles(engine_ctx, pl) == [
        "Midnight Bloom", "Paper Satellites", "Golden Hour Tide", "Neon Cathedral",
    ]  # fmt: skip

    # Move the last two (in playlist order) to the front.
    moved = call(engine_ctx, "playlists.reorderTracks",
                 {"playlistId": pl, "trackIds": [ids[2], ids[1]], "index": 0})  # fmt: skip
    assert moved == {"changed": 2, "trackCount": 4}
    assert playlist_titles(engine_ctx, pl) == [
        "Golden Hour Tide", "Neon Cathedral", "Midnight Bloom", "Paper Satellites",
    ]  # fmt: skip
    # No index: move to the end.
    call(engine_ctx, "playlists.reorderTracks", {"playlistId": pl, "trackIds": [ids[1]]})
    assert playlist_titles(engine_ctx, pl)[-1] == "Golden Hour Tide"

    removed = call(engine_ctx, "playlists.removeTracks",
                   {"playlistId": pl, "trackIds": [ids[0], ids[5]]})  # fmt: skip
    assert removed == {"changed": 1, "trackCount": 3}
    assert tree(engine_ctx)[0]["trackCount"] == 3

    # Removing a track from the library drops it from its playlists.
    call(engine_ctx, "library.remove", {"trackIds": [ids[4]]})
    assert playlist_titles(engine_ctx, pl) == ["Neon Cathedral", "Golden Hour Tide"]
    # And the playlist stays consistent for later inserts.
    call(engine_ctx, "playlists.addTracks", {"playlistId": pl, "trackIds": [ids[3]], "index": 1})
    assert playlist_titles(engine_ctx, pl) == ["Neon Cathedral", "Cobalt Rain", "Golden Hour Tide"]


def test_track_edits_refuse_folders_smart_and_unknown(
    engine_ctx: EngineContext, ids: list[int]
) -> None:
    folder = create(engine_ctx, "Carpeta", isFolder=True)["id"]
    smart = create(engine_ctx, "Alta", smart={"energyMin": 8})["id"]
    pl = create(engine_ctx, "Normal")["id"]
    for target in (folder, smart, 404):
        err = call_error(engine_ctx, "playlists.addTracks",
                         {"playlistId": target, "trackIds": ids[:1]})  # fmt: skip
        assert err["code"] == -32602
    err = call_error(engine_ctx, "playlists.addTracks", {"playlistId": pl, "trackIds": [9999]})
    assert err["code"] == -32602
    assert call_error(engine_ctx, "library.list", {"playlistId": folder})["code"] == -32602


def test_position_sort_outside_playlists_falls_back(
    engine_ctx: EngineContext, ids: list[int]
) -> None:
    page = call(engine_ctx, "library.list", {"sort": "position"})
    assert page["total"] == len(TRACKS)


# ---- smart playlists and filters ----


@pytest.mark.parametrize(
    ("condition", "expected"),
    [
        ({"keys": [{"root": 9, "mode": "minor"}]}, ["Midnight Bloom"]),
        # From 8A: 7A/9A (±1), 8B (relative), 9B (diagonal), 10A (+2), 3A (+7).
        (
            {"keys": [{"root": 9, "mode": "minor"}], "compatible": True},
            ["Golden Hour Tide", "Midnight Bloom", "Neon Cathedral"],
        ),
        ({"bpmMin": 123, "bpmMax": 125}, ["Golden Hour Tide", "Midnight Bloom"]),
        (
            {"bpmMin": 170, "bpmMax": 176, "bpmHalfDouble": True},
            ["Cobalt Rain", "Paper Satellites"],
        ),
        ({"energyMin": 8}, ["Cobalt Rain", "Neon Cathedral"]),
        ({"energyMin": 5, "energyMax": 6}, ["Golden Hour Tide"]),
        ({"genres": ["DEEP HOUSE", "techno"]}, ["Golden Hour Tide", "Neon Cathedral"]),
        ({"statuses": ["pending"]}, ["Sin analizar ñ"]),
        ({"qualityIssues": True}, ["Neon Cathedral"]),
        ({"energyMin": 8, "genres": ["techno"]}, ["Neon Cathedral"]),
    ],
)
def test_filters(
    engine_ctx: EngineContext, ids: list[int], condition: dict[str, Any], expected: list[str]
) -> None:
    assert titles(engine_ctx, {"filter": condition}) == expected
    smart = create(engine_ctx, "Inteligente", emoji="🔮", smart=condition)
    assert smart["smart"] is not None and smart["trackCount"] == len(expected)
    assert titles(engine_ctx, {"playlistId": smart["id"]}) == expected


def test_favorites_filter(engine_ctx: EngineContext, ids: list[int]) -> None:
    engine_ctx.db.conn.execute(
        "INSERT INTO favorites (track_a, track_b, mode) VALUES (?, ?, 'mashup')", (ids[0], ids[2])
    )
    assert titles(engine_ctx, {"filter": {"favorites": True}}) == [
        "Midnight Bloom", "Neon Cathedral",
    ]  # fmt: skip


def test_smart_playlist_combines_with_search_and_updates(
    engine_ctx: EngineContext, ids: list[int]
) -> None:
    smart = create(engine_ctx, "Energía 8+", emoji="🔥", smart={"energyMin": 8})
    assert titles(engine_ctx, {"playlistId": smart["id"], "search": "cobalt"}) == ["Cobalt Rain"]
    updated = call(engine_ctx, "playlists.update",
                   {"playlistId": smart["id"], "smart": {"energyMin": 7}})  # fmt: skip
    assert updated["trackCount"] == 3


# ---- M3U ----


def write_wav(path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(44100)
        w.writeframes(b"\x00\x00" * 4410)
    return path


def library_path(ctx: EngineContext, track_id: int) -> Path:
    row = ctx.db.conn.execute("SELECT path FROM tracks WHERE id = ?", (track_id,)).fetchone()
    return Path(row[0])


def test_import_m3u8_matches_imports_and_reports_missing(
    engine_ctx: EngineContext, ids: list[int], tmp_path: Path
) -> None:
    lists = tmp_path / "Listas ✨"
    lists.mkdir()
    new_file = write_wav(lists / "Nuevos" / "Canción nueva 🎶.wav")
    known = library_path(engine_ctx, ids[1])
    known_as_url = library_path(engine_ctx, ids[2]).as_uri()
    m3u = lists / "Warm-up 🌅.m3u8"
    m3u.write_text(
        "﻿#EXTM3U\n"
        f"#EXTINF:300,Artist 1 - Golden Hour Tide\n{known}\n"
        "\n"
        "# a comment\n"
        "Nuevos/Canción nueva 🎶.wav\n"
        f"{known_as_url}\n"
        "https://example.com/stream.mp3\n"
        "Nuevos/no-existe.mp3\n"
        f"{known}\n",
        encoding="utf-8",
    )
    result = call(engine_ctx, "playlists.importM3u", {"path": str(m3u)})
    assert result["playlist"]["name"] == "Warm-up 🌅"
    assert result["playlist"]["trackCount"] == 3
    assert (result["matched"], result["imported"]) == (2, 1)
    assert result["missing"] == [
        "https://example.com/stream.mp3", "Nuevos/no-existe.mp3",
    ]  # fmt: skip
    assert playlist_titles(engine_ctx, result["playlist"]["id"]) == [
        "Golden Hour Tide", "Canción nueva 🎶", "Neon Cathedral",
    ]  # fmt: skip
    assert new_file.exists()


def test_import_relative_m3u_into_folder_and_latin1(
    engine_ctx: EngineContext, ids: list[int]
) -> None:
    folder = create(engine_ctx, "Importadas", isFolder=True)
    known = library_path(engine_ctx, ids[0])
    # Relative entries resolve against the playlist file's folder.
    m3u = known.parent / "viejo.m3u"
    m3u.write_text(f"{known.name}\n", encoding="utf-8")
    result = call(engine_ctx, "playlists.importM3u",
                  {"path": str(m3u), "parentId": folder["id"]})  # fmt: skip
    assert result["playlist"]["parentId"] == folder["id"]
    assert (result["matched"], result["missing"]) == (1, [])
    # Legacy .m3u files that are not UTF-8 are read as Windows-1252.
    latin = known.parent / "latin.m3u"
    latin.write_bytes(b"#EXTM3U\n" + "Caf\u00e9.mp3\n".encode("cp1252"))
    result = call(engine_ctx, "playlists.importM3u", {"path": str(latin)})
    assert result["missing"] == ["Caf\u00e9.mp3"]


def test_import_refuses_non_playlist_files(engine_ctx: EngineContext, tmp_path: Path) -> None:
    bad = tmp_path / "notas.txt"
    bad.write_text("x", encoding="utf-8")
    assert call_error(engine_ctx, "playlists.importM3u", {"path": str(bad)})["code"] == -32602
    missing = tmp_path / "nada.m3u"
    assert call_error(engine_ctx, "playlists.importM3u", {"path": str(missing)})["code"] == -32602


def test_export_m3u8_absolute_relative_and_round_trip(
    engine_ctx: EngineContext, ids: list[int], tmp_path: Path
) -> None:
    pl = create(engine_ctx, "Cierre 🌙")["id"]
    call(engine_ctx, "playlists.addTracks", {"playlistId": pl, "trackIds": [ids[2], ids[0]]})
    out = tmp_path / "Exportadas ñ" / "Cierre 🌙.m3u8"
    out.parent.mkdir()
    result = call(engine_ctx, "playlists.exportM3u", {"playlistId": pl, "path": str(out)})
    assert result == {"path": str(out), "written": 2, "backupPath": None}
    lines = out.read_text(encoding="utf-8").splitlines()
    assert lines == [
        "#EXTM3U",
        "#EXTINF:302,Artist 2 - Neon Cathedral",
        str(library_path(engine_ctx, ids[2])),
        "#EXTINF:300,Artist 0 - Midnight Bloom",
        str(library_path(engine_ctx, ids[0])),
    ]

    # Overwriting keeps the previous file as a backup.
    rel = call(engine_ctx, "playlists.exportM3u",
               {"playlistId": pl, "path": str(out), "relative": True})  # fmt: skip
    assert rel["backupPath"] is not None
    assert Path(rel["backupPath"]).read_text(encoding="utf-8").splitlines() == lines
    relative_lines = out.read_text(encoding="utf-8").splitlines()
    assert relative_lines[2] == str(Path("..") / "Música ñ" / library_path(engine_ctx, ids[2]).name)

    again = call(engine_ctx, "playlists.importM3u", {"path": str(out)})
    assert again["matched"] == 2 and again["missing"] == []
    assert playlist_titles(engine_ctx, again["playlist"]["id"]) == playlist_titles(engine_ctx, pl)


def test_export_smart_playlist_and_refusals(
    engine_ctx: EngineContext, ids: list[int], tmp_path: Path
) -> None:
    smart = create(engine_ctx, "Alta", smart={"energyMin": 8})["id"]
    out = tmp_path / "alta.m3u"
    assert call(engine_ctx, "playlists.exportM3u",
                {"playlistId": smart, "path": str(out)})["written"] == 2  # fmt: skip
    folder = create(engine_ctx, "Carpeta", isFolder=True)["id"]
    err = call_error(engine_ctx, "playlists.exportM3u",
                     {"playlistId": folder, "path": str(tmp_path / "c.m3u8")})  # fmt: skip
    assert err["code"] == -32602
    err = call_error(engine_ctx, "playlists.exportM3u",
                     {"playlistId": smart, "path": str(tmp_path / "c.txt")})  # fmt: skip
    assert err["code"] == -32602
    err = call_error(engine_ctx, "playlists.exportM3u",
                     {"playlistId": smart, "path": str(tmp_path / "no" / "c.m3u8")})  # fmt: skip
    assert err["code"] == -32602
