"""Engine method registry and shared runtime state."""

from __future__ import annotations

import platform
from dataclasses import dataclass, field
from pathlib import Path

from . import PROTOCOL_VERSION, __version__
from .db import Database
from .jobs import JobContext, JobManager, Notifier
from .library import Library
from .rpc import INVALID_PARAMS, Dispatcher, Params, RpcError, parse_params
from .rpc_schema import (
    AddPathsParams,
    AddPathsResult,
    JobCancelParams,
    JobCancelResult,
    JobStarted,
    LibraryPage,
    LibraryQuery,
    PingResult,
    RemoveResult,
    TrackDetail,
    TrackIdParams,
    TrackIdsParams,
    VersionResult,
)


@dataclass
class EngineContext:
    data_dir: Path
    notifier: Notifier
    db: Database = field(init=False)
    jobs: JobManager = field(init=False)

    def __post_init__(self) -> None:
        self.db = Database.open(self.db_path)
        self.jobs = JobManager(self.notifier)

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
                return ctx.library(db).add_paths(paths, job)
            finally:
                db.close()

        return JobStarted(job_id=ctx.jobs.start("library.addPaths", run))

    @d.method("library.list")
    def library_list(params: Params) -> LibraryPage:
        return ctx.library().list(parse_params(LibraryQuery, params))

    @d.method("library.get")
    def library_get(params: Params) -> TrackDetail:
        p = parse_params(TrackIdParams, params)
        try:
            return ctx.library().get(p.track_id)
        except KeyError:
            raise RpcError(INVALID_PARAMS, f"unknown track {p.track_id}") from None

    @d.method("library.remove")
    def library_remove(params: Params) -> RemoveResult:
        p = parse_params(TrackIdsParams, params)
        return RemoveResult(removed=ctx.library().remove(p.track_ids))

    return d
