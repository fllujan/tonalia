"""SQLite storage with versioned migrations.

The schema version lives in ``PRAGMA user_version``. Each migration runs in a single
transaction (SQLite DDL is transactional), so a failing migration leaves the database
untouched. Before upgrading an existing database a full copy is written next to it
(``tonalia.db.bak-v<old>-<timestamp>``), following the "never destroy user data" rule.
"""

from __future__ import annotations

import json
import sqlite3
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class Migration:
    version: int
    sql: str


class SchemaTooNewError(RuntimeError):
    """The database was written by a newer Tonalia; refuse to touch it."""


_V1 = """
CREATE TABLE tracks (
    id               INTEGER PRIMARY KEY,
    path             TEXT    NOT NULL UNIQUE,
    file_hash        TEXT,
    size             INTEGER,
    mtime            REAL,
    format           TEXT,
    duration         REAL,
    sample_rate      INTEGER,
    bitrate          INTEGER,
    title            TEXT,
    artist           TEXT,
    album            TEXT,
    genre            TEXT,
    year             INTEGER,
    label            TEXT,
    comment          TEXT,
    artwork_path     TEXT,
    added_at         TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    analyzed_at      TEXT,
    analysis_version TEXT,
    status           TEXT    NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'analyzing', 'ready', 'error')),
    error            TEXT
);
CREATE INDEX idx_tracks_file_hash ON tracks(file_hash);
CREATE INDEX idx_tracks_status ON tracks(status);

CREATE TABLE analysis (
    track_id         INTEGER PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
    key_root         INTEGER CHECK (key_root BETWEEN 0 AND 11),
    key_mode         TEXT    CHECK (key_mode IN ('major', 'minor')),
    key_confidence   REAL,
    key_alternatives TEXT,   -- JSON
    bpm              REAL,
    bpm_confidence   REAL,
    beat_grid        TEXT,   -- JSON: {first_downbeat, bpm} or {beats: [...]}
    energy           INTEGER CHECK (energy BETWEEN 1 AND 10),
    energy_curve     TEXT,   -- JSON
    loudness_lufs    REAL,
    peak_db          REAL,
    clipping_ratio   REAL,
    vocal_presence   REAL,
    quality_flags    TEXT,   -- JSON
    waveform_path    TEXT
);
CREATE INDEX idx_analysis_key ON analysis(key_root, key_mode);
CREATE INDEX idx_analysis_bpm ON analysis(bpm);
CREATE INDEX idx_analysis_energy ON analysis(energy);

CREATE TABLE segments (
    id        INTEGER PRIMARY KEY,
    track_id  INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    start_sec REAL    NOT NULL,
    end_sec   REAL    NOT NULL,
    label     TEXT    NOT NULL CHECK (label IN
              ('intro', 'verse', 'chorus', 'build', 'drop', 'breakdown', 'outro')),
    energy    REAL
);
CREATE INDEX idx_segments_track ON segments(track_id);

CREATE TABLE cues (
    id           INTEGER PRIMARY KEY,
    track_id     INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    slot         INTEGER NOT NULL CHECK (slot BETWEEN 0 AND 7),
    position_sec REAL    NOT NULL,
    label        TEXT,
    color        TEXT,
    source       TEXT    NOT NULL CHECK (source IN ('auto', 'user')),
    UNIQUE (track_id, slot)
);

CREATE TABLE playlists (
    id          INTEGER PRIMARY KEY,
    parent_id   INTEGER REFERENCES playlists(id) ON DELETE CASCADE,
    name        TEXT    NOT NULL,
    emoji       TEXT,
    is_folder   INTEGER NOT NULL DEFAULT 0 CHECK (is_folder IN (0, 1)),
    sort_order  INTEGER NOT NULL DEFAULT 0,
    smart_query TEXT     -- JSON, NULL for regular playlists
);
CREATE INDEX idx_playlists_parent ON playlists(parent_id);

CREATE TABLE playlist_tracks (
    playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    track_id    INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    position    INTEGER NOT NULL,
    PRIMARY KEY (playlist_id, position)
);
CREATE INDEX idx_playlist_tracks_track ON playlist_tracks(track_id);

CREATE TABLE stems (
    track_id          INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    model             TEXT    NOT NULL,
    vocals_path       TEXT,
    drums_path        TEXT,
    bass_path         TEXT,
    other_path        TEXT,
    instrumental_path TEXT,
    created_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (track_id, model)
);

CREATE TABLE favorites (
    id         INTEGER PRIMARY KEY,
    track_a    INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    track_b    INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    mode       TEXT    NOT NULL CHECK (mode IN ('mashup', 'mix')),
    shift_a    INTEGER NOT NULL DEFAULT 0,
    shift_b    INTEGER NOT NULL DEFAULT 0,
    cue_a      REAL,
    cue_b      REAL,
    rating     INTEGER NOT NULL DEFAULT 0 CHECK (rating BETWEEN 0 AND 5),
    notes      TEXT,
    created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- No foreign key on purpose: backups must survive removing a track from the library.
CREATE TABLE tag_backups (
    batch_id      TEXT    NOT NULL,
    track_id      INTEGER NOT NULL,
    path          TEXT    NOT NULL,
    original_tags BLOB    NOT NULL,
    written_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (batch_id, track_id)
);

CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL  -- JSON
);
"""

# v2: precomputed, case/accent-folded text for instant search over 100k tracks.
_V2 = """
ALTER TABLE tracks ADD COLUMN search_text TEXT NOT NULL DEFAULT '';
"""

# v3: name used for sorting by title — the title tag, or the file name when untagged
# (sorting by the full path put every untagged track first).
_V3 = """
ALTER TABLE tracks ADD COLUMN display_title TEXT NOT NULL DEFAULT '';
CREATE INDEX idx_tracks_display_title ON tracks(display_title COLLATE NOCASE);
"""

# v4: secondary key (SPEC 2.2: a different key ruling > 25 % of the track) and the
# estimated tuning reference.
_V4 = """
ALTER TABLE analysis ADD COLUMN key_secondary_root INTEGER
    CHECK (key_secondary_root BETWEEN 0 AND 11);
ALTER TABLE analysis ADD COLUMN key_secondary_mode TEXT
    CHECK (key_secondary_mode IN ('major', 'minor'));
ALTER TABLE analysis ADD COLUMN key_secondary_start REAL;
ALTER TABLE analysis ADD COLUMN tuning_hz REAL;
"""

# v5: analysis fields edited by hand (SPEC 2.14: manual changes prevail over the analysis).
_V5 = """
ALTER TABLE analysis ADD COLUMN edited_fields TEXT NOT NULL DEFAULT '[]';
"""

# v6: details of the quality report (SPEC 2.7) next to the flags.
_V6 = """
ALTER TABLE analysis ADD COLUMN cutoff_hz REAL;
ALTER TABLE analysis ADD COLUMN silence_start REAL;
ALTER TABLE analysis ADD COLUMN silence_end REAL;
"""

# v7: tag write batches (SPEC 2.9) and the field changes kept with each undo record.
_V7 = """
CREATE TABLE tag_batches (
    id         TEXT PRIMARY KEY,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    options    TEXT NOT NULL,
    written    INTEGER NOT NULL DEFAULT 0,
    undone_at  TEXT
);
ALTER TABLE tag_backups ADD COLUMN changes TEXT;
"""

# v8: stems remember the file they were separated from (SPEC 1.4 change detection).
_V8 = """
ALTER TABLE stems ADD COLUMN source_hash TEXT;
"""

# v9: where vocal_presence comes from (SPEC 2.16): estimated from the mix or measured on stems.
_V9 = """
ALTER TABLE analysis ADD COLUMN vocal_source TEXT CHECK (vocal_source IN ('estimate', 'stems'));
"""

# v10: a favorite remembers each deck's stem and the tempo multiple B was matched at, so
# it can be played and exported as it was heard (SPEC 2.15).
_V10 = """
ALTER TABLE favorites ADD COLUMN stem_a TEXT NOT NULL DEFAULT 'mix'
    CHECK (stem_a IN ('mix', 'vocals', 'instrumental'));
ALTER TABLE favorites ADD COLUMN stem_b TEXT NOT NULL DEFAULT 'mix'
    CHECK (stem_b IN ('mix', 'vocals', 'instrumental'));
ALTER TABLE favorites ADD COLUMN bpm_factor REAL NOT NULL DEFAULT 1
    CHECK (bpm_factor IN (0.5, 1, 2));
"""

# v11: each tag batch keeps a short summary (fields written, a few titles) so the history
# still describes it after undo has deleted its backups.
_V11 = """
ALTER TABLE tag_batches ADD COLUMN summary TEXT;
"""

# v12: "Revisar calidad" is a to-do list: the quality flags the user marked as reviewed
# (JSON list). A track needs review while it has a flag that is not in this list.
_V12 = """
ALTER TABLE analysis ADD COLUMN quality_reviewed TEXT;
"""

MIGRATIONS: list[Migration] = [
    Migration(1, _V1),
    Migration(2, _V2),
    Migration(3, _V3),
    Migration(4, _V4),
    Migration(5, _V5),
    Migration(6, _V6),
    Migration(7, _V7),
    Migration(8, _V8),
    Migration(9, _V9),
    Migration(10, _V10),
    Migration(11, _V11),
    Migration(12, _V12),
]
SCHEMA_VERSION = MIGRATIONS[-1].version


def _fold(value: object) -> str | None:
    """Unicode case folding for SQL (SQLite's ``lower()`` only folds ASCII)."""
    return value.casefold() if isinstance(value, str) else None


class Database:
    def __init__(self, conn: sqlite3.Connection, path: Path) -> None:
        self.conn = conn
        self.path = path

    @classmethod
    def open(cls, path: Path) -> Database:
        path.parent.mkdir(parents=True, exist_ok=True)
        # Autocommit mode: transactions are explicit (migrations, batch writes).
        conn = sqlite3.connect(path, isolation_level=None, check_same_thread=False)
        try:
            conn.row_factory = sqlite3.Row
            conn.create_function("tonalia_fold", 1, _fold, deterministic=True)
            conn.execute("PRAGMA foreign_keys = ON")
            conn.execute("PRAGMA journal_mode = WAL")
            conn.execute("PRAGMA synchronous = NORMAL")
            db = cls(conn, path)
            db._migrate()
        except BaseException:
            conn.close()
            raise
        return db

    @property
    def version(self) -> int:
        return int(self.conn.execute("PRAGMA user_version").fetchone()[0])

    def close(self) -> None:
        self.conn.close()

    def _migrate(self) -> None:
        current = self.version
        latest = MIGRATIONS[-1].version
        if current > latest:
            raise SchemaTooNewError(
                f"database schema v{current} is newer than this version of Tonalia (v{latest})"
            )
        pending = [m for m in MIGRATIONS if m.version > current]
        if not pending:
            return
        if current > 0:
            self._backup(current)
        for migration in pending:
            try:
                self.conn.executescript(
                    f"BEGIN;\n{migration.sql}\nPRAGMA user_version = {migration.version};\nCOMMIT;"
                )
            except sqlite3.Error:
                if self.conn.in_transaction:
                    self.conn.rollback()
                raise

    def _backup(self, version: int) -> Path:
        stamp = time.strftime("%Y%m%d-%H%M%S")
        dest = self.path.with_name(f"{self.path.name}.bak-v{version}-{stamp}")
        target = sqlite3.connect(dest)
        try:
            self.conn.backup(target)
        finally:
            target.close()
        return dest

    def get_setting(self, key: str, default: Any = None) -> Any:
        row = self.conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
        return default if row is None else json.loads(row["value"])

    def set_setting(self, key: str, value: Any) -> None:
        self.conn.execute(
            "INSERT INTO settings(key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, json.dumps(value, ensure_ascii=False)),
        )
