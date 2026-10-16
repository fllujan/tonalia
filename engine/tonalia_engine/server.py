"""Engine method registry and shared runtime state."""

from __future__ import annotations

import platform
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import TypeVar

from pydantic import BaseModel

from . import PROTOCOL_VERSION, __version__, convert, cue_review, energy_personal, playlist_builder
from . import cues as cues_mod
from . import duplicates as duplicates_mod
from . import gpu_runtime as gpu_runtime_mod
from . import grid as grid_mod
from . import history as history_mod
from . import render as render_mod
from . import stem_export as stem_export_mod
from . import stems as stems_mod
from . import suggest as suggest_mod
from .analysis.queue import AnalysisQueue, recover_interrupted
from .db import Database
from .errors import TonaliaError
from .export import engine_dj, serato_markers, traktor_nml, virtualdj
from .export.common import scoped
from .export.rekordbox_xml import export_rekordbox
from .favorites import FavoriteError, Favorites
from .fsutil import move_to_trash
from .import_ import service as import_service
from .jobs import JobContext, JobManager, Notifier
from .library import Library, summaries
from .playlists import PlaylistError, Playlists
from .rpc import INVALID_PARAMS, Dispatcher, Params, RpcError, parse_params
from .rpc_schema import (
    AddPathsParams,
    AddPathsResult,
    AnalysisStarted,
    AnalysisStartParams,
    BuilderAlternatives,
    BuilderAlternativesParams,
    BuilderGenerateParams,
    BuilderResult,
    BuilderScoreParams,
    CleanParams,
    CollectionStatus,
    ConvertOptions,
    ConvertReport,
    Cue,
    CueDeleteResult,
    CueList,
    CueReviewDeleteParams,
    CueReviewQueue,
    CueReviewQueueParams,
    CueReviewReport,
    CueReviewSetParams,
    CueReviewSetResult,
    CueSetParams,
    CueSlotParams,
    DuplicateList,
    DuplicateResolveParams,
    DuplicateResolveResult,
    DuplicateScanOptions,
    DuplicateScanResult,
    DuplicateUndoParams,
    DuplicateUndoResult,
    EditParams,
    EnergyCalibrateParams,
    EnergyCalibrateResult,
    EnergyCalibrationReport,
    EnergyImportItem,
    EnergyImportParams,
    EnergyImportPreview,
    EnergyImportPreviewParams,
    EnergyImportResult,
    EnergyQueueItem,
    EnergyRateParams,
    EnergyRatingQueue,
    EnergyRatingQueueParams,
    EnergyRevertResult,
    EnergyStatus,
    EventParams,
    ExportOptions,
    ExportResult,
    Favorite,
    FavoriteDeleteResult,
    FavoriteIdParams,
    FavoriteList,
    FavoriteListParams,
    FavoriteSaveParams,
    FavoriteUpdateParams,
    GenreList,
    GridLockParams,
    GridResult,
    GridSnapCuesParams,
    GridUpdateParams,
    HistoryDeleteResult,
    HistoryImportParams,
    HistoryImportResult,
    HistoryList,
    HistoryMarkParams,
    HistoryMarkResult,
    HistoryQuery,
    HistorySessionParams,
    HistorySources,
    ImportHistory,
    ImportOptions,
    ImportReport,
    ImportSource,
    ImportSources,
    ImportUndoParams,
    ImportUndoResult,
    JobCancelParams,
    JobCancelResult,
    JobStarted,
    JobStartedEvent,
    LibraryPage,
    LibraryQuery,
    LibraryStats,
    M3UExportParams,
    M3UExportResult,
    M3UImportParams,
    M3UImportResult,
    PingResult,
    PlaylistCreateParams,
    PlaylistDeleteResult,
    PlaylistIdParams,
    PlaylistMoveParams,
    PlaylistNode,
    PlaylistTracksParams,
    PlaylistTracksResult,
    PlaylistTree,
    PlaylistUpdateParams,
    QualityReviewParams,
    QualityReviewResult,
    RemoveResult,
    RenderPreviewResult,
    RenderResult,
    RenderSpec,
    Settings,
    SettingsUpdate,
    StemExportFormat,
    StemExportNames,
    StemExportParams,
    StemExportResult,
    StemModelParams,
    StemsCacheInfo,
    StemsGetParams,
    StemsGetResult,
    StemsSeparateParams,
    StemsSeparateResult,
    StemsStatus,
    SuggestParams,
    SuggestResult,
    TagHistory,
    TagHistoryParams,
    TagOptions,
    TagPreview,
    TagPreviewParams,
    TagUndoParams,
    TagUndoResult,
    TagWriteParams,
    TagWriteResult,
    TrackDetail,
    TrackIdParams,
    TrackIdsParams,
    TrackUpdateParams,
    VersionResult,
)
from .tags import service as tag_service
from .watcher import FolderWatcher

T = TypeVar("T")


@dataclass
class EngineContext:
    data_dir: Path
    notifier: Notifier
    analysis_workers: int | None = None
    watch_interval: float = 30.0
    db: Database = field(init=False)
    jobs: JobManager = field(init=False)
    analysis: AnalysisQueue = field(init=False)

    def __post_init__(self) -> None:
        self.db = Database.open(self.db_path)
        recover_interrupted(self.db)
        self.jobs = JobManager(self.notifier, max_workers=4)
        self.analysis = AnalysisQueue(
            self.db_path, self.jobs, self.notifier, workers=self.analysis_workers
        )
        self.watcher = FolderWatcher(
            folders=self._watched_folders,
            known=self._known_files,
            start_import=lambda paths: self.start_import("watch.import", paths, analyze=True),
            interval=self.watch_interval,
        )
        self.watcher.start()

    def _watched_folders(self) -> list[str]:
        db = Database.open(self.db_path)
        try:
            folders: list[str] = db.get_setting("watched_folders", [])
            return folders
        finally:
            db.close()

    def _known_files(self) -> dict[str, tuple[int, float]]:
        db = Database.open(self.db_path)
        try:
            rows = db.conn.execute("SELECT path, size, mtime FROM tracks").fetchall()
            return {r["path"]: (r["size"], r["mtime"]) for r in rows}
        finally:
            db.close()

    def start_analysis(self, track_ids: list[int]) -> AnalysisStarted:
        running = self.analysis.job_id
        job_id, queued = self.analysis.enqueue(track_ids)
        if job_id and job_id != running:
            event = JobStartedEvent(job_id=job_id, kind="analysis")
            self.notifier.notify(
                "event", EventParams(type="job.started", payload=event.model_dump(by_alias=True))
            )
        return AnalysisStarted(job_id=job_id, queued=queued)

    def start_import(self, kind: str, paths: list[Path], *, analyze: bool) -> str:
        def run(job: JobContext) -> AddPathsResult:
            # A dedicated connection: imports write in batches while the UI keeps reading.
            db = Database.open(self.db_path)
            try:
                result = self.library(db).add_paths(paths, job)
                if analyze and not job.cancelled:
                    pending = [
                        r[0]
                        for r in db.conn.execute("SELECT id FROM tracks WHERE status = 'pending'")
                    ]
                    self.start_analysis(pending)
                return result
            finally:
                db.close()

        return self.jobs.start(kind, run)

    @property
    def db_path(self) -> Path:
        return self.data_dir / "tonalia.db"

    @property
    def artwork_dir(self) -> Path:
        return self.data_dir / "artwork"

    def library(self, db: Database | None = None) -> Library:
        return Library(db or self.db, self.artwork_dir)

    def close(self) -> None:
        self.watcher.stop()
        self.jobs.shutdown()
        self.db.close()


def build_dispatcher(ctx: EngineContext) -> Dispatcher:
    d = Dispatcher()

    @d.method("engine.ping")
    def ping(_: Params) -> PingResult:
        return PingResult(pong=True)

    @d.method("engine.version")
    def version(_: Params) -> VersionResult:
        return VersionResult(
            version=__version__, protocol=PROTOCOL_VERSION, python=platform.python_version()
        )

    @d.method("job.cancel")
    def job_cancel(params: Params) -> JobCancelResult:
        p = parse_params(JobCancelParams, params)
        return JobCancelResult(cancelled=ctx.jobs.cancel(p.job_id))

    @d.method("library.addPaths")
    def add_paths(params: Params) -> JobStarted:
        p = parse_params(AddPathsParams, params)
        paths = [Path(raw) for raw in p.paths]
        return JobStarted(job_id=ctx.start_import("library.addPaths", paths, analyze=p.analyze))

    start_analysis = ctx.start_analysis

    @d.method("analysis.start")
    def analysis_start(params: Params) -> AnalysisStarted:
        p = parse_params(AnalysisStartParams, params)
        if p.track_ids is not None:
            return start_analysis(p.track_ids)
        statuses = ("pending", "error") if p.include_errors else ("pending",)
        marks = ", ".join("?" for _ in statuses)
        ids = [
            r[0]
            for r in ctx.db.conn.execute(
                f"SELECT id FROM tracks WHERE status IN ({marks}) ORDER BY added_at", statuses
            )
        ]
        return start_analysis(ids)

    @d.method("analysis.reanalyze")
    def analysis_reanalyze(params: Params) -> AnalysisStarted:
        p = parse_params(TrackIdsParams, params)
        ctx.db.conn.executemany(
            "UPDATE tracks SET status = 'pending' WHERE id = ? AND status != 'analyzing'",
            [(tid,) for tid in p.track_ids],
        )
        return start_analysis(p.track_ids)

    @d.method("library.list")
    def library_list(params: Params) -> LibraryPage:
        query = parse_params(LibraryQuery, params)
        return invalid_on_value_error(lambda: ctx.library().list(query))

    @d.method("library.get")
    def library_get(params: Params) -> TrackDetail:
        p = parse_params(TrackIdParams, params)
        try:
            return ctx.library().get(p.track_id)
        except KeyError:
            raise RpcError(
                INVALID_PARAMS, f"unknown track {p.track_id}", reason="track_not_found"
            ) from None

    @d.method("track.update")
    def track_update(params: Params) -> TrackDetail:
        p = parse_params(TrackUpdateParams, params)
        try:
            return ctx.library().update(p)
        except KeyError:
            raise RpcError(
                INVALID_PARAMS, f"unknown track {p.track_id}", reason="track_not_found"
            ) from None

    @d.method("quality.review")
    def quality_review(params: Params) -> QualityReviewResult:
        p = parse_params(QualityReviewParams, params)
        return QualityReviewResult(updated=ctx.library().review_quality(p.track_ids, p.reviewed))

    def energy_status() -> EnergyStatus:
        st = energy_personal.status(ctx.db)
        report = st.calibration
        return EnergyStatus(
            ratings=st.ratings,
            usable=st.usable,
            needed=st.needed,
            model="personal" if st.model == "personal" else "default",
            calibration=EnergyCalibrationReport.model_validate(report) if report else None,
            histogram=st.histogram,
            needs_reanalysis=st.needs_reanalysis,
        )

    @d.method("energy.status")
    def energy_status_method(_: Params) -> EnergyStatus:
        return energy_status()

    @d.method("energy.ratingQueue")
    def energy_rating_queue(params: Params) -> EnergyRatingQueue:
        p = parse_params(EnergyRatingQueueParams, params)
        entries = energy_personal.rating_queue(ctx.db, p.n)
        tracks = summaries(ctx.db.conn, [e.track_id for e in entries])
        items = [
            EnergyQueueItem(track=tracks[e.track_id], start=e.start, energy=e.energy)
            for e in entries
            if e.track_id in tracks
        ]
        return EnergyRatingQueue(items=items, status=energy_status())

    @d.method("energy.rate")
    def energy_rate(params: Params) -> EnergyStatus:
        p = parse_params(EnergyRateParams, params)
        on_track(p.track_id, lambda: energy_personal.rate(ctx.db, p.track_id, p.rating))
        return energy_status()

    @d.method("energy.calibrate")
    def energy_calibrate(params: Params) -> EnergyCalibrateResult:
        p = parse_params(EnergyCalibrateParams, params)
        out = invalid_on_value_error(lambda: energy_personal.calibrate_library(ctx.db, p.apply))
        return EnergyCalibrateResult(
            tracks=out.calibration.tracks,
            mae_before=out.calibration.mae_before,
            mae_after=out.calibration.mae_after,
            applied=out.applied,
            updated=out.updated,
            status=energy_status(),
        )

    @d.method("energy.revert")
    def energy_revert(_: Params) -> EnergyRevertResult:
        return EnergyRevertResult(updated=energy_personal.revert(ctx.db), status=energy_status())

    @d.method("energy.importPreview")
    def energy_import_preview(params: Params) -> EnergyImportPreview:
        p = parse_params(EnergyImportPreviewParams, params)
        found = energy_personal.import_preview(ctx.db, p.patterns, p.fields)
        tracks = summaries(ctx.db.conn, [i.track_id for i in found.items])
        return EnergyImportPreview(
            items=[
                EnergyImportItem(
                    track_id=i.track_id,
                    title=tracks[i.track_id].title if i.track_id in tracks else None,
                    artist=tracks[i.track_id].artist if i.track_id in tracks else None,
                    field=i.field,
                    text=i.text,
                    rating=i.rating,
                    existing=i.existing,
                )
                for i in found.items
            ],
            scanned=found.scanned,
            written_by_tonalia=found.written_by_tonalia,
            unreadable=found.unreadable,
        )

    @d.method("energy.import")
    def energy_import(params: Params) -> EnergyImportResult:
        p = parse_params(EnergyImportParams, params)
        stored = energy_personal.import_ratings(
            ctx.db, [(i.track_id, i.rating) for i in p.items], p.overwrite
        )
        return EnergyImportResult(stored=stored, status=energy_status())

    def invalid_on_value_error(action: Callable[[], T]) -> T:
        try:
            return action()
        except (ValueError, TonaliaError) as exc:
            raise RpcError.wrap(exc) from None

    def on_track(track_id: int, action: Callable[[], T]) -> T:
        try:
            return action()
        except KeyError:
            raise RpcError(
                INVALID_PARAMS, f"unknown track {track_id}", reason="track_not_found"
            ) from None

    @d.method("cues.list")
    def cues_list(params: Params) -> CueList:
        p = parse_params(TrackIdParams, params)
        return CueList(cues=on_track(p.track_id, lambda: cues_mod.list_cues(ctx.db, p.track_id)))

    @d.method("cues.set")
    def cues_set(params: Params) -> Cue:
        p = parse_params(CueSetParams, params)
        return on_track(p.track_id, lambda: cues_mod.set_cue(ctx.db, p))

    @d.method("cues.delete")
    def cues_delete(params: Params) -> CueDeleteResult:
        p = parse_params(CueSlotParams, params)
        deleted = on_track(p.track_id, lambda: cues_mod.delete_cue(ctx.db, p.track_id, p.slot))
        return CueDeleteResult(deleted=deleted)

    @d.method("cues.resetAuto")
    def cues_reset(params: Params) -> CueList:
        p = parse_params(TrackIdParams, params)
        return CueList(
            cues=on_track(p.track_id, lambda: cues_mod.reset_auto_cues(ctx.db, p.track_id))
        )

    # ---- cue review (SPEC 12.5) ----

    @d.method("cueReview.queue")
    def cue_review_queue(params: Params) -> CueReviewQueue:
        p = parse_params(CueReviewQueueParams, params)
        first = p.track_ids[0] if p.track_ids else 0
        return on_track(first, lambda: cue_review.queue(ctx.db, ctx.library(), p.n, p.track_ids))

    @d.method("cueReview.set")
    def cue_review_set(params: Params) -> CueReviewSetResult:
        p = parse_params(CueReviewSetParams, params)

        def run() -> CueReviewSetResult:
            review_id = cue_review.set_verdict(ctx.db, p)
            return CueReviewSetResult(review_id=review_id, report=cue_review.report(ctx.db))

        return on_track(p.track_id, lambda: invalid_on_value_error(run))

    @d.method("cueReview.delete")
    def cue_review_delete(params: Params) -> CueReviewReport:
        p = parse_params(CueReviewDeleteParams, params)
        cue_review.delete_verdict(ctx.db, p.review_id)
        return cue_review.report(ctx.db)

    @d.method("cueReview.report")
    def cue_review_report(params: Params) -> CueReviewReport:
        return cue_review.report(ctx.db)

    # ---- beatgrid editor (SPEC 12.4) ----

    def grid_result(track_id: int) -> GridResult:
        return GridResult(
            track=ctx.library().get(track_id),
            off_beat=grid_mod.user_cues_off_beat(ctx.db, track_id),
        )

    def on_grid(track_id: int, action: Callable[[], None]) -> GridResult:
        def run() -> GridResult:
            action()
            return grid_result(track_id)

        return on_track(track_id, lambda: invalid_on_value_error(run))

    @d.method("grid.update")
    def grid_update(params: Params) -> GridResult:
        p = parse_params(GridUpdateParams, params)
        return on_grid(p.track_id, lambda: grid_mod.update_grid(ctx.db, p.track_id, p.grid))

    @d.method("grid.reset")
    def grid_reset(params: Params) -> GridResult:
        p = parse_params(TrackIdParams, params)
        return on_grid(p.track_id, lambda: grid_mod.reset_grid(ctx.db, p.track_id))

    @d.method("grid.lock")
    def grid_lock(params: Params) -> GridResult:
        p = parse_params(GridLockParams, params)
        return on_grid(p.track_id, lambda: grid_mod.lock_grid(ctx.db, p.track_id, p.locked))

    @d.method("grid.snapCues")
    def grid_snap(params: Params) -> GridResult:
        p = parse_params(GridSnapCuesParams, params)
        return on_grid(p.track_id, lambda: grid_mod.snap_cues(ctx.db, p.track_id, p.slots))

    def current_settings() -> Settings:
        defaults = Settings()
        names = Settings.model_fields
        stored = {name: ctx.db.get_setting(name, getattr(defaults, name)) for name in names}
        return Settings.model_validate(stored)

    def tag_options(given: TagOptions | None) -> TagOptions:
        settings = current_settings()
        options = given or settings.tag_options
        return options.model_copy(
            update={
                "notation": options.notation or settings.notation,
                "bpm_decimals": (
                    settings.bpm_decimals if options.bpm_decimals is None else options.bpm_decimals
                ),
            }
        )

    def start_batch(
        kind: str,
        track_ids: list[int],
        planner_for: Callable[[Database], tag_service.Planner],
        description: Mapping[str, object],
    ) -> JobStarted:
        def run(job: JobContext) -> TagWriteResult:
            db = Database.open(ctx.db_path)
            try:
                return tag_service.write_batch(db, track_ids, planner_for(db), description, job)
            finally:
                db.close()

        return JobStarted(job_id=ctx.jobs.start(kind, run))

    @d.method("tags.preview")
    def tags_preview(params: Params) -> TagPreview:
        p = parse_params(TagPreviewParams, params)
        planner = tag_service.results_planner(ctx.db, tag_options(p.options))
        return TagPreview(items=tag_service.preview(ctx.db, p.track_ids, planner))

    @d.method("tags.write")
    def tags_write(params: Params) -> JobStarted:
        p = parse_params(TagWriteParams, params)
        options = tag_options(p.options)
        description = {"kind": "results", "options": options.model_dump(by_alias=True)}
        return start_batch(
            "tags.write",
            p.track_ids,
            lambda db: tag_service.results_planner(db, options),
            description,
        )

    @d.method("tags.cleanPreview")
    def tags_clean_preview(params: Params) -> TagPreview:
        p = parse_params(CleanParams, params)
        planner = tag_service.clean_planner(p.rules)
        return TagPreview(items=tag_service.preview(ctx.db, p.track_ids, planner))

    @d.method("tags.clean")
    def tags_clean(params: Params) -> JobStarted:
        p = parse_params(CleanParams, params)
        description = {"kind": "clean", "rules": p.rules.model_dump(by_alias=True)}
        return start_batch(
            "tags.write", p.track_ids, lambda _: tag_service.clean_planner(p.rules), description
        )

    @d.method("tags.editPreview")
    def tags_edit_preview(params: Params) -> TagPreview:
        p = parse_params(EditParams, params)
        planner = tag_service.edit_planner({str(k): v for k, v in p.values.items()})
        return TagPreview(items=tag_service.preview(ctx.db, p.track_ids, planner))

    @d.method("tags.edit")
    def tags_edit(params: Params) -> JobStarted:
        p = parse_params(EditParams, params)
        values = {str(k): v for k, v in p.values.items()}
        return start_batch(
            "tags.write",
            p.track_ids,
            lambda _: tag_service.edit_planner(values),
            {"kind": "edit", "values": values},
        )

    @d.method("tags.history")
    def tags_history(params: Params) -> TagHistory:
        p = parse_params(TagHistoryParams, params)
        return TagHistory(items=tag_service.history(ctx.db, p.limit))

    @d.method("tags.undo")
    def tags_undo(params: Params) -> JobStarted:
        p = parse_params(TagUndoParams, params)
        if not tag_service.batch_exists(ctx.db, p.batch_id):
            raise RpcError(INVALID_PARAMS, f"unknown batch {p.batch_id}", reason="batch_not_found")

        def run(job: JobContext) -> TagUndoResult:
            db = Database.open(ctx.db_path)
            try:
                return tag_service.undo_batch(db, p.batch_id, job)
            finally:
                db.close()

        return JobStarted(job_id=ctx.jobs.start("tags.undo", run))

    @d.method("settings.get")
    def settings_get(_: Params) -> Settings:
        return current_settings()

    @d.method("settings.set")
    def settings_set(params: Params) -> Settings:
        p = parse_params(SettingsUpdate, params)
        if p.cue_colors is not None:
            cues_mod.recolor_auto_cues(ctx.db, cues_mod.cue_palette(ctx.db), p.cue_colors)
        for name in p.model_fields_set:
            value = getattr(p, name)
            if isinstance(value, BaseModel):
                value = value.model_dump(by_alias=True)
            if value is not None:
                ctx.db.set_setting(name, value)
        if "watched_folders" in p.model_fields_set:
            ctx.watcher.poke()
        return current_settings()

    @d.method("library.genres")
    def library_genres(_: Params) -> GenreList:
        return ctx.library().genres()

    @d.method("library.stats")
    def library_stats(_: Params) -> LibraryStats:
        return ctx.library().stats()

    @d.method("library.remove")
    def library_remove(params: Params) -> RemoveResult:
        p = parse_params(TrackIdsParams, params)
        return RemoveResult(removed=ctx.library().remove(p.track_ids))

    # ---- export to DJ software (SPEC 2.12) ----

    def start_export(
        kind: str,
        params: Params,
        run_export: Callable[[Database, ExportOptions, JobContext], ExportResult],
    ) -> JobStarted:
        p = parse_params(ExportOptions, params)

        def run(job: JobContext) -> ExportResult:
            db = Database.open(ctx.db_path)
            try:
                return run_export(db, scoped(db, p), job)
            finally:
                db.close()

        return JobStarted(job_id=ctx.jobs.start(kind, run))

    # The exporters by program; the conversion (13.2) uses the same ones.
    exporters: dict[ImportSource, Callable[[Database, ExportOptions, JobContext], ExportResult]] = {
        "rekordbox": lambda db, p, job: export_rekordbox(
            db,
            p,
            default_path=ctx.data_dir / "exports" / "rekordbox.xml",
            backup_dir=ctx.data_dir / "backups" / "rekordbox",
            check_cancelled=job.check_cancelled,
        ),
        "traktor": lambda db, p, job: traktor_nml.export_traktor(
            db, p, ctx.data_dir / "backups" / "traktor", job.check_cancelled
        ),
        "serato": lambda db, p, job: serato_markers.export_serato(
            db, p, job, ctx.data_dir / "backups" / "serato"
        ),
        "virtualdj": lambda db, p, job: virtualdj.export_virtualdj(
            db, p, ctx.data_dir / "backups" / "virtualdj", job.check_cancelled
        ),
        "engine_dj": lambda db, p, job: engine_dj.export_engine_dj(
            db, p, ctx.data_dir / "backups" / "engine-dj", job.check_cancelled
        ),
    }

    @d.method("export.rekordbox")
    def export_rekordbox_method(params: Params) -> JobStarted:
        return start_export("export.rekordbox", params, exporters["rekordbox"])

    @d.method("export.traktor")
    def export_traktor_method(params: Params) -> JobStarted:
        return start_export("export.traktor", params, exporters["traktor"])

    @d.method("export.serato")
    def export_serato_method(params: Params) -> JobStarted:
        return start_export("export.serato", params, exporters["serato"])

    @d.method("export.traktorStatus")
    def export_traktor_status(_: Params) -> CollectionStatus:
        path, running = traktor_nml.collection_status()
        return CollectionStatus(collection_path=str(path) if path else None, running=running)

    @d.method("export.virtualdj")
    def export_virtualdj_method(params: Params) -> JobStarted:
        return start_export("export.virtualdj", params, exporters["virtualdj"])

    @d.method("export.virtualdjStatus")
    def export_virtualdj_status(_: Params) -> CollectionStatus:
        path, running = virtualdj.database_status()
        return CollectionStatus(collection_path=str(path) if path else None, running=running)

    @d.method("export.engineDj")
    def export_engine_dj_method(params: Params) -> JobStarted:
        return start_export("export.engineDj", params, exporters["engine_dj"])

    @d.method("export.engineDjStatus")
    def export_engine_dj_status(_: Params) -> CollectionStatus:
        path, running = engine_dj.database_status()
        return CollectionStatus(collection_path=str(path) if path else None, running=running)

    # ---- import from DJ software (SPEC 13.1) ----

    @d.method("import.detect")
    def import_detect(_: Params) -> ImportSources:
        return import_service.detect()

    def start_import_job(kind: str, params: Params, simulate: bool) -> JobStarted:
        p = parse_params(ImportOptions, params)

        def run(job: JobContext) -> ImportReport:
            db = Database.open(ctx.db_path)
            try:
                report = import_service.run(
                    db,
                    ctx.library(db),
                    p,
                    simulate,
                    lambda stage, percent: job.progress(stage, percent),
                    job.check_cancelled,
                )
                if report.added and report.batch_id:
                    ctx.start_analysis(import_service.added_tracks(db, report.batch_id))
                return report
            finally:
                db.close()

        return JobStarted(job_id=ctx.jobs.start(kind, run))

    @d.method("import.preview")
    def import_preview(params: Params) -> JobStarted:
        return start_import_job("import.preview", params, simulate=True)

    @d.method("import.apply")
    def import_apply(params: Params) -> JobStarted:
        return start_import_job("import.apply", params, simulate=False)

    @d.method("import.undo")
    def import_undo(params: Params) -> ImportUndoResult:
        p = parse_params(ImportUndoParams, params)
        return import_service.undo(ctx.db, ctx.library(), p.batch_id)

    @d.method("import.history")
    def import_history(_: Params) -> ImportHistory:
        return import_service.history(ctx.db)

    # ---- play history (SPEC 13.4) ----

    @d.method("history.detect")
    def history_detect(_: Params) -> HistorySources:
        return history_mod.detect()

    @d.method("history.import")
    def history_import(params: Params) -> JobStarted:
        p = parse_params(HistoryImportParams, params)

        def run(job: JobContext) -> HistoryImportResult:
            db = Database.open(ctx.db_path)
            try:
                return history_mod.import_history(
                    db, p, lambda stage, percent: job.progress(stage, percent), job.check_cancelled
                )
            finally:
                db.close()

        return JobStarted(job_id=ctx.jobs.start("history.import", run))

    @d.method("history.list")
    def history_list(params: Params) -> HistoryList:
        return history_mod.list_sessions(ctx.db, parse_params(HistoryQuery, params or {}))

    @d.method("history.markPlayed")
    def history_mark(params: Params) -> HistoryMarkResult:
        return history_mod.mark_played(ctx.db, parse_params(HistoryMarkParams, params))

    @d.method("history.deleteSession")
    def history_delete(params: Params) -> HistoryDeleteResult:
        p = parse_params(HistorySessionParams, params)
        return history_mod.delete_session(ctx.db, p.session_id)

    # ---- duplicates (SPEC 13.3) ----

    @d.method("duplicates.scan")
    def duplicates_scan(params: Params) -> JobStarted:
        p = parse_params(DuplicateScanOptions, params or {})

        def run(job: JobContext) -> DuplicateScanResult:
            db = Database.open(ctx.db_path)
            try:
                return duplicates_mod.scan(
                    db,
                    p.full,
                    lambda stage, percent: job.progress(stage, percent),
                    job.check_cancelled,
                )
            finally:
                db.close()

        return JobStarted(job_id=ctx.jobs.start("duplicates.scan", run))

    @d.method("duplicates.list")
    def duplicates_list(_: Params) -> DuplicateList:
        return duplicates_mod.list_groups(ctx.db)

    @d.method("duplicates.resolve")
    def duplicates_resolve(params: Params) -> DuplicateResolveResult:
        p = parse_params(DuplicateResolveParams, params)
        return duplicates_mod.resolve(ctx.db, p, trash=move_to_trash)

    @d.method("duplicates.undo")
    def duplicates_undo(params: Params) -> DuplicateUndoResult:
        p = parse_params(DuplicateUndoParams, params)
        return duplicates_mod.undo_merge(ctx.db, p.merge_id)

    # ---- from one DJ program to another (SPEC 13.2) ----

    def start_convert(kind: str, params: Params, simulate: bool) -> JobStarted:
        p = parse_params(ConvertOptions, params)

        def run(job: JobContext) -> ConvertReport:
            db = Database.open(ctx.db_path)
            try:
                export = exporters[p.target]
                if simulate:
                    return convert.plan(db, p, export, job)
                report = convert.apply(db, ctx.library(db), p, export, job)
                batch = report.import_report.batch_id
                if report.import_report.added and batch:
                    ctx.start_analysis(import_service.added_tracks(db, batch))
                return report
            finally:
                db.close()

        return JobStarted(job_id=ctx.jobs.start(kind, run))

    @d.method("convert.plan")
    def convert_plan(params: Params) -> JobStarted:
        return start_convert("convert.plan", params, simulate=True)

    @d.method("convert.apply")
    def convert_apply(params: Params) -> JobStarted:
        return start_convert("convert.apply", params, simulate=False)

    # ---- playlists (SPEC 2.11) ----

    def playlists() -> Playlists:
        return Playlists(ctx.db)

    def on_playlist(action: Callable[[], T]) -> T:
        try:
            return action()
        except PlaylistError as exc:
            raise RpcError.wrap(exc) from None

    @d.method("playlists.tree")
    def playlists_tree(_: Params) -> PlaylistTree:
        return PlaylistTree(playlists=playlists().tree())

    @d.method("playlists.create")
    def playlists_create(params: Params) -> PlaylistNode:
        p = parse_params(PlaylistCreateParams, params)
        return on_playlist(lambda: playlists().create(p))

    @d.method("playlists.update")
    def playlists_update(params: Params) -> PlaylistNode:
        p = parse_params(PlaylistUpdateParams, params)
        return on_playlist(lambda: playlists().update(p))

    @d.method("playlists.move")
    def playlists_move(params: Params) -> PlaylistTree:
        p = parse_params(PlaylistMoveParams, params)
        return PlaylistTree(playlists=on_playlist(lambda: playlists().move(p)))

    @d.method("playlists.delete")
    def playlists_delete(params: Params) -> PlaylistDeleteResult:
        p = parse_params(PlaylistIdParams, params)
        return PlaylistDeleteResult(deleted=on_playlist(lambda: playlists().delete(p.playlist_id)))

    @d.method("playlists.addTracks")
    def playlists_add(params: Params) -> PlaylistTracksResult:
        p = parse_params(PlaylistTracksParams, params)
        return on_playlist(lambda: playlists().add_tracks(p))

    @d.method("playlists.removeTracks")
    def playlists_remove(params: Params) -> PlaylistTracksResult:
        p = parse_params(PlaylistTracksParams, params)
        return on_playlist(lambda: playlists().remove_tracks(p))

    @d.method("playlists.reorderTracks")
    def playlists_reorder(params: Params) -> PlaylistTracksResult:
        p = parse_params(PlaylistTracksParams, params)
        return on_playlist(lambda: playlists().reorder_tracks(p))

    @d.method("playlists.importM3u")
    def playlists_import(params: Params) -> M3UImportResult:
        p = parse_params(M3UImportParams, params)
        return on_playlist(lambda: playlists().import_m3u(p, ctx.library()))

    @d.method("playlists.exportM3u")
    def playlists_export(params: Params) -> M3UExportResult:
        p = parse_params(M3UExportParams, params)
        backups = ctx.data_dir / "backups" / "playlists"
        return on_playlist(lambda: playlists().export_m3u(p, backups))

    # ---- stems (SPEC 2.16) ----

    def stem_service(db: Database | None = None) -> stems_mod.StemService:
        return stems_mod.StemService(db or ctx.db, ctx.data_dir)

    @d.method("stems.status")
    def stems_status(_: Params) -> StemsStatus:
        return stem_service().status(current_settings().stem_device)

    @d.method("stems.downloadModel")
    def stems_download(params: Params) -> JobStarted:
        p = parse_params(StemModelParams, params)
        return JobStarted(
            job_id=ctx.jobs.start(
                "stems.download", lambda job: stem_service().download(p.model, job)
            )
        )

    @d.method("stems.downloadGpu")
    def stems_download_gpu(_: Params) -> JobStarted:
        runtime = gpu_runtime_mod.GpuRuntime(ctx.data_dir)
        return JobStarted(job_id=ctx.jobs.start("stems.downloadGpu", runtime.download))

    @d.method("stems.removeGpu")
    def stems_remove_gpu(_: Params) -> StemsStatus:
        gpu_runtime_mod.GpuRuntime(ctx.data_dir).remove()
        return stem_service().status(current_settings().stem_device)

    @d.method("stems.separate")
    def stems_separate(params: Params) -> JobStarted:
        p = parse_params(StemsSeparateParams, params)
        settings = current_settings()
        model = p.model or settings.stem_model

        def run(job: JobContext) -> StemsSeparateResult:
            db = Database.open(ctx.db_path)
            try:
                return stem_service(db).separate(
                    p.track_ids,
                    model,
                    settings.stem_device,
                    job,
                    reuse_other_models=p.model is None,
                )
            finally:
                db.close()

        return JobStarted(job_id=ctx.jobs.start("stems.separate", run))

    @d.method("stems.get")
    def stems_get(params: Params) -> StemsGetResult:
        p = parse_params(StemsGetParams, params)
        service = stem_service()
        return StemsGetResult(
            stems=service.get(p.track_id, p.model)
            if p.model
            else service.available(p.track_id, current_settings().stem_model)
        )

    @d.method("stems.clearCache")
    def stems_clear(_: Params) -> StemsCacheInfo:
        return stem_service().clear_cache()

    # ---- stem export (SPEC 2.16) ----

    def stem_export_setup(
        p: StemExportParams, db: Database | None = None
    ) -> tuple[stem_export_mod.StemExporter, Path, StemExportFormat, str]:
        settings = current_settings()
        folder = p.destination or settings.daw_folder
        if not folder:
            raise RpcError(
                INVALID_PARAMS,
                "choose a destination folder or set the DAW folder",
                reason="choose_folder",
            )
        exporter = stem_export_mod.StemExporter(
            db or ctx.db,
            ctx.data_dir,
            notation=settings.notation,
            bpm_decimals=settings.bpm_decimals,
            default_model=p.model or settings.stem_model,
        )
        fmt = p.format or settings.stem_export_format
        return exporter, Path(folder), fmt, p.template or settings.stem_export_template

    @d.method("stems.exportPreview")
    def stems_export_preview(params: Params) -> StemExportNames:
        p = parse_params(StemExportParams, params)
        exporter, folder, fmt, template = stem_export_setup(p)
        return exporter.names(p.items, folder, fmt, template, p.stem_labels)

    @d.method("stems.export")
    def stems_export(params: Params) -> JobStarted:
        p = parse_params(StemExportParams, params)
        stem_export_setup(p)  # validate before starting the job

        def run(job: JobContext) -> StemExportResult:
            db = Database.open(ctx.db_path)
            try:
                exporter, folder, fmt, template = stem_export_setup(p, db)
                return exporter.export(p.items, folder, fmt, template, p.stem_labels, job)
            finally:
                db.close()

        return JobStarted(job_id=ctx.jobs.start("stems.export", run))

    # ---- ideas (SPEC 2.15) ----

    @d.method("suggest.mashups")
    def suggest_mashups(params: Params) -> SuggestResult:
        p = parse_params(SuggestParams, params)
        return invalid_on_value_error(lambda: suggest_mod.suggest(ctx.db, p, "mashup"))

    @d.method("suggest.mixouts")
    def suggest_mixouts(params: Params) -> SuggestResult:
        p = parse_params(SuggestParams, params)
        return invalid_on_value_error(lambda: suggest_mod.suggest(ctx.db, p, "mix"))

    # ---- mashup favorites (SPEC 2.15) ----

    def on_favorite(action: Callable[[], T]) -> T:
        try:
            return action()
        except FavoriteError as exc:
            raise RpcError.wrap(exc) from None

    @d.method("favorites.list")
    def favorites_list(params: Params) -> FavoriteList:
        p = parse_params(FavoriteListParams, params or {})
        return FavoriteList(items=Favorites(ctx.db).list(p))

    @d.method("favorites.save")
    def favorites_save(params: Params) -> Favorite:
        p = parse_params(FavoriteSaveParams, params)
        return on_favorite(lambda: Favorites(ctx.db).save(p))

    @d.method("favorites.update")
    def favorites_update(params: Params) -> Favorite:
        p = parse_params(FavoriteUpdateParams, params)
        return on_favorite(lambda: Favorites(ctx.db).update(p))

    @d.method("favorites.delete")
    def favorites_delete(params: Params) -> FavoriteDeleteResult:
        p = parse_params(FavoriteIdParams, params)
        return FavoriteDeleteResult(deleted=Favorites(ctx.db).delete(p.favorite_id))

    # ---- set builder (SPEC 2.17) ----

    @d.method("builder.generate")
    def builder_generate(params: Params) -> BuilderResult:
        p = parse_params(BuilderGenerateParams, params)
        return invalid_on_value_error(lambda: playlist_builder.generate(ctx.db, p))

    @d.method("builder.score")
    def builder_score(params: Params) -> BuilderResult:
        p = parse_params(BuilderScoreParams, params)
        return invalid_on_value_error(lambda: playlist_builder.score(ctx.db, p))

    @d.method("builder.alternatives")
    def builder_alternatives(params: Params) -> BuilderAlternatives:
        p = parse_params(BuilderAlternativesParams, params)
        return BuilderAlternatives(
            items=invalid_on_value_error(lambda: playlist_builder.alternatives(ctx.db, p))
        )

    # ---- render (SPEC 2.15 and 2.16) ----

    @d.method("render.preview")
    def render_preview(params: Params) -> RenderPreviewResult:
        spec = parse_params(RenderSpec, params)
        model = current_settings().stem_model
        plan = invalid_on_value_error(
            lambda: render_mod.RenderService(ctx.db, ctx.data_dir).plan(spec, model)
        )
        hit = render_mod.RenderService(ctx.db, ctx.data_dir).cached(plan)
        if hit is not None:
            return RenderPreviewResult(result=hit)

        def run(job: JobContext) -> RenderResult:
            db = Database.open(ctx.db_path)
            try:
                return render_mod.RenderService(db, ctx.data_dir).render(
                    plan, job.check_cancelled, lambda p: job.progress("render", p)
                )
            finally:
                db.close()

        return RenderPreviewResult(job_id=ctx.jobs.start("render.preview", run))

    return d
