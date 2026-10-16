"""Bring a DJ program's collection into Tonalia (SPEC 13.1).

Reading never writes to the program's files (the readers parse a copy). The import:

1. **matches** each track of the collection with the library: by path; then through the
   path mappings (another drive letter, another volume, a moved folder; the preview
   proposes the ones it detects from file names); then by ``file_hash`` for a file on
   disk of the same size. What does not match is listed and, if asked, added;
2. **plans** each field with the policy (``ImportPolicy``): keep Tonalia's, take the
   imported value, or only fill what Tonalia does not have. Data marked ``user`` is only
   replaced by ``take``. Automatic hot cues count as empty (a DJ program's hot cues were
   placed by the DJ); a key, BPM or grid from the analysis counts as a value;
3. **applies** it in one transaction (imported cues get ``source = 'import'``, an imported
   grid is ``grid_source = 'import'`` and locked, an imported key or BPM is protected from
   reanalysis), with the playlists in a top folder "Imported from <program>" (replacing
   the one a previous import made);
4. keeps what each touched track looked like before and after, so ``undo`` puts back
   every field that is still as the import left it (a field the DJ changed since stays).

A simulation is the same plan without step 3.
"""

from __future__ import annotations

import json
import os
import re
import unicodedata
import uuid
import zlib
from collections import Counter
from collections.abc import Callable, Iterable
from dataclasses import asdict, dataclass, field
from pathlib import Path, PureWindowsPath
from typing import Any

from .. import grid as grid_mod
from ..analysis.tempo import BeatGrid
from ..cues import refresh_auto_cues
from ..db import Database
from ..errors import CollectionNotFoundError, TonaliaError
from ..export import engine_dj as engine_export
from ..export import serato_crates, traktor_nml
from ..export import virtualdj as vdj_export
from ..export.common import process_running
from ..keys import Key, format_key
from ..library import Library, file_hash
from ..rpc_schema import (
    IMPORT_ITEMS_MAX,
    AddPathsResult,
    ImportBatch,
    ImportChange,
    ImportField,
    ImportFieldCount,
    ImportFieldPolicy,
    ImportHistory,
    ImportMatch,
    ImportOptions,
    ImportPolicy,
    ImportReport,
    ImportSource,
    ImportSources,
    ImportSourceStatus,
    ImportUndoResult,
    ImportUnmatched,
    ImportWarning,
    Notation,
    PathMap,
)
from . import engine_dj, rekordbox, serato, traktor, virtualdj
from .model import (
    ImportedCollection,
    ImportedCue,
    ImportedPlaylist,
    ImportedTrack,
    network_share,
)

PROGRAMS: dict[ImportSource, str] = {
    "rekordbox": "Rekordbox",
    "traktor": "Traktor",
    "serato": "Serato",
    "virtualdj": "VirtualDJ",
    "engine_dj": "Engine DJ",
}
FOLDER_NAMES = {"es": "Importado de {program}", "en": "Imported from {program}"}
FIELDS: tuple[ImportField, ...] = ("cues", "grid", "key", "bpm", "rating", "play_count", "comment")
# Two cues or markers this close are the same place.
SAME_PLACE = 0.01
MAX_MAPS = 8


# ---- where each program keeps its collection ----


def default_path(source: ImportSource) -> Path | None:
    if source == "traktor":
        return traktor_nml.find_collection()
    if source == "serato":
        folder = serato_crates.find_serato_folder()
        return folder if folder.is_dir() else None
    if source == "virtualdj":
        return vdj_export.find_database()
    if source == "engine_dj":
        return engine_export.find_database()
    return None  # rekordbox.xml is wherever the DJ exported it


def running(source: ImportSource) -> bool:
    if source == "rekordbox":
        return process_running("rekordbox.*\\.app/Contents/MacOS", "rekordbox")
    if source == "traktor":
        return traktor_nml.traktor_running()
    if source == "serato":
        return serato_crates.serato_running()
    if source == "virtualdj":
        return vdj_export.virtualdj_running()
    return engine_export.engine_running()


def detect() -> ImportSources:
    out = []
    for source in PROGRAMS:
        path = default_path(source)
        out.append(
            ImportSourceStatus(
                source=source, path=str(path) if path else None, running=running(source)
            )
        )
    return ImportSources(sources=out)


def _resolve(options: ImportOptions) -> Path:
    if options.path:
        path = Path(options.path)
        if options.source == "engine_dj":
            path = engine_export.resolve_database(options.path)
    else:
        found = default_path(options.source)
        if found is None:
            raise CollectionNotFoundError(
                f"{PROGRAMS[options.source]} collection not found",
                program=PROGRAMS[options.source],
            )
        path = found
    exists = path.is_dir() if options.source == "serato" else path.is_file()
    if not exists:
        raise CollectionNotFoundError(
            f"{PROGRAMS[options.source]} collection not found: {path}",
            program=PROGRAMS[options.source],
        )
    return path


def read_collection(
    source: ImportSource,
    path: Path,
    wanted: Callable[[str], bool],
    progress: Callable[[float], None],
) -> ImportedCollection:
    if source == "rekordbox":
        return rekordbox.read(path)
    if source == "traktor":
        return traktor.read(path)
    if source == "serato":
        return serato.read(path, wanted, progress)
    if source == "virtualdj":
        return virtualdj.read(path)
    return engine_dj.read(path)


# ---- paths ----


def path_key(path: str) -> str:
    text = unicodedata.normalize("NFC", path)
    return text.casefold() if os.name == "nt" else text


def _parts(path: str) -> list[str]:
    parts = re.split(r"[\\/]+", path)
    return [parts[0], *[p for p in parts[1:] if p]] if parts else []


def _join(parts: list[str]) -> str:
    if parts and re.fullmatch(r"[A-Za-z]:", parts[0]):
        return str(PureWindowsPath(parts[0] + "\\", *parts[1:]))
    return "/".join(parts) if parts and parts[0] == "" else "/".join(["", *parts])


def _fold(text: str) -> str:
    return unicodedata.normalize("NFC", text).casefold()


def detect_maps(unmatched: Iterable[str], library_paths: Iterable[str]) -> list[PathMap]:
    """Prefix replacements that turn the program's paths into the library's, voted by the
    files with a unique name in the library (at least two agreeing, unless there is only
    one candidate)."""
    by_name: dict[str, list[str]] = {}
    for p in library_paths:
        by_name.setdefault(_fold(_parts(p)[-1]), []).append(p)
    votes: Counter[tuple[str, str]] = Counter()
    for p in unmatched:
        parts = _parts(p)
        candidates = by_name.get(_fold(parts[-1]), [])
        if len(candidates) != 1:
            continue
        other = _parts(candidates[0])
        same = 0
        while same < min(len(parts), len(other)) - 1 and _fold(parts[-1 - same]) == _fold(
            other[-1 - same]
        ):
            same += 1
        if same == 0:
            continue
        votes[(_join(parts[: len(parts) - same]), _join(other[: len(other) - same]))] += 1
    single = len(votes) == 1
    return [
        PathMap(from_=frm, to=to, tracks=0)
        for (frm, to), n in votes.most_common(MAX_MAPS)
        if n >= 2 or single
    ]


def apply_map(path: str, maps: Iterable[PathMap]) -> str | None:
    parts = _parts(path)
    if any(p in (".", "..") for p in parts[1:]):  # must stay inside the mapped folder
        return None
    for m in maps:
        prefix = _parts(m.from_)
        if len(parts) > len(prefix) and all(
            _fold(a) == _fold(b) for a, b in zip(parts, prefix, strict=False)
        ):
            return str(Path(m.to).joinpath(*parts[len(prefix) :]))
    return None


# ---- matching ----


@dataclass
class Match:
    track: ImportedTrack
    track_id: int | None = None
    how: ImportMatch | None = None
    on_disk: str | None = None  # where the file is, when it is not in the library
    map_used: int | None = None


@dataclass
class _Index:
    by_path: dict[str, int]
    by_size: dict[int, list[tuple[int, str | None]]]
    paths: list[str]
    # Network shares the user already keeps music on (plus the collection's own): the
    # only ones a path read from a collection may make Tonalia open.
    shares: set[str] = field(default_factory=set)

    def reachable(self, path: str) -> bool:
        share = network_share(path)
        return share is None or (bool(share) and share in self.shares)

    @classmethod
    def load(cls, db: Database) -> _Index:
        by_path: dict[str, int] = {}
        by_size: dict[int, list[tuple[int, str | None]]] = {}
        paths: list[str] = []
        shares: set[str] = set()
        for tid, path, size, digest in db.conn.execute(
            "SELECT id, path, size, file_hash FROM tracks"
        ):
            by_path[path_key(path)] = int(tid)
            paths.append(path)
            share = network_share(path)
            if share:
                shares.add(share)
            if size:
                by_size.setdefault(int(size), []).append((int(tid), digest))
        return cls(by_path, by_size, paths, shares)


def _match_one(
    track: ImportedTrack, index: _Index, maps: list[PathMap], hashes: dict[str, str]
) -> Match:
    out = Match(track)
    hit = index.by_path.get(path_key(track.path))
    if hit is not None:
        out.track_id, out.how = hit, "path"
        return out
    mapped = apply_map(track.path, maps)
    if mapped is not None:
        hit = index.by_path.get(path_key(mapped))
        if hit is not None:
            out.track_id, out.how = hit, "map"
            out.map_used = next(
                i for i, m in enumerate(maps) if apply_map(track.path, [m]) is not None
            )
            return out
    for candidate in (track.path, mapped):
        if not candidate or not index.reachable(candidate):
            continue
        try:
            size = Path(candidate).stat().st_size
        except OSError:
            continue
        same_size = index.by_size.get(size, [])
        if same_size:
            if candidate not in hashes:
                try:
                    hashes[candidate] = file_hash(Path(candidate))
                except OSError:
                    hashes[candidate] = ""
            for tid, digest in same_size:
                if digest and digest == hashes[candidate]:
                    out.track_id, out.how = tid, "hash"
                    return out
        out.on_disk = candidate
        return out
    return out


def match(
    collection: ImportedCollection, index: _Index, maps: list[PathMap] | None
) -> tuple[list[Match], list[PathMap]]:
    if maps is None:
        unmatched = [t.path for t in collection.tracks if path_key(t.path) not in index.by_path]
        maps = detect_maps(unmatched, index.paths)
    maps = [m.model_copy(update={"tracks": 0}) for m in maps]
    hashes: dict[str, str] = {}
    out: list[Match] = []
    seen: set[int] = set()
    for track in collection.tracks:
        m = _match_one(track, index, maps, hashes)
        if m.track_id is not None:
            if m.track_id in seen:  # the program lists the same file twice
                continue
            seen.add(m.track_id)
            if m.map_used is not None:
                maps[m.map_used].tracks += 1
        out.append(m)
    return out, [m for m in maps if m.tracks or not collection.tracks]


# ---- the plan ----


@dataclass
class _Current:
    title: str
    duration: float | None
    rating: int | None
    play_count: int | None
    comment: str | None
    key: Key | None
    bpm: float | None
    grid: BeatGrid | None
    grid_source: str
    edited: list[str]
    analysed: bool
    cues: dict[int, dict[str, Any]]
    markers: list[tuple[str, float]]


@dataclass
class TrackPlan:
    track_id: int | None  # None: a file added to the library on apply
    on_disk: str | None
    title: str
    key: Key | None = None
    bpm: float | None = None
    grid: BeatGrid | None = None
    rating: int | None = None
    play_count: int | None = None
    comment: str | None = None
    cues: list[ImportedCue] = field(default_factory=list)  # hot cues to set
    markers: list[ImportedCue] = field(default_factory=list)

    def empty(self) -> bool:
        return not (
            self.key or self.bpm or self.grid or self.rating is not None
            or self.play_count is not None or self.comment is not None
            or self.cues or self.markers
        )  # fmt: skip


def _current(db: Database, track_ids: list[int]) -> dict[int, _Current]:
    out: dict[int, _Current] = {}
    for start in range(0, len(track_ids), 500):
        chunk = track_ids[start : start + 500]
        marks = ", ".join("?" for _ in chunk)
        for r in db.conn.execute(
            "SELECT t.id, t.display_title, t.duration, t.rating, t.play_count, t.comment, "
            "t.status, a.key_root, a.key_mode, a.bpm, a.beat_grid, "
            "COALESCE(a.grid_source, 'auto') AS grid_source, "
            "COALESCE(a.edited_fields, '[]') AS edited "
            f"FROM tracks t LEFT JOIN analysis a ON a.track_id = t.id WHERE t.id IN ({marks})",
            chunk,
        ):
            out[int(r["id"])] = _Current(
                title=r["display_title"],
                duration=r["duration"],
                rating=r["rating"],
                play_count=r["play_count"],
                comment=r["comment"],
                key=Key(r["key_root"], r["key_mode"]) if r["key_root"] is not None else None,
                bpm=r["bpm"],
                grid=BeatGrid(**json.loads(r["beat_grid"])) if r["beat_grid"] else None,
                grid_source=r["grid_source"],
                edited=json.loads(r["edited"]),
                analysed=r["status"] == "ready",
                cues={},
                markers=[],
            )
        for r in db.conn.execute(
            "SELECT track_id, slot, position_sec, label, color, source FROM cues "
            f"WHERE track_id IN ({marks})",
            chunk,
        ):
            out[int(r["track_id"])].cues[int(r["slot"])] = dict(r)
        for r in db.conn.execute(
            f"SELECT track_id, kind, position_sec FROM markers WHERE track_id IN ({marks})", chunk
        ):
            out[int(r["track_id"])].markers.append((r["kind"], float(r["position_sec"])))
    return out


def _clock(seconds: float) -> str:
    minutes, rest = divmod(max(0.0, seconds), 60.0)
    return f"{int(minutes)}:{rest:05.2f}"


def _cue_text(slot: int, position: float, name: str | None) -> str:
    return " · ".join(p for p in (f"#{slot + 1}", _clock(position), name or "") if p)


def _grid_text(grid: BeatGrid) -> str:
    if grid.anchors:
        return f"{grid.bpm:.2f} BPM · {len(grid.anchors)} ↔ · {grid.first_downbeat:.3f} s"
    return f"{grid.bpm:.2f} BPM · {grid.first_downbeat:.3f} s"


def _same_grid(a: BeatGrid, b: BeatGrid) -> bool:
    return (
        a.kind == b.kind
        and abs(a.bpm - b.bpm) < 0.005
        and abs(a.first_downbeat - b.first_downbeat) < 0.002
        and len(a.beats or []) == len(b.beats or [])
    )


@dataclass
class _Report:
    counts: dict[ImportField, list[int]] = field(
        default_factory=lambda: {f: [0, 0, 0] for f in FIELDS}
    )  # changes, conflicts, kept
    changes: list[ImportChange] = field(default_factory=list)

    def change(
        self, track_id: int, title: str, name: ImportField, before: str | None, after: str | None,
        conflict: bool, user: bool,
    ) -> None:  # fmt: skip
        self.counts[name][0] += 1
        self.counts[name][1] += int(conflict)
        if len(self.changes) < IMPORT_ITEMS_MAX:
            self.changes.append(
                ImportChange(
                    track_id=track_id, title=title, field=name, before=before, after=after,
                    conflict=conflict, user=user,
                )
            )  # fmt: skip

    def kept(self, name: ImportField) -> None:
        self.counts[name][2] += 1


def _decide(policy: ImportFieldPolicy, has_value: bool, is_user: bool) -> bool:
    if policy == "keep":
        return False
    if policy == "fill":
        return not has_value and not is_user
    return True


def plan_track(
    m: Match, cur: _Current, policy: ImportPolicy, notation: Notation, report: _Report
) -> TrackPlan:
    t = m.track
    assert m.track_id is not None
    tid = m.track_id
    plan = TrackPlan(tid, None, cur.title)

    def consider(
        name: ImportField, has_value: bool, same: bool, is_user: bool,
        before: str | None, after: str | None,
    ) -> bool:  # fmt: skip
        if same:
            return False
        if _decide(getattr(policy, name), has_value, is_user):
            report.change(tid, cur.title, name, before, after, has_value, is_user)
            return True
        report.kept(name)
        return False

    if t.key is not None and consider(
        "key", cur.key is not None, cur.key == t.key, "key" in cur.edited,
        format_key(cur.key, notation) if cur.key else None, format_key(t.key, notation),
    ):  # fmt: skip
        plan.key = t.key
    grid: BeatGrid | None = None
    if t.grid is not None:
        try:
            grid = grid_mod.build_grid(t.grid, cur.duration or 600.0)
        except grid_mod.GridError:
            grid = None
    if grid is not None and consider(
        "grid", cur.grid is not None, cur.grid is not None and _same_grid(cur.grid, grid),
        cur.grid_source == "user",
        _grid_text(cur.grid) if cur.grid else None, _grid_text(grid),
    ):  # fmt: skip
        plan.grid = grid
    bpm = (plan.grid.bpm if plan.grid else None) or t.bpm
    if bpm and consider(
        "bpm", cur.bpm is not None, cur.bpm is not None and abs(cur.bpm - bpm) < 0.005,
        "bpm" in cur.edited,
        f"{cur.bpm:.2f}" if cur.bpm else None, f"{bpm:.2f}",
    ):  # fmt: skip
        plan.bpm = round(bpm, 4)
    if t.rating is not None and consider(
        "rating", bool(cur.rating), cur.rating == t.rating, False,
        str(cur.rating) if cur.rating else None, str(t.rating),
    ):  # fmt: skip
        plan.rating = t.rating
    if t.play_count is not None and consider(
        "play_count", cur.play_count is not None, cur.play_count == t.play_count, False,
        str(cur.play_count) if cur.play_count is not None else None, str(t.play_count),
    ):  # fmt: skip
        plan.play_count = t.play_count
    comment = (t.comment or "").strip()
    if comment and consider(
        "comment", bool((cur.comment or "").strip()), (cur.comment or "").strip() == comment,
        False, cur.comment or None, comment,
    ):  # fmt: skip
        plan.comment = comment

    hot = {c.slot: c for c in t.cues if c.kind == "hot" and c.slot is not None}
    for slot, cue in sorted(hot.items()):
        old = cur.cues.get(slot)
        same = (
            old is not None
            and abs(old["position_sec"] - cue.position) < 0.001
            and (old["label"] or None) == cue.name
            and (cue.color is None or (old["color"] or "").upper() == cue.color)
        )
        taken = old is not None and old["source"] != "auto"
        before = _cue_text(slot, old["position_sec"], old["label"]) if old else None
        if consider(
            "cues", taken, same, old is not None and old["source"] == "user",
            before, _cue_text(slot, cue.position, cue.name),
        ):  # fmt: skip
            plan.cues.append(cue)
    if policy.cues != "keep":
        for cue in t.cues:
            if cue.kind == "hot":
                continue
            if not any(
                k == cue.kind and abs(p - cue.position) < SAME_PLACE for k, p in cur.markers
            ):
                plan.markers.append(cue)
    return plan


def plan_new(m: Match) -> TrackPlan:
    t = m.track
    hot = {c.slot: c for c in t.cues if c.kind == "hot" and c.slot is not None}
    return TrackPlan(
        None, m.on_disk, t.title or Path(m.on_disk or t.path).stem,
        key=t.key, bpm=t.bpm, rating=t.rating, play_count=t.play_count,
        comment=(t.comment or "").strip() or None,
        cues=[hot[s] for s in sorted(hot)],
        markers=[c for c in t.cues if c.kind != "hot"],
    )  # fmt: skip


# ---- writing ----

TRACK_COLUMNS = ("rating", "play_count", "comment")
ANALYSIS_COLUMNS = (
    "key_root", "key_mode", "key_confidence", "bpm", "bpm_confidence", "beat_grid",
    "grid_source", "grid_locked", "beat_grid_auto", "bpm_auto", "edited_fields",
    "imported_fields",
)  # fmt: skip
ANALYSIS_DEFAULTS: dict[str, Any] = {
    "grid_source": "auto", "grid_locked": 0, "edited_fields": "[]", "imported_fields": "[]",
}  # fmt: skip


def _state(db: Database, tid: int) -> dict[str, Any]:
    conn = db.conn
    track = conn.execute(
        f"SELECT {', '.join(TRACK_COLUMNS)} FROM tracks WHERE id = ?", (tid,)
    ).fetchone()
    analysis = conn.execute(
        f"SELECT {', '.join(ANALYSIS_COLUMNS)} FROM analysis WHERE track_id = ?", (tid,)
    ).fetchone()
    return {
        "track": dict(track) if track else {},
        "analysis": dict(analysis) if analysis else None,
        "cues": [
            dict(r)
            for r in conn.execute(
                "SELECT id, slot, position_sec, label, color, source FROM cues "
                "WHERE track_id = ? ORDER BY slot",
                (tid,),
            )
        ],
        "segments": [
            dict(r)
            for r in conn.execute(
                "SELECT start_sec, end_sec, label, energy FROM segments "
                "WHERE track_id = ? ORDER BY start_sec",
                (tid,),
            )
        ],
    }


def _add_field(raw: str | None, name: str) -> str:
    items = json.loads(raw or "[]")
    return json.dumps(items if name in items else [*items, name])


def _drop_field(raw: str | None, name: str) -> str:
    return json.dumps([x for x in json.loads(raw or "[]") if x != name])


def write_plan(
    db: Database, tid: int, plan: TrackPlan, duration: float | None
) -> tuple[int, list[int]]:
    """Write one track's plan; returns (hot cues written, new marker ids)."""
    conn = db.conn
    # Without sections (not analysed yet) there are no automatic cues to place again.
    has_segments = (
        conn.execute("SELECT 1 FROM segments WHERE track_id = ? LIMIT 1", (tid,)).fetchone()
        is not None
    )
    if plan.rating is not None or plan.play_count is not None or plan.comment is not None:
        sets = {
            k: v
            for k, v in (
                ("rating", plan.rating), ("play_count", plan.play_count),
                ("comment", plan.comment),
            )
            if v is not None
        }  # fmt: skip
        conn.execute(
            f"UPDATE tracks SET {', '.join(f'{k} = ?' for k in sets)} WHERE id = ?",
            (*sets.values(), tid),
        )
    if plan.key or plan.bpm or plan.grid:
        conn.execute("INSERT OR IGNORE INTO analysis (track_id) VALUES (?)", (tid,))
        row = conn.execute(
            "SELECT beat_grid, bpm, grid_source, edited_fields, imported_fields "
            "FROM analysis WHERE track_id = ?",
            (tid,),
        ).fetchone()
        edited, imported = row["edited_fields"], row["imported_fields"]
        if plan.key is not None:
            conn.execute(
                "UPDATE analysis SET key_root = ?, key_mode = ?, key_confidence = NULL "
                "WHERE track_id = ?",
                (plan.key.root, plan.key.mode, tid),
            )
            edited, imported = _drop_field(edited, "key"), _add_field(imported, "key")
        if plan.grid is not None:
            if row["grid_source"] == "auto" and row["beat_grid"]:
                conn.execute(
                    "UPDATE analysis SET beat_grid_auto = beat_grid, bpm_auto = bpm "
                    "WHERE track_id = ?",
                    (tid,),
                )
            conn.execute(
                "UPDATE analysis SET beat_grid = ?, grid_source = 'import', grid_locked = 1 "
                "WHERE track_id = ?",
                (json.dumps(asdict(plan.grid)), tid),
            )
        if plan.bpm is not None:
            conn.execute(
                "UPDATE analysis SET bpm = ?, bpm_confidence = NULL WHERE track_id = ?",
                (plan.bpm, tid),
            )
            edited, imported = _drop_field(edited, "bpm"), _add_field(imported, "bpm")
        conn.execute(
            "UPDATE analysis SET edited_fields = ?, imported_fields = ? WHERE track_id = ?",
            (edited, imported, tid),
        )
        if plan.grid is not None and has_segments:
            grid_mod._apply(db, tid, plan.grid, duration or 600.0)
    for cue in plan.cues:
        conn.execute(
            "INSERT INTO cues (track_id, slot, position_sec, label, color, source) "
            "VALUES (?, ?, ?, ?, ?, 'import') ON CONFLICT (track_id, slot) DO UPDATE SET "
            "position_sec = excluded.position_sec, label = excluded.label, "
            "color = excluded.color, source = 'import'",
            (tid, cue.slot, round(cue.position, 4), cue.name, cue.color),
        )
    if plan.cues and has_segments:
        refresh_auto_cues(db, tid)  # the automatic cues make room for the imported ones
    marker_ids = []
    for m in plan.markers:
        cur = conn.execute(
            "INSERT INTO markers (track_id, kind, position_sec, length_sec, label, color, source)"
            " VALUES (?, ?, ?, ?, ?, ?, 'import')",
            (
                tid, m.kind, round(m.position, 4),
                round(m.length, 4) if m.length else None, m.name, m.color,
            ),
        )  # fmt: skip
        marker_ids.append(int(cur.lastrowid or 0))
    return len(plan.cues), marker_ids


# ---- playlists ----


def _playlist_snapshot(db: Database, root_id: int) -> dict[str, list[dict[str, Any]]]:
    ids = [root_id]
    i = 0
    while i < len(ids):
        ids += [
            int(r[0])
            for r in db.conn.execute("SELECT id FROM playlists WHERE parent_id = ?", (ids[i],))
        ]
        i += 1
    marks = ", ".join("?" for _ in ids)
    return {
        "playlists": [
            dict(r)
            for r in db.conn.execute(
                "SELECT id, parent_id, name, emoji, is_folder, sort_order, smart_query "
                f"FROM playlists WHERE id IN ({marks}) ORDER BY id",
                ids,
            )
        ],
        "tracks": [
            dict(r)
            for r in db.conn.execute(
                f"SELECT playlist_id, track_id, position FROM playlist_tracks "
                f"WHERE playlist_id IN ({marks})",
                ids,
            )
        ],
    }


def _count_playlists(nodes: Iterable[ImportedPlaylist]) -> int:
    return sum((0 if n.is_folder else 1) + _count_playlists(n.children) for n in nodes)


def write_playlists(
    db: Database, folder: str, nodes: list[ImportedPlaylist], resolve: Callable[[str], int | None]
) -> tuple[int, dict[str, Any] | None]:
    """Put the playlists in a top folder ``folder`` (replacing one with that name).
    Returns the new folder's id and what the replaced one held."""
    conn = db.conn
    old = conn.execute(
        "SELECT id, sort_order FROM playlists WHERE parent_id IS NULL AND is_folder = 1 "
        "AND name = ? ORDER BY id LIMIT 1",
        (folder,),
    ).fetchone()
    replaced = _playlist_snapshot(db, int(old["id"])) if old else None
    if old:
        conn.execute("DELETE FROM playlists WHERE id = ?", (old["id"],))
        order = int(old["sort_order"])
    else:
        order = int(
            conn.execute(
                "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM playlists WHERE parent_id IS NULL"
            ).fetchone()[0]
        )

    def insert(parent: int | None, name: str, is_folder: bool, position: int) -> int:
        cur = conn.execute(
            "INSERT INTO playlists (parent_id, name, is_folder, sort_order) VALUES (?, ?, ?, ?)",
            (parent, name.strip() or "Playlist", int(is_folder), position),
        )
        return int(cur.lastrowid or 0)

    def fill(playlist_id: int, paths: list[str]) -> None:
        ids = list(dict.fromkeys(t for t in (resolve(p) for p in paths) if t is not None))
        conn.executemany(
            "INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)",
            [(playlist_id, tid, i) for i, tid in enumerate(ids)],
        )

    def walk(parent: int, items: list[ImportedPlaylist]) -> None:
        for i, node in enumerate(items):
            if node.children:
                sub = insert(parent, node.name, True, i)
                if node.paths:  # a crate with tracks and subcrates: its tracks go first
                    fill(insert(sub, node.name, False, 0), node.paths)
                walk(sub, node.children)
            else:
                pid = insert(parent, node.name, node.is_folder, i)
                if not node.is_folder:
                    fill(pid, node.paths)

    root = insert(None, folder, True, order)
    walk(root, nodes)
    return root, replaced


# ---- the import ----


def _notation(db: Database) -> Notation:
    value = db.get_setting("notation", "alphanumeric")
    known = ("alphanumeric", "open_key", "classical", "classical_flat")
    return value if value in known else "alphanumeric"


def run(
    db: Database,
    library: Library,
    options: ImportOptions,
    simulate: bool,
    progress: Callable[[str, float], None] = lambda *_: None,
    check_cancelled: Callable[[], None] = lambda: None,
) -> ImportReport:
    path = _resolve(options)
    policy = options.policy or ImportPolicy.model_validate(db.get_setting("import_policy", {}))
    index = _Index.load(db)
    own = network_share(str(path))
    if own:
        index.shares.add(own)
    progress("reading", 0)

    # Serato's cues live in the files: every file on disk is opened (one may match by
    # its contents or be added), except on network shares the user does not use.
    collection = read_collection(
        options.source, path, index.reachable, lambda f: progress("reading", 40 * f)
    )
    warnings = list(collection.warnings)
    if running(options.source):
        warnings.insert(0, ImportWarning(code="app_running"))
    check_cancelled()
    progress("matching", 40)
    matches, maps = match(collection, index, options.path_maps)
    matched = [m for m in matches if m.track_id is not None]
    current = _current(db, [m.track_id for m in matched if m.track_id is not None])
    report = _Report()
    notation = _notation(db)
    plans = []
    for i, m in enumerate(matched):
        if i % 500 == 0:
            check_cancelled()
        assert m.track_id is not None
        plans.append(plan_track(m, current[m.track_id], policy, notation, report))
    new = [m for m in matches if m.track_id is None and m.on_disk]
    missing = [m for m in matches if m.track_id is None and not m.on_disk]
    unmatched = [
        ImportUnmatched(
            path=m.on_disk or m.track.path, title=m.track.title, artist=m.track.artist,
            on_disk=m.on_disk is not None,
        )
        for m in [*new, *missing][:IMPORT_ITEMS_MAX]
    ]  # fmt: skip
    by_how = Counter(m.how for m in matched)
    folder = FOLDER_NAMES[options.language].format(program=PROGRAMS[options.source])
    out = ImportReport(
        source=options.source,
        simulated=simulate,
        path=str(path),
        tracks=len(collection.tracks),
        matched={h: by_how.get(h, 0) for h in ("path", "hash", "map")},
        new=len(new),
        missing=len(missing),
        path_maps=maps,
        fields=[
            ImportFieldCount(field=f, changes=c[0], conflicts=c[1], kept=c[2])
            for f, c in report.counts.items()
        ],
        cues=sum(len(p.cues) for p in plans),
        markers=sum(len(p.markers) for p in plans),
        playlists=_count_playlists(collection.playlists) if options.playlists else 0,
        folder=folder if options.playlists and collection.playlists else None,
        warnings=warnings,
        changes=report.changes,
        unmatched=unmatched,
    )
    if options.add_missing:
        out.cues += sum(len(plan_new(m).cues) for m in new)
        out.markers += sum(len(plan_new(m).markers) for m in new)
    if simulate:
        return out
    progress("writing", 60)
    return _apply(db, library, options, out, matches, plans, new, collection, folder, maps,
                  progress, check_cancelled)  # fmt: skip


def _apply(
    db: Database,
    library: Library,
    options: ImportOptions,
    out: ImportReport,
    matches: list[Match],
    plans: list[TrackPlan],
    new: list[Match],
    collection: ImportedCollection,
    folder: str,
    maps: list[PathMap],
    progress: Callable[[str, float], None],
    check_cancelled: Callable[[], None],
) -> ImportReport:
    conn = db.conn
    undo: dict[str, Any] = {"tracks": {}, "markers": [], "added": [], "playlist": None,
                            "replaced": None}  # fmt: skip
    resolved: dict[str, int] = {}
    for m in matches:
        if m.track_id is not None:
            resolved[path_key(m.track.path)] = m.track_id
    conn.execute("BEGIN")
    try:
        work = [p for p in plans if not p.empty()]
        if options.add_missing:
            for m in new:
                check_cancelled()
                assert m.on_disk is not None
                result = AddPathsResult()
                library._add_one(Path(m.on_disk), result)
                row = conn.execute(
                    "SELECT id FROM tracks WHERE path = ?", (str(Path(m.on_disk)),)
                ).fetchone()
                if row is None or not result.added:
                    continue
                tid = int(row[0])
                undo["added"].append(tid)
                resolved[path_key(m.track.path)] = tid
                plan = plan_new(m)
                plan.track_id = tid
                work.append(plan)
        durations = {
            int(r[0]): r[1]
            for r in conn.execute("SELECT id, duration FROM tracks")
        } if work else {}  # fmt: skip
        added = set(undo["added"])
        for i, plan in enumerate(work):
            if i % 200 == 0:
                check_cancelled()
                progress("writing", 60 + 35 * i / max(1, len(work)))
            assert plan.track_id is not None
            tid = plan.track_id
            before = None if tid in added else _state(db, tid)
            _, marker_ids = write_plan(db, tid, plan, durations.get(tid))
            undo["markers"] += marker_ids
            if before is not None:
                undo["tracks"][str(tid)] = {"before": before, "after": _state(db, tid)}
        if options.playlists and collection.playlists:

            def resolve(p: str) -> int | None:
                key = path_key(p)
                if key in resolved:
                    return resolved[key]
                mapped = apply_map(p, maps)
                return resolved.get(path_key(mapped)) if mapped else None

            root, replaced = write_playlists(db, folder, collection.playlists, resolve)
            undo["playlist"], undo["replaced"] = root, replaced
        batch_id = uuid.uuid4().hex
        summary = {
            "path": out.path, "tracks": len(undo["tracks"]) + len(undo["added"]),
            "cues": out.cues, "playlists": out.playlists, "added": len(undo["added"]),
        }  # fmt: skip
        conn.execute(
            "INSERT INTO import_batches (batch_id, source, summary, undo_data) VALUES (?, ?, ?, ?)",
            (
                batch_id, options.source, json.dumps(summary),
                zlib.compress(json.dumps(undo).encode("utf-8")),
            ),
        )  # fmt: skip
        conn.execute("COMMIT")
    except BaseException:
        if conn.in_transaction:
            conn.execute("ROLLBACK")
        raise
    progress("writing", 100)
    out.batch_id = batch_id
    out.added = len(undo["added"])
    return out


# ---- undo and history ----


def _restore_rows(db: Database, table: str, tid: int, rows: list[dict[str, Any]]) -> None:
    db.conn.execute(f"DELETE FROM {table} WHERE track_id = ?", (tid,))
    for row in rows:
        cols = ", ".join(["track_id", *row])
        marks = ", ".join("?" for _ in range(len(row) + 1))
        db.conn.execute(f"INSERT INTO {table} ({cols}) VALUES ({marks})", (tid, *row.values()))


def _undo_track(db: Database, tid: int, before: dict[str, Any], after: dict[str, Any]) -> int:
    """Put back what is still as the import left it; returns how many parts were left."""
    now = _state(db, tid)
    if not now["track"]:
        return 0  # removed from the library since
    conn = db.conn
    skipped = 0
    for col in TRACK_COLUMNS:
        if now["track"][col] == after["track"][col]:
            conn.execute(f"UPDATE tracks SET {col} = ? WHERE id = ?", (before["track"][col], tid))
        elif before["track"][col] != after["track"][col]:
            skipped += 1
    if after["analysis"] is not None and now["analysis"] is not None:
        if before["analysis"] is None and now["analysis"] == after["analysis"]:
            conn.execute("DELETE FROM analysis WHERE track_id = ?", (tid,))
        else:
            old = before["analysis"] or {c: ANALYSIS_DEFAULTS.get(c) for c in ANALYSIS_COLUMNS}
            for col in ANALYSIS_COLUMNS:
                if now["analysis"][col] == after["analysis"][col]:
                    conn.execute(
                        f"UPDATE analysis SET {col} = ? WHERE track_id = ?", (old[col], tid)
                    )
                elif old[col] != after["analysis"][col]:
                    skipped += 1
    if now["segments"] == after["segments"]:
        conn.execute("DELETE FROM segments WHERE track_id = ?", (tid,))
        conn.executemany(
            "INSERT INTO segments (track_id, start_sec, end_sec, label, energy) "
            "VALUES (?, ?, ?, ?, ?)",
            [(tid, s["start_sec"], s["end_sec"], s["label"], s["energy"])
             for s in before["segments"]],
        )  # fmt: skip
    if now["cues"] == after["cues"]:
        _restore_rows(db, "cues", tid, before["cues"])
    else:
        old_slots = {c["slot"]: c for c in before["cues"]}
        new_slots = {c["slot"]: c for c in after["cues"]}
        for c in now["cues"]:
            if new_slots.get(c["slot"]) == c and old_slots.get(c["slot"]) != c:
                conn.execute("DELETE FROM cues WHERE id = ?", (c["id"],))
                if c["slot"] in old_slots:
                    o = old_slots[c["slot"]]
                    conn.execute(
                        "INSERT INTO cues (track_id, slot, position_sec, label, color, source) "
                        "VALUES (?, ?, ?, ?, ?, ?)",
                        (tid, o["slot"], o["position_sec"], o["label"], o["color"], o["source"]),
                    )
            elif new_slots.get(c["slot"]) != c and old_slots.get(c["slot"]) != c:
                skipped += 1
    return skipped


def undo(db: Database, library: Library, batch_id: str) -> ImportUndoResult:
    row = db.conn.execute(
        "SELECT undo_data, undone_at FROM import_batches WHERE batch_id = ?", (batch_id,)
    ).fetchone()
    if row is None:
        raise TonaliaError(f"import batch {batch_id} not found", reason="batch_not_found")
    if row["undone_at"]:
        raise TonaliaError("this import was already undone", reason="undo_changed")
    data = json.loads(zlib.decompress(row["undo_data"]).decode("utf-8"))
    conn = db.conn
    conn.execute("BEGIN")
    try:
        if data["playlist"] is not None:
            conn.execute("DELETE FROM playlists WHERE id = ?", (data["playlist"],))
        replaced = data["replaced"]
        if replaced:
            for p in replaced["playlists"]:
                conn.execute(
                    "INSERT OR IGNORE INTO playlists (id, parent_id, name, emoji, is_folder, "
                    "sort_order, smart_query) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    tuple(p.values()),
                )
            conn.executemany(
                "INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position) "
                "SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM tracks WHERE id = ?)",
                [(t["playlist_id"], t["track_id"], t["position"], t["track_id"])
                 for t in replaced["tracks"]],
            )  # fmt: skip
        marks = data["markers"]
        for start in range(0, len(marks), 500):
            chunk = marks[start : start + 500]
            conn.execute(
                f"DELETE FROM markers WHERE id IN ({', '.join('?' for _ in chunk)})", chunk
            )
        skipped = 0
        for tid, states in data["tracks"].items():
            skipped += _undo_track(db, int(tid), states["before"], states["after"])
        removed = library.remove(data["added"]) if data["added"] else 0
        conn.execute(
            "UPDATE import_batches SET undone_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') "
            "WHERE batch_id = ?",
            (batch_id,),
        )
        if conn.in_transaction:
            conn.execute("COMMIT")
    except BaseException:
        if conn.in_transaction:
            conn.execute("ROLLBACK")
        raise
    return ImportUndoResult(
        batch_id=batch_id, tracks=len(data["tracks"]), removed=removed, skipped=skipped
    )


def added_tracks(db: Database, batch_id: str) -> list[int]:
    """The tracks an import added to the library (to analyse them)."""
    row = db.conn.execute(
        "SELECT undo_data FROM import_batches WHERE batch_id = ?", (batch_id,)
    ).fetchone()
    if row is None:
        return []
    return [int(t) for t in json.loads(zlib.decompress(row[0]).decode("utf-8"))["added"]]


def history(db: Database) -> ImportHistory:
    rows = db.conn.execute(
        "SELECT batch_id, source, created_at, undone_at, summary FROM import_batches "
        "ORDER BY created_at DESC, rowid DESC"
    ).fetchall()
    out = []
    for r in rows:
        s = json.loads(r["summary"])
        out.append(
            ImportBatch(
                batch_id=r["batch_id"], source=r["source"], created_at=r["created_at"],
                undone_at=r["undone_at"], path=s.get("path", ""), tracks=s.get("tracks", 0),
                cues=s.get("cues", 0), playlists=s.get("playlists", 0), added=s.get("added", 0),
            )
        )  # fmt: skip
    return ImportHistory(batches=out)
