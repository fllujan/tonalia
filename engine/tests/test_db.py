import json
import sqlite3
from pathlib import Path

import pytest

from tonalia_engine import db as dbmod
from tonalia_engine.db import Database, Migration

EXPECTED_COLUMNS = {
    "tracks": {
        "id", "path", "file_hash", "size", "mtime", "format", "duration", "sample_rate",
        "bitrate", "title", "artist", "album", "genre", "year", "label", "comment",
        "artwork_path", "added_at", "analyzed_at", "analysis_version", "status", "error",
        "error_info", "search_text", "display_title",
    },
    "analysis": {
        "track_id", "key_root", "key_mode", "key_confidence", "key_alternatives", "bpm",
        "bpm_confidence", "beat_grid", "energy", "energy_curve", "loudness_lufs", "peak_db",
        "clipping_ratio", "vocal_presence", "quality_flags", "waveform_path",
        "key_secondary_root", "key_secondary_mode", "key_secondary_start", "tuning_hz",
        "edited_fields", "cutoff_hz", "silence_start", "silence_end", "vocal_source",
        "quality_reviewed", "energy_blocks",
    },
    "segments": {"id", "track_id", "start_sec", "end_sec", "label", "energy"},
    "cues": {"id", "track_id", "slot", "position_sec", "label", "color", "source"},
    "playlists": {"id", "parent_id", "name", "emoji", "is_folder", "sort_order", "smart_query"},
    "playlist_tracks": {"playlist_id", "track_id", "position"},
    "stems": {
        "track_id", "model", "vocals_path", "drums_path", "bass_path", "other_path",
        "instrumental_path", "created_at", "source_hash",
    },
    "favorites": {
        "id", "track_a", "track_b", "mode", "shift_a", "shift_b", "cue_a", "cue_b", "rating",
        "notes", "created_at", "stem_a", "stem_b", "bpm_factor",
    },
    "tag_backups": {"batch_id", "track_id", "path", "original_tags", "written_at", "changes"},
    "tag_batches": {"id", "created_at", "options", "written", "undone_at", "summary"},
    "settings": {"key", "value"},
    "energy_ratings": {"track_id", "rating", "source", "rated_at"},
}  # fmt: skip


def columns(conn: sqlite3.Connection, table: str) -> set[str]:
    return {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}


def add_track(db: Database, path: str = "/music/a.mp3") -> int:
    cur = db.conn.execute("INSERT INTO tracks(path) VALUES (?)", (path,))
    assert cur.lastrowid is not None
    return cur.lastrowid


@pytest.fixture
def db(tmp_path: Path) -> Database:
    return Database.open(tmp_path / "tonalia.db")


def test_fresh_database_has_full_schema(db: Database) -> None:
    assert db.version == dbmod.SCHEMA_VERSION
    for table, expected in EXPECTED_COLUMNS.items():
        assert columns(db.conn, table) == expected, table


def test_pragmas(db: Database) -> None:
    assert db.conn.execute("PRAGMA foreign_keys").fetchone()[0] == 1
    assert db.conn.execute("PRAGMA journal_mode").fetchone()[0] == "wal"


def test_reopen_is_idempotent_and_keeps_data(tmp_path: Path) -> None:
    path = tmp_path / "tonalia.db"
    first = Database.open(path)
    add_track(first)
    first.close()
    second = Database.open(path)
    assert second.conn.execute("SELECT count(*) FROM tracks").fetchone()[0] == 1
    assert not list(tmp_path.glob("*.bak-*")), "no backup when nothing is migrated"


def test_unicode_path(tmp_path: Path) -> None:
    folder = tmp_path / "Música ñ 🎧 con espacios"
    db = Database.open(folder / "tonalia.db")
    track_id = add_track(db, "/Users/dj/Música/Canción 🎵 (Remix).flac")
    row = db.conn.execute("SELECT path FROM tracks WHERE id=?", (track_id,)).fetchone()
    assert row["path"] == "/Users/dj/Música/Canción 🎵 (Remix).flac"


def test_path_is_unique(db: Database) -> None:
    add_track(db)
    with pytest.raises(sqlite3.IntegrityError):
        add_track(db)


def test_constraints(db: Database) -> None:
    tid = add_track(db)
    with pytest.raises(sqlite3.IntegrityError):
        db.conn.execute("UPDATE tracks SET status='bogus' WHERE id=?", (tid,))
    with pytest.raises(sqlite3.IntegrityError):
        db.conn.execute("INSERT INTO analysis(track_id, energy) VALUES (?, 11)", (tid,))
    with pytest.raises(sqlite3.IntegrityError):
        db.conn.execute(
            "INSERT INTO cues(track_id, slot, position_sec, source) VALUES (?, 8, 1.0, 'auto')",
            (tid,),
        )
    with pytest.raises(sqlite3.IntegrityError):
        db.conn.execute(
            "INSERT INTO segments(track_id, start_sec, end_sec, label) VALUES (?, 0, 1, 'solo')",
            (tid,),
        )
    db.conn.execute(
        "INSERT INTO cues(track_id, slot, position_sec, source) VALUES (?, 0, 1.0, 'auto')", (tid,)
    )
    with pytest.raises(sqlite3.IntegrityError):  # one cue per slot
        db.conn.execute(
            "INSERT INTO cues(track_id, slot, position_sec, source) VALUES (?, 0, 2.0, 'user')",
            (tid,),
        )


def test_deleting_a_track_cascades_but_keeps_tag_backups(db: Database) -> None:
    tid = add_track(db)
    c = db.conn
    c.execute("INSERT INTO analysis(track_id, bpm) VALUES (?, 124.0)", (tid,))
    c.execute(
        "INSERT INTO cues(track_id, slot, position_sec, source) VALUES (?, 0, 0.5, 'auto')", (tid,)
    )
    c.execute(
        "INSERT INTO tag_backups(batch_id, track_id, path, original_tags) "
        "VALUES ('b1', ?, '/music/a.mp3', x'00')",
        (tid,),
    )
    pid = c.execute("INSERT INTO playlists(name, emoji) VALUES ('Peak time', '🔥')").lastrowid
    c.execute("INSERT INTO playlist_tracks VALUES (?, ?, 0)", (pid, tid))
    c.execute("DELETE FROM tracks WHERE id=?", (tid,))
    for table in ("analysis", "cues", "playlist_tracks"):
        assert c.execute(f"SELECT count(*) FROM {table}").fetchone()[0] == 0, table
    assert c.execute("SELECT count(*) FROM tag_backups").fetchone()[0] == 1


def test_nested_playlists_cascade(db: Database) -> None:
    c = db.conn
    folder = c.execute("INSERT INTO playlists(name, emoji, is_folder) VALUES ('Bolos','📁',1)")
    c.execute(
        "INSERT INTO playlists(parent_id, name, emoji) VALUES (?, 'Cierre', '🌙')",
        (folder.lastrowid,),
    )
    c.execute("DELETE FROM playlists WHERE id=?", (folder.lastrowid,))
    assert c.execute("SELECT count(*) FROM playlists").fetchone()[0] == 0


def test_settings_roundtrip(db: Database) -> None:
    db.set_setting("notation", "alphanumeric")
    db.set_setting("bpm_range", [70, 180])
    assert db.get_setting("notation") == "alphanumeric"
    assert db.get_setting("bpm_range") == [70, 180]
    assert db.get_setting("missing", default=7) == 7


def test_upgrade_backs_up_and_migrates(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    path = tmp_path / "tonalia.db"
    Database.open(path).close()
    extra = Migration(dbmod.SCHEMA_VERSION + 1, "ALTER TABLE tracks ADD COLUMN rating INTEGER;")
    monkeypatch.setattr(dbmod, "MIGRATIONS", [*dbmod.MIGRATIONS, extra])
    db = Database.open(path)
    assert db.version == dbmod.SCHEMA_VERSION + 1
    assert "rating" in columns(db.conn, "tracks")
    backups = list(tmp_path.glob(f"tonalia.db.bak-v{dbmod.SCHEMA_VERSION}*"))
    assert len(backups) == 1


def test_failed_migration_rolls_back(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    path = tmp_path / "tonalia.db"
    Database.open(path).close()
    bad = Migration(
        dbmod.SCHEMA_VERSION + 1,
        "ALTER TABLE tracks ADD COLUMN ok INTEGER; THIS IS NOT SQL;",
    )
    monkeypatch.setattr(dbmod, "MIGRATIONS", [*dbmod.MIGRATIONS, bad])
    with pytest.raises(sqlite3.Error):
        Database.open(path)
    monkeypatch.undo()
    db = Database.open(path)
    assert db.version == dbmod.SCHEMA_VERSION
    assert "ok" not in columns(db.conn, "tracks")


def test_v14_classifies_old_track_errors(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    path = tmp_path / "tonalia.db"
    monkeypatch.setattr(dbmod, "MIGRATIONS", [m for m in dbmod.MIGRATIONS if m.version < 14])
    old = Database.open(path)
    rows = [
        ("/música/Mañana 🌅.mp3", "cannot decode Mañana 🌅.mp3: Invalid data"),
        ("C:\\DJ\\b.flac", "no audio stream in b.flac"),
        ("/x/c.mp3", "analysis process crashed"),
        ("/x/d.mp3", "list index out of range"),
        ("/x/e.mp3", None),
    ]
    for i, (track, error) in enumerate(rows):
        old.conn.execute(
            "INSERT INTO tracks (path, file_hash, size, mtime, status, error) "
            "VALUES (?, ?, 1, 0, ?, ?)",
            (track, f"h{i}", "error" if error else "pending", error),
        )
    old.close()
    monkeypatch.undo()
    db = Database.open(path)
    infos = [
        None if r[0] is None else json.loads(r[0])
        for r in db.conn.execute("SELECT error_info FROM tracks ORDER BY id")
    ]
    assert infos == [
        {"reason": "decode_failed", "params": {"name": "Mañana 🌅.mp3"}},
        {"reason": "no_audio", "params": {"name": "b.flac"}},
        {"reason": "process_crashed", "params": {"name": "c.mp3"}},
        {"reason": "internal", "params": {"name": "d.mp3"}},
        None,
    ]


def test_newer_database_is_refused(tmp_path: Path) -> None:
    path = tmp_path / "tonalia.db"
    Database.open(path).close()
    raw = sqlite3.connect(path)
    raw.execute(f"PRAGMA user_version = {dbmod.SCHEMA_VERSION + 5}")
    raw.close()
    with pytest.raises(dbmod.SchemaTooNewError):
        Database.open(path)
