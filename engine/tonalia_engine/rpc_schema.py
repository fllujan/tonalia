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
# Same values as ``keys.Notation`` (kept here so the schema has no engine imports).
Notation = Literal["alphanumeric", "open_key", "classical", "classical_flat"]
# Analysis fields the user can edit by hand; they prevail over (re)analysis.
EditableField = Literal["key", "bpm", "energy"]
# SPEC 2.7 quality checks; any of them puts the track in "Review quality".
QualityFlag = Literal["clipping", "low_bitrate", "fake_hq", "quiet", "silence_start", "silence_end"]
SortColumn = Literal[
    "title", "artist", "album", "genre", "year", "duration", "bpm", "key", "energy",
    "added_at", "status", "format", "bitrate",
]  # fmt: skip


class AddPathsParams(RpcModel):
    paths: list[str] = Field(min_length=1)
    analyze: bool = True  # queue new/changed tracks for analysis when the import ends


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
    quality_issues: bool | None = None  # only tracks with (True) / without (False) flags
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
    edited_fields: list[EditableField] = Field(default_factory=list)
    quality_flags: list[QualityFlag] = Field(default_factory=list)


class LibraryPage(RpcModel):
    total: int
    items: list[TrackSummary]


class KeyRef(RpcModel):
    root: int = Field(ge=0, le=11)
    mode: KeyMode


SegmentLabel = Literal["intro", "verse", "chorus", "build", "drop", "breakdown", "outro"]
CueSource = Literal["auto", "user"]
HEX_COLOR = r"^#[0-9A-Fa-f]{6}$"


class SegmentInfo(RpcModel):
    start: float
    end: float
    label: SegmentLabel
    energy: float | None = None


class Cue(RpcModel):
    """Cue point: ``label`` of auto cues is a section key (intro, drop, drop2…) that the
    UI translates; user cues carry free text."""

    slot: int = Field(ge=0, le=7)
    position_sec: float = Field(ge=0)
    label: str | None = None
    color: str | None = None
    source: CueSource


class CueList(RpcModel):
    cues: list[Cue]


class CueSetParams(RpcModel):
    track_id: int
    slot: int = Field(ge=0, le=7)
    position_sec: float = Field(ge=0)
    label: str | None = Field(default=None, max_length=64)
    color: str | None = Field(default=None, pattern=HEX_COLOR)


class CueSlotParams(RpcModel):
    track_id: int
    slot: int = Field(ge=0, le=7)


class CueDeleteResult(RpcModel):
    deleted: bool


class EnergyPoint(RpcModel):
    """Energy of one 8-bar block (SPEC 2.5), drawn over the waveform."""

    start: float
    end: float
    level: float = Field(ge=1, le=10)


class TrackDetail(TrackSummary):
    sample_rate: int | None
    label: str | None
    comment: str | None
    file_hash: str | None
    size: int | None
    analyzed_at: str | None
    analysis_version: str | None
    key_alternatives: list[KeyRef] = Field(default_factory=list)
    key_secondary: KeyRef | None = None
    key_secondary_start: float | None = None
    tuning_hz: float | None = None
    bpm_confidence: float | None = None
    beat_grid: dict[str, Any] | None = None
    energy_curve: list[EnergyPoint] = Field(default_factory=list)
    loudness_lufs: float | None = None
    peak_db: float | None = None
    clipping_ratio: float | None = None
    cutoff_hz: float | None = None
    silence_start: float | None = None
    silence_end: float | None = None
    waveform_path: str | None = None
    segments: list[SegmentInfo] = Field(default_factory=list)
    cues: list[Cue] = Field(default_factory=list)


class GenreCount(RpcModel):
    name: str
    count: int


class GenreList(RpcModel):
    genres: list[GenreCount]


class TrackIdParams(RpcModel):
    track_id: int


class TrackIdsParams(RpcModel):
    track_ids: list[int] = Field(min_length=1)


class RemoveResult(RpcModel):
    removed: int


class TrackUpdateParams(RpcModel):
    """Manual edit. Only the fields present are changed; ``null`` clears the value."""

    track_id: int
    key: KeyRef | None = None
    bpm: float | None = Field(default=None, gt=0, le=400)
    energy: int | None = Field(default=None, ge=1, le=10)


CommentPosition = Literal["before", "after", "replace"]


class TagOptions(RpcModel):
    """What to write into the files (SPEC 2.9). ``notation``/``bpm_decimals`` default to
    the user's settings when omitted."""

    write_key: bool = True
    write_bpm: bool = True
    write_comment: bool = True
    comment_template: str = Field(default="{key} - Energy {energy}", max_length=200)
    comment_position: CommentPosition = "before"
    energy_in_grouping: bool = False
    energy_in_rating: bool = False
    notation: Notation | None = None
    bpm_decimals: int | None = Field(default=None, ge=0, le=2)


DEFAULT_PROMO_PHRASES = [
    "Free Download",
    "Free DL",
    "Exclusive",
    "Promo Only",
    "Promo",
    "Out Now",
    "Buy on Beatport",
    "Support",
    "Preview",
]


class CleanRules(RpcModel):
    """Tag cleaning rules (SPEC 2.10), each one can be switched off."""

    remove_urls: bool = True
    remove_promo: bool = True
    promo_phrases: list[str] = Field(
        default_factory=lambda: list(DEFAULT_PROMO_PHRASES), max_length=200
    )
    remove_track_numbers: bool = True
    remove_original_mix: bool = False
    collapse_spaces: bool = True
    fix_caps: bool = True
    normalize_feat: bool = True
    feat_position: Literal["title", "artist", "keep"] = "title"
    unify_separators: bool = False
    artist_separator: Literal[", ", " & ", "; ", " / "] = ", "


TagField = Literal[
    "key",
    "bpm",
    "comment",
    "grouping",
    "rating",
    "title",
    "artist",
    "album",
    "genre",
    "year",
    "label",
]
EditableTag = Literal["title", "artist", "album", "genre", "year", "label", "comment", "grouping"]


class TagChange(RpcModel):
    field: TagField
    before: str | None
    after: str


class TagPreviewItem(RpcModel):
    track_id: int
    path: str
    changes: list[TagChange]
    error: str | None = None


class TagPreview(RpcModel):
    items: list[TagPreviewItem]


class TagPreviewParams(RpcModel):
    track_ids: list[int] = Field(min_length=1, max_length=5000)
    options: TagOptions | None = None  # defaults to the saved template (settings)


class TagWriteParams(TagPreviewParams):
    pass


class CleanParams(RpcModel):
    track_ids: list[int] = Field(min_length=1, max_length=5000)
    rules: CleanRules = Field(default_factory=CleanRules)


class EditParams(RpcModel):
    """Mass edit: the same value for every track ("" clears the field)."""

    track_ids: list[int] = Field(min_length=1, max_length=5000)
    values: dict[EditableTag, str] = Field(min_length=1)


class TagUndoParams(RpcModel):
    batch_id: str = Field(min_length=1, max_length=64)


class TagWriteResult(RpcModel):
    batch_id: str
    written: int = 0
    unchanged: int = 0
    failed: list[FailedPath] = Field(default_factory=list)


class TagUndoResult(RpcModel):
    batch_id: str
    restored: int = 0
    skipped: list[FailedPath] = Field(default_factory=list)


class Settings(RpcModel):
    notation: Notation = "alphanumeric"
    bpm_decimals: int = Field(default=2, ge=0, le=2)
    cue_count: int = Field(default=8, ge=0, le=8)
    tag_options: TagOptions = Field(default_factory=TagOptions)


class SettingsUpdate(RpcModel):
    notation: Notation | None = None
    bpm_decimals: int | None = Field(default=None, ge=0, le=2)
    cue_count: int | None = Field(default=None, ge=0, le=8)
    tag_options: TagOptions | None = None


# ---- analysis ----


class AnalysisStartParams(RpcModel):
    """Tracks to analyse; by default every pending track (and errored ones on retry)."""

    track_ids: list[int] | None = None
    include_errors: bool = False


class AnalysisStarted(RpcModel):
    job_id: str | None
    queued: int


class AnalysisSummary(RpcModel):
    analyzed: int = 0
    failed: int = 0
    cancelled: int = 0


class AnalysisTrackDone(RpcModel):
    """Payload of the ``analysis.trackDone`` event."""

    track_id: int
    status: TrackStatus
    error: str | None = None


class JobStartedEvent(RpcModel):
    """Payload of ``job.started``: a job the engine started on its own (e.g. analysis
    chained after an import)."""

    job_id: str
    kind: str


# Method name -> (params model or None, result model). Used by scripts/gen-types.
METHODS: dict[str, tuple[type[RpcModel] | None, type[RpcModel]]] = {
    "engine.ping": (None, PingResult),
    "engine.version": (None, VersionResult),
    "job.cancel": (JobCancelParams, JobCancelResult),
    "library.addPaths": (AddPathsParams, JobStarted),
    "library.list": (LibraryQuery, LibraryPage),
    "library.get": (TrackIdParams, TrackDetail),
    "library.remove": (TrackIdsParams, RemoveResult),
    "library.genres": (None, GenreList),
    "analysis.start": (AnalysisStartParams, AnalysisStarted),
    "analysis.reanalyze": (TrackIdsParams, AnalysisStarted),
    "track.update": (TrackUpdateParams, TrackDetail),
    "cues.list": (TrackIdParams, CueList),
    "cues.set": (CueSetParams, Cue),
    "cues.delete": (CueSlotParams, CueDeleteResult),
    "cues.resetAuto": (TrackIdParams, CueList),
    "tags.preview": (TagPreviewParams, TagPreview),
    "tags.write": (TagWriteParams, JobStarted),
    "tags.undo": (TagUndoParams, JobStarted),
    "tags.cleanPreview": (CleanParams, TagPreview),
    "tags.clean": (CleanParams, JobStarted),
    "tags.editPreview": (EditParams, TagPreview),
    "tags.edit": (EditParams, JobStarted),
    "settings.get": (None, Settings),
    "settings.set": (SettingsUpdate, Settings),
}

# Notification name -> params model.
NOTIFICATIONS: dict[str, type[RpcModel]] = {
    "progress": ProgressParams,
    "event": EventParams,
}

# Event type -> payload model (carried inside ``event`` notifications).
EVENTS: dict[str, type[RpcModel]] = {
    "job.finished": JobFinished,
    "job.started": JobStartedEvent,
    "analysis.trackDone": AnalysisTrackDone,
}

# Models that only travel nested inside generic payloads (e.g. ``JobFinished.result``)
# but that the frontend still needs typed.
EXTRA_MODELS: list[type[RpcModel]] = [
    AddPathsResult,
    AnalysisSummary,
    TagWriteResult,
    TagUndoResult,
]
