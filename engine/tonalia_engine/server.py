"""Engine method registry and shared runtime state."""

from __future__ import annotations

import platform
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import TypeVar

from pydantic import BaseModel

from . import PROTOCOL_VERSION, __version__
from . import cues as cues_mod
from .analysis.queue import AnalysisQueue, recover_interrupted
from .db import Database
from .jobs import JobContext, JobManager, Notifier
from .library import Library
from .playlists import PlaylistError, Playlists
from .rpc import INVALID_PARAMS, Dispatcher, Params, RpcError, parse_params
from .rpc_schema import (
    AddPathsParams,
    AddPathsResult,
    AnalysisStarted,
    AnalysisStartParams,
    CleanParams,
    Cue,
    CueDeleteResult,
    CueList,
    CueSetParams,
    CueSlotParams,
    EditParams,
    EventParams,
    GenreList,
    JobCancelParams,
    JobCancelResult,
    JobStarted,
    JobStartedEvent,
    LibraryPage,
    LibraryQuery,
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
    RemoveResult,
    Settings,
    SettingsUpdate,
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

T = TypeVar("T")


@dataclass
class EngineContext:
    data_dir: Path
    notifier: Notifier
    analysis_workers: int | None = None
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

    @property
    def db_path(self) -> Path:
        return self.data_dir / "tonalia.db"

    @property
    def artwork_dir(self) -> Path:
        return self.data_dir / "artwork"

    def library(self, db: Database | None = None) -> Library:
        return Library(db or self.db, self.artwork_dir)

    def close(self) -> None:
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

        def run(job: JobContext) -> AddPathsResult:
            # A dedicated connection: imports write in batches while the UI keeps reading.
            db = Database.open(ctx.db_path)
            try:
                result = ctx.library(db).add_paths(paths, job)
                if p.analyze and not job.cancelled:
                    pending = [
                        r[0]
                        for r in db.conn.execute("SELECT id FROM tracks WHERE status = 'pending'")
                    ]
                    start_analysis(pending)
                return result
            finally:
                db.close()

        return JobStarted(job_id=ctx.jobs.start("library.addPaths", run))

    def start_analysis(track_ids: list[int]) -> AnalysisStarted:
        running = ctx.analysis.job_id
        job_id, queued = ctx.analysis.enqueue(track_ids)
        if job_id and job_id != running:
            event = JobStartedEvent(job_id=job_id, kind="analysis")
            ctx.notifier.notify(
                "event", EventParams(type="job.started", payload=event.model_dump(by_alias=True))
            )
        return AnalysisStarted(job_id=job_id, queued=queued)

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
            raise RpcError(INVALID_PARAMS, f"unknown track {p.track_id}") from None

    @d.method("track.update")
    def track_update(params: Params) -> TrackDetail:
        p = parse_params(TrackUpdateParams, params)
        try:
            return ctx.library().update(p)
        except KeyError:
            raise RpcError(INVALID_PARAMS, f"unknown track {p.track_id}") from None

    def invalid_on_value_error(action: Callable[[], T]) -> T:
        try:
            return action()
        except ValueError as exc:
            raise RpcError(INVALID_PARAMS, str(exc)) from None

    def on_track(track_id: int, action: Callable[[], T]) -> T:
        try:
            return action()
        except KeyError:
            raise RpcError(INVALID_PARAMS, f"unknown track {track_id}") from None

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

    @d.method("tags.undo")
    def tags_undo(params: Params) -> JobStarted:
        p = parse_params(TagUndoParams, params)
        if not tag_service.batch_exists(ctx.db, p.batch_id):
            raise RpcError(INVALID_PARAMS, f"unknown batch {p.batch_id}")

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
        for name in p.model_fields_set:
            value = getattr(p, name)
            if isinstance(value, BaseModel):
                value = value.model_dump(by_alias=True)
            if value is not None:
                ctx.db.set_setting(name, value)
        return current_settings()

    @d.method("library.genres")
    def library_genres(_: Params) -> GenreList:
        return ctx.library().genres()

    @d.method("library.remove")
    def library_remove(params: Params) -> RemoveResult:
        p = parse_params(TrackIdsParams, params)
        return RemoveResult(removed=ctx.library().remove(p.track_ids))

    # ---- playlists (SPEC 2.11) ----

    def playlists() -> Playlists:
        return Playlists(ctx.db)

    def on_playlist(action: Callable[[], T]) -> T:
        try:
            return action()
        except PlaylistError as exc:
            raise RpcError(INVALID_PARAMS, str(exc)) from None

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

    return d
