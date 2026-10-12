"""Shared JSON-RPC types.

This module is the single source of truth for the engine <-> app contract.
After changing it, regenerate ``app/src/lib/rpc.types.ts`` with ``scripts/gen-types``.

Fields are snake_case in Python and camelCase on the wire (alias generator).
"""

from pathlib import PurePath, PureWindowsPath
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
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
# Demucs models (SPEC 2.16): fine-tuned bag (best quality) or the single fast model.
StemModel = Literal["htdemucs_ft", "htdemucs"]
# "auto" uses MPS (Apple Silicon) or CUDA when available, else the CPU.
StemDevice = Literal["auto", "cpu"]
StemName = Literal["vocals", "drums", "bass", "other", "instrumental"]
StemExportFormat = Literal["wav", "aiff", "flac"]
DEFAULT_STEM_TEMPLATE = "{artist} - {title} ({stem}) [{key} {bpm}]"
# Analysis fields the user can edit by hand; they prevail over (re)analysis.
EditableField = Literal["key", "bpm", "energy"]
# SPEC 2.7 quality checks; any of them puts the track in "Review quality".
QualityFlag = Literal["clipping", "low_bitrate", "fake_hq", "quiet", "silence_start", "silence_end"]
SortColumn = Literal[
    "title", "artist", "album", "genre", "year", "duration", "bpm", "key", "energy",
    "added_at", "status", "format", "bitrate", "position",
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


class KeyRef(RpcModel):
    root: int = Field(ge=0, le=11)
    mode: KeyMode


class TrackFilter(RpcModel):
    """Track conditions shared by smart playlists and the library filters (SPEC 2.11, 2.14).

    Every set condition must hold (AND); list conditions match any of their values (OR).
    """

    keys: list[KeyRef] = Field(default_factory=list)
    # Also match every key compatible with ``keys`` (SPEC 2.3 table, score > 0).
    compatible: bool = False
    bpm_min: float | None = Field(default=None, gt=0)
    bpm_max: float | None = Field(default=None, gt=0)
    # Also match tracks at half or double tempo inside the range.
    bpm_half_double: bool = False
    energy_min: int | None = Field(default=None, ge=1, le=10)
    energy_max: int | None = Field(default=None, ge=1, le=10)
    genres: list[str] = Field(default_factory=list)  # case-insensitive
    statuses: list[TrackStatus] = Field(default_factory=list)
    quality_issues: bool | None = None  # only tracks with (True) / without (False) flags
    favorites: bool = False  # only tracks that appear in a saved mashup favorite
    playlist_id: int | None = None  # only tracks of this regular playlist


class LibraryQuery(RpcModel):
    search: str | None = None
    status: TrackStatus | None = None
    quality_issues: bool | None = None  # only tracks with (True) / without (False) flags
    filter: TrackFilter | None = None
    # Tracks of a playlist (or the matches of a smart playlist); folders are not listable.
    playlist_id: int | None = None
    sort: SortColumn = "added_at"  # "position" only applies to regular playlists
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
    # 0-1: RMS of the voice / RMS of the mix in the main sections (SPEC 2.16).
    vocal_presence: float | None = None
    vocal_source: Literal["estimate", "stems"] | None = None
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


class TagHistoryParams(RpcModel):
    limit: int = Field(default=50, ge=1, le=500)


class TagBatchInfo(RpcModel):
    """One write in the history: analysis results, cleaning, bulk edit or Serato markers."""

    batch_id: str
    kind: str
    created_at: str
    written: int
    undone_at: str | None = None
    undoable: int = 0
    fields: list[str] = Field(default_factory=list)
    titles: list[str] = Field(default_factory=list)


class TagHistory(RpcModel):
    items: list[TagBatchInfo] = Field(default_factory=list)


def _folders(value: list[str]) -> list[str]:
    """Absolute, without repeats, in the given order."""
    out: list[str] = []
    for raw in value:
        folder = raw.strip()
        if not PurePath(folder).is_absolute() and not PureWindowsPath(folder).is_absolute():
            raise ValueError(f"not an absolute folder: {raw}")
        if folder not in out:
            out.append(folder)
    return out


def _optional_folder(value: str) -> str:
    """An absolute folder, or "" for none."""
    folder = value.strip()
    return _folders([folder])[0] if folder else ""


class Settings(RpcModel):
    notation: Notation = "alphanumeric"
    bpm_decimals: int = Field(default=2, ge=0, le=2)
    cue_count: int = Field(default=8, ge=0, le=8)
    tag_options: TagOptions = Field(default_factory=TagOptions)
    # Absolute folders whose new tracks are imported and analysed automatically.
    watched_folders: list[str] = Field(default_factory=list)
    stem_model: StemModel = "htdemucs_ft"
    stem_device: StemDevice = "auto"
    # Stem export (SPEC 2.16): the DAW project folder ("" = not set), format and names.
    daw_folder: str = ""
    stem_export_format: StemExportFormat = "wav"
    stem_export_template: str = Field(default=DEFAULT_STEM_TEMPLATE, min_length=1, max_length=200)
    # Look for a new version on GitHub Releases at start-up (SPEC 0.2: optional).
    check_updates: bool = True

    @field_validator("watched_folders")
    @classmethod
    def _check_folders(cls, value: list[str]) -> list[str]:
        return _folders(value)

    @field_validator("daw_folder")
    @classmethod
    def _check_daw_folder(cls, value: str) -> str:
        return _optional_folder(value)


class SettingsUpdate(RpcModel):
    notation: Notation | None = None
    bpm_decimals: int | None = Field(default=None, ge=0, le=2)
    cue_count: int | None = Field(default=None, ge=0, le=8)
    tag_options: TagOptions | None = None
    watched_folders: list[str] | None = None
    stem_model: StemModel | None = None
    stem_device: StemDevice | None = None
    daw_folder: str | None = None  # "" clears it
    stem_export_format: StemExportFormat | None = None
    stem_export_template: str | None = Field(default=None, min_length=1, max_length=200)
    check_updates: bool | None = None

    @field_validator("watched_folders")
    @classmethod
    def _check_folders(cls, value: list[str] | None) -> list[str] | None:
        return None if value is None else _folders(value)

    @field_validator("daw_folder")
    @classmethod
    def _check_daw_folder(cls, value: str | None) -> str | None:
        return None if value is None else _optional_folder(value)


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


# ---- playlists (SPEC 2.11) ----

PLAYLIST_NAME_MAX = 200
EMOJI_MAX = 16


class PlaylistNode(RpcModel):
    id: int
    parent_id: int | None
    name: str
    emoji: str | None
    is_folder: bool
    sort_order: int
    smart: TrackFilter | None  # set for smart playlists
    track_count: int  # regular: entries; smart: current matches; folder: 0


class PlaylistTree(RpcModel):
    """Every playlist and folder, parents before children, siblings in order."""

    playlists: list[PlaylistNode]


class PlaylistCreateParams(RpcModel):
    parent_id: int | None = None
    name: str = Field(min_length=1, max_length=PLAYLIST_NAME_MAX)
    emoji: str | None = Field(default=None, max_length=EMOJI_MAX)
    is_folder: bool = False
    smart: TrackFilter | None = None


class PlaylistUpdateParams(RpcModel):
    playlist_id: int
    name: str | None = Field(default=None, min_length=1, max_length=PLAYLIST_NAME_MAX)
    emoji: str | None = Field(default=None, max_length=EMOJI_MAX)  # "" removes it
    smart: TrackFilter | None = None


class PlaylistIdParams(RpcModel):
    playlist_id: int


class PlaylistMoveParams(RpcModel):
    playlist_id: int
    parent_id: int | None = None
    index: int = Field(ge=0)  # position among the new siblings


class PlaylistDeleteResult(RpcModel):
    deleted: int  # the playlist plus everything nested in it


class PlaylistTracksParams(RpcModel):
    playlist_id: int
    track_ids: list[int] = Field(min_length=1)
    # Insert before this position (0-based); None appends. For reorder, the position in
    # the list once the moved tracks are taken out.
    index: int | None = Field(default=None, ge=0)


class PlaylistTracksResult(RpcModel):
    changed: int  # tracks added, removed or moved
    track_count: int


class M3UImportParams(RpcModel):
    path: str
    parent_id: int | None = None


class M3UImportResult(RpcModel):
    playlist: PlaylistNode
    matched: int  # entries already in the library
    imported: int  # files added to the library by this import
    missing: list[str]  # entries that point to no readable audio file


class M3UExportParams(RpcModel):
    playlist_id: int
    path: str  # .m3u or .m3u8
    relative: bool = False  # paths relative to the playlist file's folder


class M3UExportResult(RpcModel):
    path: str
    written: int
    backup_path: str | None  # previous file at ``path``, kept before overwriting


# ---- export to DJ software (SPEC 2.12) ----

ExportLanguage = Literal["es", "en"]
ExportWarningCode = Literal[
    "missing_file", "not_analyzed", "no_beatgrid", "unsupported_format", "app_running",
    "not_in_collection",  # Engine DJ: the track must be imported in Engine first
]  # fmt: skip


class ExportOptions(RpcModel):
    simulate: bool = True  # report what would change without writing anything
    path: str | None = None  # destination file (default: the target's usual place)
    track_ids: list[int] | None = None  # None = the whole library
    include_playlists: bool = True
    cues: bool = True
    colors: bool = True
    beatgrid: bool = True
    key: bool = True
    # Rekordbox: also write each hot cue as a memory cue.
    memory_cues: bool = False
    notation: Notation = "classical"  # how the key is written (Rekordbox reads classical)
    language: ExportLanguage = "en"  # names of automatic cues


class ExportWarning(RpcModel):
    code: ExportWarningCode
    track_id: int | None = None
    path: str | None = None


ExportAction = Literal["exported", "updated", "added"]
EXPORT_ITEMS_MAX = 1000


class ExportItem(RpcModel):
    track_id: int
    title: str
    action: ExportAction  # exported (new file), updated or added (existing collection)
    cues: int


class CollectionStatus(RpcModel):
    """Where a DJ program keeps its collection, and whether it is running."""

    collection_path: str | None  # found automatically, if any
    running: bool


class ExportResult(RpcModel):
    target: str
    simulated: bool
    path: str
    tracks: int
    cues: int
    playlists: int
    skipped: int  # tracks left out (unsupported format)
    warnings: list[ExportWarning]
    backup_path: str | None
    # Exports written into the audio files (Serato) are a tag batch: tags.undo reverts it.
    batch_id: str | None = None
    # Per-track detail (the first EXPORT_ITEMS_MAX; ``tracks`` has the full count).
    items: list[ExportItem] = Field(default_factory=list)


# ---- stems (SPEC 2.16) ----


class StemModelStatus(RpcModel):
    model: StemModel
    installed: bool
    total_bytes: int  # size of the model's weight files
    missing_bytes: int  # still to download


class StemsCacheInfo(RpcModel):
    bytes: int
    tracks: int


class StemsStatus(RpcModel):
    models: list[StemModelStatus]
    # Accelerator "auto" would use on this machine (None = CPU only).
    accelerator: Literal["mps", "cuda"] | None
    cache: StemsCacheInfo


class StemModelParams(RpcModel):
    model: StemModel


class StemModelDownloaded(RpcModel):
    model: StemModel
    downloaded_bytes: int


class StemsSeparateParams(RpcModel):
    track_ids: list[int] = Field(min_length=1)
    model: StemModel | None = None  # default: the stem_model setting


class StemFailure(RpcModel):
    track_id: int
    error: str


class StemsSeparateResult(RpcModel):
    model: StemModel
    device: str
    separated: list[int]
    cached: list[int]  # already separated (cache hit)
    failed: list[StemFailure]


class StemSet(RpcModel):
    track_id: int
    model: StemModel
    vocals: str
    drums: str
    bass: str
    other: str
    instrumental: str
    created_at: str


class StemsGetParams(RpcModel):
    track_id: int
    model: StemModel | None = None  # default: the stem_model setting


class StemsGetResult(RpcModel):
    stems: StemSet | None


# ---- render (SPEC 2.15 and 2.16) ----

RenderSource = Literal["mix", "vocals", "drums", "bass", "other", "instrumental"]


class RenderSpec(RpcModel):
    """A processed version of a track: segment, stem, pitch and tempo."""

    track_id: int
    source: RenderSource = "mix"  # the full track or one of its stems
    model: StemModel | None = None  # stems only; default: the stem_model setting
    start: float = Field(default=0.0, ge=0)  # seconds in the original track
    duration: float | None = Field(default=None, gt=0)  # seconds; None = to the end
    semitones: float = Field(default=0.0, ge=-12, le=12)
    target_bpm: float | None = Field(default=None, gt=0)  # None = original tempo


class RenderResult(RpcModel):
    path: str  # WAV, 44.1 kHz, 24-bit stereo, in the render cache
    sample_rate: int
    frames: int
    duration: float  # seconds of the rendered file
    bpm: float | None  # tempo of the rendered audio
    time_ratio: float  # rendered duration / original duration
    # First downbeat of the rendered audio, in samples from its start (None without beatgrid).
    first_downbeat: int | None
    cached: bool


class RenderPreviewResult(RpcModel):
    # A cache hit answers at once (``result``); otherwise a job renders it (``jobId``) and
    # ``job.finished`` carries the RenderResult.
    job_id: str | None = None
    result: RenderResult | None = None


# ---- stem export (SPEC 2.16) ----


class StemExportItem(RpcModel):
    track_id: int
    source: RenderSource = "mix"
    semitones: float = Field(default=0.0, ge=-12, le=12)
    target_bpm: float | None = Field(default=None, gt=0)


class StemExportParams(RpcModel):
    items: list[StemExportItem] = Field(min_length=1)
    format: StemExportFormat | None = None  # default: the stem_export_format setting
    template: str | None = Field(default=None, min_length=1, max_length=200)
    destination: str | None = None  # absolute folder; default: the daw_folder setting
    # Name of each source in file names (the UI language); English by default.
    stem_labels: dict[RenderSource, str] = Field(default_factory=dict)
    model: StemModel | None = None  # default: the stem_model setting

    @field_validator("destination")
    @classmethod
    def _check_destination(cls, value: str | None) -> str | None:
        return None if value is None else _optional_folder(value) or None


class StemExportNames(RpcModel):
    folder: str
    names: list[str]


class StemExportFile(RpcModel):
    track_id: int
    source: RenderSource
    path: str


class StemExportFailure(RpcModel):
    track_id: int
    source: RenderSource
    error: str


class StemExportResult(RpcModel):
    folder: str
    files: list[StemExportFile]
    failed: list[StemExportFailure]


# ---- ideas: mashups and DJ mix (SPEC 2.15) ----

SuggestMode = Literal["mashup", "mix"]
EnergyDirection = Literal["keep", "up", "down"]
KeyRelation = Literal[
    "same", "adjacent", "relative", "diagonal", "energy_boost", "semitone_up", "none"
]


class SuggestFilters(RpcModel):
    """The "idea filter": limits the candidates in big libraries."""

    energy_min: int | None = Field(default=None, ge=1, le=10)
    energy_max: int | None = Field(default=None, ge=1, le=10)
    bpm_min: float | None = Field(default=None, gt=0)
    bpm_max: float | None = Field(default=None, gt=0)
    playlist_ids: list[int] = Field(default_factory=list)  # in any of them (smart ones too)
    genres: list[str] = Field(default_factory=list)


class SuggestParams(RpcModel):
    track_id: int  # deck A
    shift_a: int = Field(default=0, ge=-6, le=6)  # semitones applied to deck A
    allow_shift: bool = True  # try shifting B by up to ±max_shift semitones
    max_shift: int = Field(default=2, ge=0, le=6)
    filters: SuggestFilters = Field(default_factory=SuggestFilters)
    energy_direction: EnergyDirection = "up"  # DJ Mix: keep, raise or lower the energy
    exclude: list[int] = Field(default_factory=list)  # tracks never suggested
    limit: int = Field(default=50, ge=1, le=500)


class SuggestScores(RpcModel):
    key: float
    bpm: float
    energy: float
    vocal: float  # mashup only (0 in DJ Mix)
    genre: float


class SuggestReason(RpcModel):
    """One chip of the "why": the frontend writes the text in the UI language."""

    kind: Literal["key", "shift", "bpm", "vocals", "energy", "genre"]
    # key: the KeyRelation · shift: "b" · bpm: "same", "half", "double" · vocals: "a" (voice
    # in A + instrumental in B) or "b" · energy: "same", "up", "down" · genre: "same", "related"
    code: str
    value: float | None = None  # semitones, BPM difference in % or energy difference


class Suggestion(RpcModel):
    track: TrackSummary
    score: int  # 0-100
    shift_b: int  # semitones to apply to B
    key_b: KeyRef  # B's key after the shift
    relation: KeyRelation  # from A (shifted) to B (shifted)
    bpm_factor: float  # 0.5, 1 or 2: B's tempo is compared (and matched) at this multiple
    scores: SuggestScores
    reasons: list[SuggestReason]


class SuggestResult(RpcModel):
    mode: SuggestMode
    track_id: int
    shift_a: int
    candidates: int  # tracks scored after the filters
    items: list[Suggestion]
    elapsed_ms: float


# ---- mashup favorites (SPEC 2.15) ----

DeckStem = Literal["mix", "vocals", "instrumental"]
FavoriteSort = Literal["date", "rating"]


class FavoriteCombination(RpcModel):
    """What a favorite keeps: tracks, mode, key changes, cues, stems and tempo multiple."""

    track_a: int
    track_b: int
    mode: SuggestMode
    shift_a: int = Field(default=0, ge=-6, le=6)
    shift_b: int = Field(default=0, ge=-6, le=6)
    cue_a: float | None = Field(default=None, ge=0)  # where each deck plays from
    cue_b: float | None = Field(default=None, ge=0)
    stem_a: DeckStem = "mix"
    stem_b: DeckStem = "mix"
    bpm_factor: float = 1.0  # B is matched to A's tempo at this multiple: 0.5, 1 or 2

    @field_validator("bpm_factor")
    @classmethod
    def _factor(cls, value: float) -> float:
        if value not in (0.5, 1.0, 2.0):
            raise ValueError("bpm_factor must be 0.5, 1 or 2")
        return value


class FavoriteSaveParams(FavoriteCombination):
    rating: int = Field(default=0, ge=0, le=5)
    notes: str | None = Field(default=None, max_length=2000)


class Favorite(FavoriteCombination):
    id: int
    rating: int
    notes: str | None
    created_at: str
    a: TrackSummary
    b: TrackSummary


class FavoriteListParams(RpcModel):
    sort: FavoriteSort = "date"  # newest first, or best rated first (then newest)


class FavoriteList(RpcModel):
    items: list[Favorite]


class FavoriteUpdateParams(RpcModel):
    """Only the fields sent change; ``notes: null`` clears them."""

    favorite_id: int
    rating: int | None = Field(default=None, ge=0, le=5)
    notes: str | None = Field(default=None, max_length=2000)


class FavoriteIdParams(RpcModel):
    favorite_id: int


class FavoriteDeleteResult(RpcModel):
    deleted: bool


# ---- set builder (SPEC 2.17) ----

CurvePreset = Literal["warmup_peak_cooldown", "flat", "ascending", "custom"]
TransitionQuality = Literal["good", "fair", "bad"]


class CurvePoint(RpcModel):
    x: float = Field(ge=0, le=1)  # position in the set: 0 = first track, 1 = last
    energy: float = Field(ge=1, le=10)


class EnergyCurve(RpcModel):
    """Target energy along the set: a template or points drawn by hand (``custom``)."""

    preset: CurvePreset = "warmup_peak_cooldown"
    points: list[CurvePoint] = Field(default_factory=list, max_length=64)  # custom only

    @model_validator(mode="after")
    def _custom_points(self) -> "EnergyCurve":
        if self.preset == "custom" and len(self.points) < 2:
            raise ValueError("a custom curve needs at least 2 points")
        return self


class BuilderPool(RpcModel):
    """The tracks to build from: a playlist (smart ones too) and/or a selection."""

    playlist_id: int | None = None
    track_ids: list[int] = Field(default_factory=list)


class BuilderGenerateParams(RpcModel):
    pool: BuilderPool
    curve: EnergyCurve = Field(default_factory=EnergyCurve)
    count: int | None = Field(default=None, ge=2, le=200)  # number of tracks…
    duration_min: float | None = Field(default=None, gt=0, le=1440)  # …or target minutes
    start_track_id: int | None = None
    allow_shift: bool = False  # transitions may shift the next track ±2 semitones
    seed: int = 0  # breaks ties: the same input and seed give the same set
    beam_width: int = Field(default=50, ge=1, le=500)


class BuilderScoreParams(RpcModel):
    """Score an order as it is (after reordering or replacing by hand)."""

    track_ids: list[int] = Field(min_length=1)
    curve: EnergyCurve = Field(default_factory=EnergyCurve)
    allow_shift: bool = False


class BuilderAlternativesParams(BuilderScoreParams):
    position: int = Field(ge=0)  # the track to replace
    pool: BuilderPool = Field(default_factory=BuilderPool)  # where to look (empty = library)
    limit: int = Field(default=10, ge=1, le=100)


class BuilderTransition(RpcModel):
    """From the previous track into this one (DJ Mix scoring, SPEC 2.15)."""

    score: float  # 0-1, the DJ Mix weighted score
    quality: TransitionQuality  # good (green) / fair (amber) / bad (red)
    clash: bool  # the keys do not mix (key score 0): only when there was no alternative
    relation: KeyRelation
    shift: int  # semitones applied to this track (allow_shift)
    bpm_factor: float
    bpm_delta: float  # % between the tempos (at the factor)
    energy_delta: int | None
    scores: SuggestScores


class BuilderItem(RpcModel):
    track: TrackSummary
    target_energy: float
    transition: BuilderTransition | None  # None for the first track


class BuilderResult(RpcModel):
    items: list[BuilderItem]
    mean_score: float  # mean transition score
    clashes: int  # transitions whose keys do not mix
    duration: float  # seconds
    pool_size: int  # analysed tracks the set was built from
    skipped: int  # pool tracks without key or BPM
    elapsed_ms: float


class BuilderAlternative(RpcModel):
    track: TrackSummary
    delta: float  # change of the set's objective if this track replaces the one there
    into: BuilderTransition | None  # previous → this one (None at the start)
    out: BuilderTransition | None  # this one → next (None at the end)


class BuilderAlternatives(RpcModel):
    items: list[BuilderAlternative]


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
    "tags.history": (TagHistoryParams, TagHistory),
    "tags.cleanPreview": (CleanParams, TagPreview),
    "tags.clean": (CleanParams, JobStarted),
    "tags.editPreview": (EditParams, TagPreview),
    "tags.edit": (EditParams, JobStarted),
    "settings.get": (None, Settings),
    "settings.set": (SettingsUpdate, Settings),
    "playlists.tree": (None, PlaylistTree),
    "playlists.create": (PlaylistCreateParams, PlaylistNode),
    "playlists.update": (PlaylistUpdateParams, PlaylistNode),
    "playlists.move": (PlaylistMoveParams, PlaylistTree),
    "playlists.delete": (PlaylistIdParams, PlaylistDeleteResult),
    "playlists.addTracks": (PlaylistTracksParams, PlaylistTracksResult),
    "playlists.removeTracks": (PlaylistTracksParams, PlaylistTracksResult),
    "playlists.reorderTracks": (PlaylistTracksParams, PlaylistTracksResult),
    "playlists.importM3u": (M3UImportParams, M3UImportResult),
    "playlists.exportM3u": (M3UExportParams, M3UExportResult),
    "export.rekordbox": (ExportOptions, JobStarted),
    "export.traktor": (ExportOptions, JobStarted),
    "export.traktorStatus": (None, CollectionStatus),
    "export.serato": (ExportOptions, JobStarted),
    "export.virtualdj": (ExportOptions, JobStarted),
    "export.virtualdjStatus": (None, CollectionStatus),
    "export.engineDj": (ExportOptions, JobStarted),
    "export.engineDjStatus": (None, CollectionStatus),
    "stems.status": (None, StemsStatus),
    "stems.downloadModel": (StemModelParams, JobStarted),
    "stems.separate": (StemsSeparateParams, JobStarted),
    "stems.get": (StemsGetParams, StemsGetResult),
    "stems.clearCache": (None, StemsCacheInfo),
    "render.preview": (RenderSpec, RenderPreviewResult),
    "stems.exportPreview": (StemExportParams, StemExportNames),
    "stems.export": (StemExportParams, JobStarted),
    "suggest.mashups": (SuggestParams, SuggestResult),
    "suggest.mixouts": (SuggestParams, SuggestResult),
    "favorites.list": (FavoriteListParams, FavoriteList),
    "favorites.save": (FavoriteSaveParams, Favorite),
    "favorites.update": (FavoriteUpdateParams, Favorite),
    "favorites.delete": (FavoriteIdParams, FavoriteDeleteResult),
    "builder.generate": (BuilderGenerateParams, BuilderResult),
    "builder.score": (BuilderScoreParams, BuilderResult),
    "builder.alternatives": (BuilderAlternativesParams, BuilderAlternatives),
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
    ExportResult,
    StemModelDownloaded,
    StemsSeparateResult,
    RenderResult,
    StemExportResult,
]
