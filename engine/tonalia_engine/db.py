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

from .errors import TonaliaError


@dataclass(frozen=True)
class Migration:
    version: int
    sql: str


class SchemaTooNewError(TonaliaError, RuntimeError):
    """The database was written by a newer Tonalia; refuse to touch it."""

    reason = "schema_too_new"


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

# v13: how long stem separation takes on this machine, per model and device, to tell the
# user what to expect (SPEC 11.1). Totals, so every separation refines the average.
_V13 = """
CREATE TABLE stem_timings (
    model         TEXT NOT NULL,
    device        TEXT NOT NULL,
    seconds       REAL NOT NULL CHECK (seconds >= 0),
    audio_minutes REAL NOT NULL CHECK (audio_minutes > 0),
    updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (model, device)
);
"""

# v14: the stable code of a track's error (SPEC 11.4), JSON ``{"reason", "params"}`` next to
# the technical message. Errors saved before it are classified once from their text.
_V14 = """
ALTER TABLE tracks ADD COLUMN error_info TEXT;
UPDATE tracks SET error_info = json_object(
    'reason',
    CASE
        WHEN error LIKE 'cannot decode %' THEN 'decode_failed'
        WHEN error LIKE 'no audio stream in %' THEN 'no_audio'
        WHEN error LIKE 'file not found%' THEN 'file_not_found'
        WHEN error LIKE 'FFmpeg not found%' OR error LIKE 'could not run FFmpeg%'
            THEN 'ffmpeg_missing'
        WHEN error LIKE 'unsupported or unrecognized file%' THEN 'unsupported_format'
        WHEN error LIKE 'cannot read %' THEN 'read_failed'
        WHEN error = 'analysis process crashed' THEN 'process_crashed'
        ELSE 'internal'
    END,
    'params',
    json_object('name', replace(replace(path, '\\', '/'),
        rtrim(replace(path, '\\', '/'), replace(replace(path, '\\', '/'), '/', '')), ''))
)
WHERE error IS NOT NULL;
"""

# v15: personal energy (SPEC 12.2). The raw descriptors of each 8-bar block (JSON rows in
# ``energy.DESCRIPTORS`` order), so a calibration recomputes every level without decoding
# the audio again, and the user's ratings: heard in "Calibrate energy" or read from tags.
_V15 = """
ALTER TABLE analysis ADD COLUMN energy_blocks TEXT;
CREATE TABLE energy_ratings (
    track_id INTEGER PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
    rating   INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 10),
    source   TEXT NOT NULL DEFAULT 'listen' CHECK (source IN ('listen', 'import')),
    rated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
"""

# v16: where the vocal presence comes from (SPEC 12.3): the old estimate is ``heuristic``,
# the trained model ``model``, the stems ``stems``. SQLite cannot change a CHECK constraint,
# so the table is rebuilt with the same columns and data.
_V16 = """
CREATE TABLE analysis_v16 (
    track_id         INTEGER PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
    key_root         INTEGER CHECK (key_root BETWEEN 0 AND 11),
    key_mode         TEXT    CHECK (key_mode IN ('major', 'minor')),
    key_confidence   REAL,
    key_alternatives TEXT,
    bpm              REAL,
    bpm_confidence   REAL,
    beat_grid        TEXT,
    energy           INTEGER CHECK (energy BETWEEN 1 AND 10),
    energy_curve     TEXT,
    loudness_lufs    REAL,
    peak_db          REAL,
    clipping_ratio   REAL,
    vocal_presence   REAL,
    quality_flags    TEXT,
    waveform_path    TEXT,
    key_secondary_root  INTEGER CHECK (key_secondary_root BETWEEN 0 AND 11),
    key_secondary_mode  TEXT    CHECK (key_secondary_mode IN ('major', 'minor')),
    key_secondary_start REAL,
    tuning_hz        REAL,
    edited_fields    TEXT NOT NULL DEFAULT '[]',
    cutoff_hz        REAL,
    silence_start    REAL,
    silence_end      REAL,
    vocal_source     TEXT CHECK (vocal_source IN ('heuristic', 'model', 'stems')),
    quality_reviewed TEXT,
    energy_blocks    TEXT
);
INSERT INTO analysis_v16 (
    track_id, key_root, key_mode, key_confidence, key_alternatives, bpm, bpm_confidence,
    beat_grid, energy, energy_curve, loudness_lufs, peak_db, clipping_ratio, vocal_presence,
    quality_flags, waveform_path, key_secondary_root, key_secondary_mode,
    key_secondary_start, tuning_hz, edited_fields, cutoff_hz, silence_start, silence_end,
    vocal_source, quality_reviewed, energy_blocks
)
SELECT
    track_id, key_root, key_mode, key_confidence, key_alternatives, bpm, bpm_confidence,
    beat_grid, energy, energy_curve, loudness_lufs, peak_db, clipping_ratio, vocal_presence,
    quality_flags, waveform_path, key_secondary_root, key_secondary_mode,
    key_secondary_start, tuning_hz, edited_fields, cutoff_hz, silence_start, silence_end,
    CASE vocal_source WHEN 'estimate' THEN 'heuristic' ELSE vocal_source END,
    quality_reviewed, energy_blocks
FROM analysis;
DROP TABLE analysis;
ALTER TABLE analysis_v16 RENAME TO analysis;
CREATE INDEX idx_analysis_key ON analysis(key_root, key_mode);
CREATE INDEX idx_analysis_bpm ON analysis(bpm);
CREATE INDEX idx_analysis_energy ON analysis(energy);
"""

# v17: the beatgrid editor (SPEC 12.4). Who made the grid (the analysis, the user or an
# import from another program), whether it is locked against reanalysis, and the grid and
# BPM the analysis found, kept while the user's grid is in place so "Reset" can go back.
_V17 = """
ALTER TABLE analysis ADD COLUMN grid_source TEXT NOT NULL DEFAULT 'auto'
    CHECK (grid_source IN ('auto', 'user', 'import'));
ALTER TABLE analysis ADD COLUMN grid_locked INTEGER NOT NULL DEFAULT 0
    CHECK (grid_locked IN (0, 1));
ALTER TABLE analysis ADD COLUMN beat_grid_auto TEXT;
ALTER TABLE analysis ADD COLUMN bpm_auto REAL;
"""

# v18: assisted cue review (SPEC 12.5). One row per verdict. Cue ids change when the
# automatic cues are derived again, so each row keeps what was reviewed (slot, section
# label, position, who placed it, analysis version): the report stays right after a
# reanalysis or after the user moves the cue. ``missing`` rows mark a place without a cue.
_V18 = """
CREATE TABLE cue_reviews (
    id               INTEGER PRIMARY KEY,
    track_id         INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    cue_id           INTEGER REFERENCES cues(id) ON DELETE SET NULL,
    slot             INTEGER CHECK (slot BETWEEN 0 AND 7),
    label            TEXT,
    position_sec     REAL NOT NULL,
    cue_source       TEXT,
    verdict          TEXT NOT NULL CHECK (verdict IN ('ok', 'wrong', 'missing')),
    analysis_version TEXT,
    reviewed_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_cue_reviews_track ON cue_reviews(track_id);
"""

# v19: importing from other DJ programs (SPEC 13.1).
# - ``cues.source`` admits ``import``. SQLite cannot change a CHECK constraint, so the table
#   is rebuilt with the same ids; dropping the old one would null ``cue_reviews.cue_id``
#   (ON DELETE SET NULL), so those links are put back afterwards.
# - ``markers``: memory cues and loops, which do not take a hot cue pad.
# - the rating and play count another program kept, and the analysis fields that came
#   from an import (a reanalysis keeps them, like the ones edited by hand).
# - ``import_batches``: what each import changed, to undo it.
_V19 = """
CREATE TEMP TABLE review_links AS SELECT id, cue_id FROM cue_reviews WHERE cue_id IS NOT NULL;
CREATE TABLE cues_v19 (
    id           INTEGER PRIMARY KEY,
    track_id     INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    slot         INTEGER NOT NULL CHECK (slot BETWEEN 0 AND 7),
    position_sec REAL    NOT NULL,
    label        TEXT,
    color        TEXT,
    source       TEXT    NOT NULL CHECK (source IN ('auto', 'user', 'import')),
    UNIQUE (track_id, slot)
);
INSERT INTO cues_v19 (id, track_id, slot, position_sec, label, color, source)
SELECT id, track_id, slot, position_sec, label, color, source FROM cues;
DROP TABLE cues;
ALTER TABLE cues_v19 RENAME TO cues;
UPDATE cue_reviews
SET cue_id = (SELECT cue_id FROM review_links WHERE review_links.id = cue_reviews.id)
WHERE id IN (SELECT id FROM review_links);
DROP TABLE review_links;
CREATE TABLE markers (
    id           INTEGER PRIMARY KEY,
    track_id     INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    kind         TEXT    NOT NULL CHECK (kind IN ('memory', 'loop', 'mix_in', 'mix_out')),
    position_sec REAL    NOT NULL,
    length_sec   REAL,
    label        TEXT,
    color        TEXT,
    source       TEXT    NOT NULL CHECK (source IN ('auto', 'user', 'import'))
);
CREATE INDEX idx_markers_track ON markers(track_id);
ALTER TABLE tracks ADD COLUMN rating INTEGER CHECK (rating BETWEEN 0 AND 5);
ALTER TABLE tracks ADD COLUMN play_count INTEGER CHECK (play_count >= 0);
ALTER TABLE analysis ADD COLUMN imported_fields TEXT NOT NULL DEFAULT '[]';
CREATE TABLE import_batches (
    batch_id   TEXT PRIMARY KEY,
    source     TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    summary    TEXT NOT NULL,
    undo_data  BLOB NOT NULL,
    undone_at  TEXT
);
"""

# Duplicates (SPEC 13.3): an audio fingerprint per track (``source_hash`` = the file_hash
# it was computed from), the groups found by the last scan with their resolution, the
# pairs the user said are different versions, and each merge with what undoes it.
_V20 = """
CREATE TABLE fingerprints (
    track_id    INTEGER PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
    version     INTEGER NOT NULL,
    source_hash TEXT,
    summary     BLOB    NOT NULL,
    data        BLOB    NOT NULL
);
CREATE TABLE duplicate_groups (
    group_id    TEXT    NOT NULL,
    track_id    INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    kind        TEXT    NOT NULL CHECK (kind IN ('identical', 'audio', 'version')),
    keep        INTEGER NOT NULL DEFAULT 0,
    resolved_at TEXT,
    resolution  TEXT CHECK (resolution IN ('keep_all', 'distinct')),
    PRIMARY KEY (group_id, track_id)
);
CREATE INDEX idx_duplicate_groups_track ON duplicate_groups(track_id);
CREATE TABLE duplicate_exclusions (
    track_a INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    track_b INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    PRIMARY KEY (track_a, track_b),
    CHECK (track_a < track_b)
);
CREATE TABLE duplicate_merges (
    merge_id   TEXT PRIMARY KEY,
    keeper_id  INTEGER NOT NULL,
    removed    TEXT NOT NULL,
    trashed    TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    undo_data  BLOB NOT NULL,
    undone_at  TEXT
);
"""

# Play history (SPEC 13.4): sessions (one per history file, playlist or list of a DJ
# program, or one marked by hand) and their plays in order. ``play_stats`` is kept by
# ``history.refresh_stats`` so the table can show and sort "Times played" and "Last
# played" over 100 000 tracks without counting the plays on every query.
_V21 = """
CREATE TABLE play_sessions (
    id          INTEGER PRIMARY KEY,
    program     TEXT,
    source      TEXT NOT NULL CHECK (source IN ('import', 'manual')),
    source_key  TEXT NOT NULL UNIQUE,
    name        TEXT,
    started_at  TEXT NOT NULL,
    ended_at    TEXT,
    imported_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE TABLE plays (
    id         INTEGER PRIMARY KEY,
    track_id   INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    played_at  TEXT    NOT NULL,
    source     TEXT    NOT NULL CHECK (source IN ('import', 'manual')),
    session_id INTEGER NOT NULL REFERENCES play_sessions(id) ON DELETE CASCADE,
    program    TEXT,
    position   INTEGER NOT NULL
);
CREATE INDEX idx_plays_track ON plays(track_id);
CREATE INDEX idx_plays_session ON plays(session_id, position);
CREATE TABLE play_stats (
    track_id      INTEGER PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
    program_plays INTEGER NOT NULL DEFAULT 0,
    manual_plays  INTEGER NOT NULL DEFAULT 0,
    last_played   TEXT
);
CREATE INDEX idx_play_stats_last ON play_stats(last_played);
"""

# Spectrogram (SPEC 13.5): the cached picture, like the waveform. The cut-off it measures
# is the existing ``cutoff_hz`` (the SPEC's ``spectral_cutoff_hz``): one calculation.
_V22 = """
ALTER TABLE analysis ADD COLUMN spectrogram_path TEXT;
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
    Migration(13, _V13),
    Migration(14, _V14),
    Migration(15, _V15),
    Migration(16, _V16),
    Migration(17, _V17),
    Migration(18, _V18),
    Migration(19, _V19),
    Migration(20, _V20),
    Migration(21, _V21),
    Migration(22, _V22),
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
