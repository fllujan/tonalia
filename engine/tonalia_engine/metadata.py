"""Read tags, stream info and embedded artwork with mutagen.

Reading never fails on bad tags: unreadable fields are left empty. Only a file that
mutagen cannot open at all raises :class:`MetadataError` (the caller then marks the
track as ``error``). Existing key/BPM tags are kept as raw strings so they can serve as
references for evaluation (SPEC 2.2) — they never override Tonalia's own analysis.
"""

from __future__ import annotations

import base64
import hashlib
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import mutagen
from mutagen.flac import FLAC, Picture
from mutagen.flac import error as flac_error
from mutagen.id3 import ID3
from mutagen.mp4 import MP4, MP4Cover


class MetadataError(RuntimeError):
    pass


@dataclass
class Artwork:
    data: bytes
    mime: str


@dataclass
class TrackMetadata:
    format: str | None = None
    duration: float | None = None
    sample_rate: int | None = None
    bitrate: int | None = None  # kbps
    title: str | None = None
    artist: str | None = None
    album: str | None = None
    genre: str | None = None
    year: int | None = None
    label: str | None = None
    comment: str | None = None
    key_tag: str | None = None
    bpm_tag: str | None = None
    artwork: Artwork | None = field(default=None, repr=False)


_ID3_TEXT = {
    "title": "TIT2",
    "artist": "TPE1",
    "album": "TALB",
    "genre": "TCON",
    "year": "TDRC",
    "label": "TPUB",
    "key_tag": "TKEY",
    "bpm_tag": "TBPM",
}
_MP4_TEXT = {
    "title": "\xa9nam",
    "artist": "\xa9ART",
    "album": "\xa9alb",
    "genre": "\xa9gen",
    "year": "\xa9day",
    "comment": "\xa9cmt",
    "label": "----:com.apple.iTunes:LABEL",
    "key_tag": "----:com.apple.iTunes:initialkey",
}
_VORBIS_TEXT = {
    "title": ["title"],
    "artist": ["artist"],
    "album": ["album"],
    "genre": ["genre"],
    "year": ["date", "year"],
    "label": ["label", "organization", "publisher"],
    "comment": ["comment", "description"],
    "key_tag": ["initialkey", "key"],
    "bpm_tag": ["bpm"],
}


def _clean(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, bytes):
        value = value.decode("utf-8", "replace")
    text = str(value).replace("\x00", " ").strip()
    return text or None


def _first(values: Any) -> str | None:
    if isinstance(values, list | tuple):
        for v in values:
            if (text := _clean(v)) is not None:
                return text
        return None
    return _clean(values)


def parse_year(text: str | None) -> int | None:
    if not text:
        return None
    match = re.search(r"(1[89]\d\d|2\d\d\d)", text)
    return int(match.group(1)) if match else None


def _read_id3(tags: ID3, meta: TrackMetadata) -> None:
    for attr, frame_id in _ID3_TEXT.items():
        frame = tags.get(frame_id)
        if frame is not None:
            setattr(meta, attr, _first(getattr(frame, "text", None)))
    comments = tags.getall("COMM")
    # Prefer the plain comment (empty description) over iTunes/encoder comments.
    comments.sort(key=lambda c: (c.desc != "", c.desc.startswith("iTun")))
    for c in comments:
        if (text := _first(c.text)) is not None:
            meta.comment = text
            break
    pictures = tags.getall("APIC")
    pictures.sort(key=lambda p: p.type != 3)  # front cover first
    if pictures and pictures[0].data:
        meta.artwork = Artwork(pictures[0].data, pictures[0].mime or "image/jpeg")


def _read_mp4(audio: MP4, meta: TrackMetadata) -> None:
    tags: Any = audio.tags or {}
    for attr, key in _MP4_TEXT.items():
        if key in tags:
            setattr(meta, attr, _first(tags[key]))
    if tags.get("tmpo"):
        meta.bpm_tag = str(tags["tmpo"][0])
    covers = tags.get("covr") or []
    if covers:
        cover = covers[0]
        mime = "image/png" if cover.imageformat == MP4Cover.FORMAT_PNG else "image/jpeg"
        meta.artwork = Artwork(bytes(cover), mime)
    codec = getattr(audio.info, "codec", "") or ""
    meta.format = "alac" if codec.startswith("alac") else "m4a"


def _read_vorbis(audio: Any, meta: TrackMetadata) -> None:
    tags = audio.tags or {}
    lowered = {k.lower(): v for k, v in tags.items()}
    for attr, keys in _VORBIS_TEXT.items():
        for key in keys:
            if key in lowered and (text := _first(lowered[key])) is not None:
                setattr(meta, attr, text)
                break
    pictures: list[Picture] = list(getattr(audio, "pictures", []) or [])
    for b64 in lowered.get("metadata_block_picture", []):
        try:
            pictures.append(Picture(base64.b64decode(b64)))
        except (ValueError, flac_error):
            continue
    pictures.sort(key=lambda p: p.type != 3)
    if pictures and pictures[0].data:
        meta.artwork = Artwork(pictures[0].data, pictures[0].mime or "image/jpeg")


_FORMAT_BY_TYPE = {
    "MP3": "mp3",
    "WAVE": "wav",
    "AIFF": "aiff",
    "FLAC": "flac",
    "OggVorbis": "ogg",
    "OggOpus": "ogg",
    "MP4": "m4a",
}


def read_metadata(path: Path) -> TrackMetadata:
    try:
        audio = mutagen.File(path)
    except Exception as exc:  # mutagen raises many unrelated exception types
        raise MetadataError(f"cannot read {path.name}: {exc}") from exc
    if audio is None:
        raise MetadataError(f"unsupported or unrecognized file: {path.name}")

    meta = TrackMetadata(format=_FORMAT_BY_TYPE.get(type(audio).__name__))
    info = audio.info
    meta.duration = float(getattr(info, "length", 0) or 0) or None
    meta.sample_rate = int(getattr(info, "sample_rate", 0) or 0) or None
    bitrate = int(getattr(info, "bitrate", 0) or 0)
    meta.bitrate = round(bitrate / 1000) if bitrate else None

    try:
        if isinstance(audio, MP4):
            _read_mp4(audio, meta)
        elif isinstance(audio, FLAC) or meta.format == "ogg":
            _read_vorbis(audio, meta)
        elif isinstance(audio.tags, ID3):
            _read_id3(audio.tags, meta)
    except Exception:  # never let a malformed tag block the import
        pass
    meta.year = parse_year(meta.year) if isinstance(meta.year, str) else meta.year
    return meta


_EXT_BY_MIME = {"image/png": "png", "image/gif": "gif", "image/webp": "webp"}


def save_artwork(artwork: Artwork, cache_dir: Path) -> Path:
    """Store artwork by content hash (identical covers are stored once)."""
    digest = hashlib.sha256(artwork.data).hexdigest()[:32]
    ext = _EXT_BY_MIME.get(artwork.mime.lower(), "jpg")
    dest = cache_dir / digest[:2] / f"{digest}.{ext}"
    if not dest.exists():
        dest.parent.mkdir(parents=True, exist_ok=True)
        tmp = dest.with_name(dest.name + ".part")
        tmp.write_bytes(artwork.data)
        tmp.replace(dest)
    return dest
