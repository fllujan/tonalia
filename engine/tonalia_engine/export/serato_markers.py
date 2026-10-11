"""Serato ``Markers2`` hot cues inside the audio files (SPEC 2.12).

Implemented from the public reverse-engineering notes of the "serato-tags" project:

- payload: ``01 01``, entries (NUL-terminated ASCII type, big-endian ``uint32`` length,
  data), then a ``00`` terminator;
- the payload is base64-encoded (no ``=`` padding, a line break every 72 characters),
  prefixed with ``01 01`` and NUL-padded to at least 470 bytes: that is the GEOB data;
- MP3 and AIFF keep it in an ID3 ``GEOB`` frame described "Serato Markers2"; FLAC in the
  ``SERATO_MARKERS_V2`` Vorbis comment and MP4 in ``----:com.serato.dj:markersv2``, both
  as base64 of ``application/octet-stream\\0\\0Serato Markers2\\0`` + the GEOB data.

Entries Tonalia does not manage (loops, flips, track colour, beatgrid lock, cues in
other slots) are kept byte for byte. Cue colours are snapped to Serato's palette.
"""

from __future__ import annotations

import base64
import struct
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

import mutagen
from mutagen.id3 import GEOB, ID3
from mutagen.mp4 import MP4FreeForm

from ..db import Database
from ..jobs import JobContext
from ..rpc_schema import ExportItem, ExportOptions, ExportResult, ExportWarning
from ..tags import service as tag_service
from ..tags.writer import FieldChange, PreparedWrite, prepare_mutation
from .common import add_item, load_tracks

GEOB_DESC = "Serato Markers2"
VORBIS_KEY = "SERATO_MARKERS_V2"
MP4_KEY = "----:com.serato.dj:markersv2"
VORBIS_PREFIX = b"application/octet-stream\x00\x00Serato Markers2\x00"
MIN_GEOB = 470
NAME_MAX = 50  # bytes, without the terminator
SERATO_FORMATS = frozenset({"mp3", "flac", "m4a", "aiff"})
_EXTENSIONS = {".mp3": "mp3", ".flac": "flac", ".m4a": "m4a", ".mp4": "m4a", ".aif": "aiff",
               ".aiff": "aiff"}  # fmt: skip

# Serato DJ's hot-cue palette.
PALETTE = (
    "#CC0000", "#CC4400", "#CC8800", "#CCCC00", "#88CC00", "#44CC00", "#00CC00", "#00CC44",
    "#00CC88", "#00CCCC", "#0088CC", "#0044CC", "#0000CC", "#4400CC", "#8800CC", "#CC00CC",
    "#CC0088", "#CC0044",
)  # fmt: skip


class SeratoTagError(ValueError):
    pass


@dataclass(frozen=True)
class Entry:
    name: str
    data: bytes


@dataclass(frozen=True)
class CueMarker:
    index: int
    position_ms: int
    color: str  # "#RRGGBB"
    name: str

    def entry(self) -> Entry:
        raw = self.name.encode("utf-8")[:NAME_MAX].decode("utf-8", errors="ignore").encode()
        data = (
            b"\x00"
            + struct.pack(">BI", self.index, self.position_ms)
            + b"\x00"
            + bytes.fromhex(self.color.lstrip("#"))
            + b"\x00\x00"
            + raw
            + b"\x00"
        )
        return Entry("CUE", data)


def parse_cue(entry: Entry) -> CueMarker:
    data = entry.data
    if entry.name != "CUE" or len(data) < 13:
        raise SeratoTagError("not a CUE entry")
    index, position = struct.unpack(">BI", data[1:6])
    name = data[12:].split(b"\x00", 1)[0].decode("utf-8", errors="replace")
    return CueMarker(index, position, "#" + data[7:10].hex().upper(), name)


def nearest_color(color: str) -> str:
    r, g, b = bytes.fromhex(color.lstrip("#"))
    return min(
        PALETTE,
        key=lambda c: sum(
            (x - y) ** 2 for x, y in zip(bytes.fromhex(c[1:]), (r, g, b), strict=True)
        ),
    )


# ---- payload ----


def _decode_payload(payload: bytes) -> list[Entry]:
    if payload[:2] != b"\x01\x01":
        raise SeratoTagError("unknown Markers2 version")
    entries: list[Entry] = []
    pos = 2
    while pos < len(payload) and payload[pos] != 0:
        end = payload.index(b"\x00", pos)
        name = payload[pos:end].decode("ascii")
        (length,) = struct.unpack(">I", payload[end + 1 : end + 5])
        start = end + 5
        entries.append(Entry(name, payload[start : start + length]))
        pos = start + length
    return entries


def _encode_payload(entries: Sequence[Entry]) -> bytes:
    out = b"\x01\x01"
    for e in entries:
        out += e.name.encode("ascii") + b"\x00" + struct.pack(">I", len(e.data)) + e.data
    return out + b"\x00"


def _b64decode(body: bytes) -> bytes:
    body = body.replace(b"\n", b"").strip(b"\x00")
    if len(body) % 4 == 1:  # Serato sometimes writes one character too many
        body += b"A=="
    else:
        body += b"=" * (-len(body) % 4)
    return base64.b64decode(body)


def _b64encode(data: bytes) -> bytes:
    body = base64.b64encode(data).rstrip(b"=")
    return b"\n".join(body[i : i + 72] for i in range(0, len(body), 72))


def decode_geob(data: bytes) -> list[Entry]:
    if data[:2] != b"\x01\x01":
        raise SeratoTagError("unknown Markers2 header")
    return _decode_payload(_b64decode(data[2:].split(b"\x00", 1)[0]))


def encode_geob(entries: Sequence[Entry]) -> bytes:
    data = b"\x01\x01" + _b64encode(_encode_payload(entries))
    return data + b"\x00" * max(0, MIN_GEOB - len(data))


def encode_vorbis(geob: bytes) -> str:
    return _b64encode(VORBIS_PREFIX + geob).decode("ascii")


def decode_vorbis(text: str) -> bytes:
    raw = _b64decode(text.encode("ascii"))
    if not raw.startswith(VORBIS_PREFIX):
        raise SeratoTagError("unexpected Serato Markers2 wrapper")
    return raw[len(VORBIS_PREFIX) :]


def merge_cues(existing: Sequence[Entry], cues: Sequence[CueMarker]) -> list[Entry]:
    """Existing entries with Tonalia's cues in their slots (colours snapped)."""
    slots = {c.index for c in cues}
    kept = [e for e in existing if not (e.name == "CUE" and parse_cue(e).index in slots)]
    old_cues = [parse_cue(e) for e in kept if e.name == "CUE"]
    new = sorted(
        [
            *old_cues,
            *(CueMarker(c.index, c.position_ms, nearest_color(c.color), c.name) for c in cues),
        ],
        key=lambda c: c.index,
    )
    head = [e for e in kept if e.name == "COLOR"] or [Entry("COLOR", b"\x00\xff\xff\xff")]
    others = [e for e in kept if e.name not in ("COLOR", "CUE", "BPMLOCK")]
    tail = [e for e in kept if e.name == "BPMLOCK"] or [Entry("BPMLOCK", b"\x00")]
    return [*head, *(c.entry() for c in new), *others, *tail]


# ---- files ----


def file_format(path: Path) -> str | None:
    return _EXTENSIONS.get(path.suffix.lower())


def read_entries(path: Path) -> list[Entry]:
    """Markers2 entries of an audio file ([] when it has none)."""
    fmt = file_format(path)
    audio = mutagen.File(path)
    if audio is None or fmt is None or audio.tags is None:
        return []
    if fmt in ("mp3", "aiff"):
        frames = [f for f in audio.tags.getall("GEOB") if f.desc == GEOB_DESC]
        return decode_geob(frames[0].data) if frames else []
    if fmt == "flac":
        values = audio.tags.get(VORBIS_KEY)
        return decode_geob(decode_vorbis(values[0])) if values else []
    values = audio.tags.get(MP4_KEY)
    return decode_geob(decode_vorbis(bytes(values[0]).decode("ascii"))) if values else []


def write_entries(path: Path, entries: Sequence[Entry]) -> None:
    """Store ``entries`` in ``path`` (in place: callers pass a temporary copy)."""
    fmt = file_format(path)
    if fmt is None:
        raise SeratoTagError(f"Serato tags are not supported in {path.suffix} files")
    audio = mutagen.File(path)
    if audio is None:
        raise SeratoTagError(f"cannot read {path.name}")
    if audio.tags is None:
        audio.add_tags()
    geob = encode_geob(entries)
    if fmt in ("mp3", "aiff"):
        tags: ID3 = audio.tags
        tags.delall(f"GEOB:{GEOB_DESC}")
        tags.add(
            GEOB(
                encoding=0, mime="application/octet-stream", filename="", desc=GEOB_DESC, data=geob
            )
        )
        version = 3 if tags.version[1] == 3 else 4
        audio.save(v2_version=version)
        return
    if fmt == "flac":
        audio.tags[VORBIS_KEY] = [encode_vorbis(geob)]
    else:
        audio.tags[MP4_KEY] = [MP4FreeForm(encode_vorbis(geob).encode("ascii"))]
    audio.save()


# ---- export ----


def _summary(entries: Sequence[Entry]) -> str:
    cues = [parse_cue(e) for e in entries if e.name == "CUE"]
    return ", ".join(f"{c.index + 1}:{c.name or '-'}@{c.position_ms / 1000:.3f}s" for c in cues)


def export_serato(db: Database, options: ExportOptions, job: JobContext) -> ExportResult:
    """Write each track's hot cues into its file as Serato Markers2 (a tag batch)."""
    tracks = load_tracks(db, options.track_ids, options.language)
    warnings: list[ExportWarning] = []
    planned: dict[int, tuple[list[Entry], list[Entry]]] = {}
    skipped = cue_total = 0
    items: list[ExportItem] = []
    for i, track in enumerate(tracks):
        if i % 200 == 0:
            job.check_cancelled()
        if file_format(track.path) is None:
            warnings.append(
                ExportWarning(code="unsupported_format", track_id=track.id, path=str(track.path))
            )
            skipped += 1
            continue
        if not track.path.exists():
            warnings.append(
                ExportWarning(code="missing_file", track_id=track.id, path=str(track.path))
            )
            continue
        if not options.cues or not track.cues:
            continue
        markers = [
            CueMarker(
                c.slot,
                round(c.position * 1000),
                c.color if options.colors and c.color else PALETTE[0],
                c.name,
            )
            for c in track.cues
        ]
        try:
            existing = read_entries(track.path)
        except (SeratoTagError, mutagen.MutagenError, ValueError, OSError):
            existing = []  # unreadable Serato data is replaced (the file is backed up)
        desired = merge_cues(existing, markers)
        if desired != existing:
            planned[track.id] = (existing, desired)
            cue_total += len(markers)
            add_item(items, track, "updated", len(markers))

    batch_id: str | None = None
    if planned and not options.simulate:

        def prepare(tid: int, path: Path) -> PreparedWrite | None:
            existing, desired = planned[tid]
            return prepare_mutation(
                path,
                lambda tmp: write_entries(tmp, desired),
                lambda tmp: read_entries(tmp) == desired,
                [FieldChange("serato_markers2", _summary(existing) or None, _summary(desired))],
            )

        written = tag_service.write_batch(
            db, list(planned), None, {"kind": "serato"}, job, prepare=prepare
        )
        batch_id = written.batch_id
        warnings += [ExportWarning(code="missing_file", path=f.path) for f in written.failed]
    return ExportResult(
        target="serato",
        simulated=options.simulate,
        path="",
        tracks=len(planned),
        cues=cue_total,
        playlists=0,
        skipped=skipped,
        warnings=warnings,
        backup_path=None,
        batch_id=batch_id,
        items=items,
    )
