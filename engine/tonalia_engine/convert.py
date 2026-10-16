"""Take a library from one DJ program to another (SPEC 13.2).

The trip is an import into Tonalia (13.1) followed by an export to the target (phase 5),
with the safety of both: the source is only read, the target is backed up and written
atomically, and the import is a batch that ``import.undo`` reverts.

``plan`` runs the whole trip on a private copy of Tonalia's database, so the preview shows
exactly what the export would write (the tracks and playlists as they will be after the
import) without changing anything. ``apply`` plans first, refuses to start if the target
program is open, then imports and exports for real; if the export fails, the import is
undone, so a failed trip leaves Tonalia as it was.

What does not survive the trip comes from what Tonalia writes for each target (the
``LOSSES`` table, mirrored in docs/compatibility.md).
"""

from __future__ import annotations

import sqlite3
import tempfile
from collections.abc import Callable, Iterator, Sequence
from contextlib import contextmanager
from pathlib import Path

from .db import Database
from .errors import TonaliaError
from .export import engine_dj, traktor_nml, virtualdj
from .import_ import service as import_service
from .jobs import JobContext
from .keys import Notation
from .library import Library
from .rpc_schema import (
    ConvertLoss,
    ConvertLossCode,
    ConvertOptions,
    ConvertReport,
    ExportOptions,
    ExportResult,
    ImportOptions,
    ImportPolicy,
    ImportSource,
)

Exporter = Callable[[Database, ExportOptions, JobContext], ExportResult]

# Everything the source program has wins: that is what the DJ wants in the target.
TAKE_ALL = ImportPolicy(
    cues="take", grid="take", key="take", bpm="take", rating="take", play_count="take",
    comment="take",
)  # fmt: skip

NOTATION: dict[ImportSource, Notation] = {"traktor": "open_key"}  # others read classical

# What each target loses of what Tonalia holds (see the module docstring).
LOSSES: dict[ImportSource, tuple[ConvertLossCode, ...]] = {
    "rekordbox": ("markers", "rating", "play_count"),
    "traktor": ("cue_colors", "variable_tempo", "markers", "rating", "play_count", "comment"),
    "serato": (
        "cue_colors_palette", "beatgrid", "key_bpm_tags", "markers", "rating", "play_count",
        "comment",
    ),
    "virtualdj": ("cue_colors", "variable_tempo", "markers", "rating", "play_count", "comment"),
    "engine_dj": ("markers", "rating", "play_count", "comment"),
}  # fmt: skip

# Targets whose collection cannot be written while the program is open.
RUNNING: dict[ImportSource, Callable[[], bool]] = {
    "traktor": traktor_nml.traktor_running,
    "virtualdj": virtualdj.virtualdj_running,
    "engine_dj": engine_dj.engine_running,
}

PROGRAMS = import_service.PROGRAMS


def import_options(options: ConvertOptions) -> ImportOptions:
    return ImportOptions(
        source=options.source,
        path=options.source_path,
        policy=options.policy or TAKE_ALL,
        path_maps=options.path_maps,
        playlists=options.playlists,
        add_missing=options.add_missing,
        language=options.language,
    )


def export_options(
    db: Database, options: ConvertOptions, applied: import_service.Applied, simulate: bool
) -> ExportOptions:
    """The collection's tracks and, as the playlist tree, what is inside the "Imported
    from …" folder (the target gets the DJ's playlists, not a folder named after the
    source)."""
    children: list[int] = []
    if options.playlists and applied.folder_id is not None:
        children = [
            int(r[0])
            for r in db.conn.execute(
                "SELECT id FROM playlists WHERE parent_id = ? ORDER BY sort_order, id",
                (applied.folder_id,),
            )
        ]
    return ExportOptions(
        simulate=simulate,
        path=None if options.target == "serato" else options.target_path,
        track_ids=applied.track_ids,
        playlist_ids=children or None,
        include_playlists=bool(children),
        notation=NOTATION.get(options.target, "classical"),
        language=options.language,
    )


def _chunks(ids: Sequence[int]) -> Iterator[tuple[str, list[int]]]:
    for start in range(0, len(ids), 500):
        chunk = list(ids[start : start + 500])
        yield ", ".join("?" for _ in chunk), chunk


def _count(db: Database, ids: Sequence[int], sql: str) -> tuple[int, int]:
    """(rows, distinct tracks) of ``sql``, which selects ``track_id`` with ``{ids}``."""
    rows = tracks = 0
    for marks, chunk in _chunks(ids):
        r = db.conn.execute(
            f"SELECT COUNT(*), COUNT(DISTINCT track_id) FROM ({sql.format(ids=marks)})", chunk
        ).fetchone()
        rows, tracks = rows + int(r[0]), tracks + int(r[1])
    return rows, tracks


_SQL: dict[ConvertLossCode, str] = {
    "cue_colors": "SELECT track_id FROM cues WHERE color IS NOT NULL AND track_id IN ({ids})",
    "variable_tempo": (
        "SELECT track_id FROM analysis WHERE json_extract(beat_grid, '$.kind') = 'variable' "
        "AND track_id IN ({ids})"
    ),
    "beatgrid": "SELECT track_id FROM analysis WHERE beat_grid IS NOT NULL AND track_id IN ({ids})",
    "key_bpm_tags": (
        "SELECT track_id FROM analysis WHERE (key_root IS NOT NULL OR bpm IS NOT NULL) "
        "AND track_id IN ({ids})"
    ),
    "markers": "SELECT track_id FROM markers WHERE track_id IN ({ids})",
    "rating": "SELECT id AS track_id FROM tracks WHERE rating > 0 AND id IN ({ids})",
    "play_count": "SELECT id AS track_id FROM tracks WHERE play_count > 0 AND id IN ({ids})",
}
_SQL["cue_colors_palette"] = _SQL["cue_colors"]
_MANY = {"cue_colors", "cue_colors_palette", "markers"}  # several per track


def losses(
    db: Database,
    target: ImportSource,
    applied: import_service.Applied,
    unreachable: int,
) -> list[ConvertLoss]:
    out: list[ConvertLoss] = []
    for code in LOSSES[target]:
        if code == "comment":
            n, items = applied.comments, 0
        else:
            items, n = _count(db, applied.track_ids, _SQL[code])
        if n:
            out.append(ConvertLoss(code=code, tracks=n, items=items if code in _MANY else 0))
    if unreachable:
        out.append(ConvertLoss(code="not_in_tonalia", tracks=unreachable))
    return out


@contextmanager
def _private_copy(db: Database) -> Iterator[tuple[Database, Path]]:
    """A copy of Tonalia's database in a private folder (removed afterwards)."""
    with tempfile.TemporaryDirectory(prefix="tonalia-convert-") as scratch:
        folder = Path(scratch)
        path = folder / "plan.db"
        target = sqlite3.connect(path)
        try:
            db.conn.backup(target)
        finally:
            target.close()
        copy = Database.open(path)
        try:
            yield copy, folder
        finally:
            copy.close()


def _trip(
    db: Database,
    library: Library,
    options: ConvertOptions,
    simulate: bool,
    export: Exporter,
    job: JobContext,
) -> ConvertReport:
    holder: list[import_service.Applied] = []
    report = import_service.run(
        db,
        library,
        import_options(options),
        simulate=False,
        progress=lambda stage, percent: job.progress(stage, percent * 0.6),
        check_cancelled=job.check_cancelled,
        on_applied=holder.append,
    )
    applied = holder[0]
    unreachable = report.missing + report.new - report.added
    found = losses(db, options.target, applied, unreachable)
    job.progress("exporting", 60)
    try:
        result = export(db, export_options(db, options, applied, simulate), job)
    except BaseException:
        if not simulate and report.batch_id:
            import_service.undo(db, library, report.batch_id)
        raise
    job.progress("exporting", 100)
    return ConvertReport(
        source=options.source,
        target=options.target,
        simulated=simulate,
        import_report=report,
        export_result=result,
        losses=found,
    )


def plan(db: Database, options: ConvertOptions, export: Exporter, job: JobContext) -> ConvertReport:
    """The whole trip on a private copy: what would be imported, exported and lost."""
    with _private_copy(db) as (copy, folder):
        out = _trip(copy, Library(copy, folder / "artwork"), options, True, export, job)
    # The import ran on the copy: to the user it is a preview.
    out.import_report.simulated = True
    out.import_report.batch_id = None
    return out


def apply(
    db: Database, library: Library, options: ConvertOptions, export: Exporter, job: JobContext
) -> ConvertReport:
    plan(db, options, export, job)  # a trip that would fail stops here, before writing
    running = RUNNING.get(options.target)
    if running is not None and running():
        name = PROGRAMS[options.target]
        raise TonaliaError(
            f"{name} is open: close it before converting", reason="program_running", program=name
        )
    job.progress("importing", 0, force=True)
    return _trip(db, library, options, False, export, job)
