"""Shared JSON-RPC types.

This module is the single source of truth for the engine <-> app contract.
After changing it, regenerate ``app/src/lib/rpc.types.ts`` with ``scripts/gen-types``.

Fields are snake_case in Python and camelCase on the wire (alias generator).
"""

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


class RpcModel(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True, alias_generator=to_camel)


# ---- engine ----


class PingResult(RpcModel):
    pong: bool


class VersionResult(RpcModel):
    version: str
    protocol: int
    python: str


# ---- jobs ----


class JobStarted(RpcModel):
    job_id: str


class JobCancelParams(RpcModel):
    job_id: str


class JobCancelResult(RpcModel):
    cancelled: bool


JobStatus = Literal["done", "cancelled", "failed"]


class JobFinished(RpcModel):
    """Payload of the ``job.finished`` event."""

    job_id: str
    kind: str
    status: JobStatus
    result: dict[str, Any] | None = None
    error: str | None = None


# ---- notifications ----


class ProgressParams(RpcModel):
    job_id: str
    track_id: int | None = None
    stage: str
    percent: float
    done: int | None = None
    total: int | None = None


class EventParams(RpcModel):
    type: str
    payload: dict[str, Any]


# ---- library ----

TrackStatus = Literal["pending", "analyzing", "ready", "error"]
KeyMode = Literal["major", "minor"]
SortColumn = Literal[
    "title", "artist", "album", "genre", "year", "duration", "bpm", "key", "energy",
    "added_at", "status", "format", "bitrate",
]  # fmt: skip


class AddPathsParams(RpcModel):
    paths: list[str] = Field(min_length=1)


class FailedPath(RpcModel):
    path: str
    reason: str


class AddPathsResult(RpcModel):
    added: int = 0
    updated: int = 0
    moved: int = 0
    unchanged: int = 0
    duplicates: int = 0
    failed: list[FailedPath] = Field(default_factory=list)


class LibraryQuery(RpcModel):
    search: str | None = None
    status: TrackStatus | None = None
    sort: SortColumn = "added_at"
    descending: bool = True
    offset: int = Field(default=0, ge=0)
    limit: int = Field(default=200, ge=1, le=5000)


class TrackSummary(RpcModel):
    id: int
    path: str
    title: str | None
    artist: str | None
    album: str | None
    genre: str | None
    year: int | None
    duration: float | None
    format: str | None
    bitrate: int | None
    status: TrackStatus
    error: str | None
    added_at: str
    artwork_path: str | None
    key_root: int | None
    key_mode: KeyMode | None
    key_confidence: float | None
    bpm: float | None
    energy: int | None
    cue_count: int


class LibraryPage(RpcModel):
    total: int
    items: list[TrackSummary]


class TrackDetail(TrackSummary):
    sample_rate: int | None
    label: str | None
    comment: str | None
    file_hash: str | None
    size: int | None
    analyzed_at: str | None
    analysis_version: str | None


class TrackIdParams(RpcModel):
    track_id: int


class TrackIdsParams(RpcModel):
    track_ids: list[int] = Field(min_length=1)


class RemoveResult(RpcModel):
    removed: int


# Method name -> (params model or None, result model). Used by scripts/gen-types.
METHODS: dict[str, tuple[type[RpcModel] | None, type[RpcModel]]] = {
    "engine.ping": (None, PingResult),
    "engine.version": (None, VersionResult),
    "job.cancel": (JobCancelParams, JobCancelResult),
    "library.addPaths": (AddPathsParams, JobStarted),
    "library.list": (LibraryQuery, LibraryPage),
    "library.get": (TrackIdParams, TrackDetail),
    "library.remove": (TrackIdsParams, RemoveResult),
}

# Notification name -> params model.
NOTIFICATIONS: dict[str, type[RpcModel]] = {
    "progress": ProgressParams,
    "event": EventParams,
}

# Event type -> payload model (carried inside ``event`` notifications).
EVENTS: dict[str, type[RpcModel]] = {
    "job.finished": JobFinished,
}
