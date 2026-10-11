"""Write key, BPM, energy and the comment template into audio files (SPEC 2.9).

Fields per tag family:

=========  ============================  ===================  =================
field      ID3 (MP3, WAV, AIFF)          MP4 (M4A, ALAC)      Vorbis (FLAC, OGG)
=========  ============================  ===================  =================
key        TKEY                          ----:…:initialkey    INITIALKEY
bpm        TBPM (integer)                tmpo (integer)       BPM
comment    COMM (empty description)      ©cmt                 COMMENT
grouping   TIT1                          ©grp                 GROUPING
rating     POPM (energy x 25.5)          —                    RATING (energy x 10)
title      TIT2                          ©nam                 TITLE
artist     TPE1                          ©ART                 ARTIST
album      TALB                          ©alb                 ALBUM
genre      TCON                          ©gen                 GENRE
year       TDRC                          ©day                 DATE
label      TPUB                          ----:…:LABEL         LABEL
=========  ============================  ===================  =================

An empty value removes the field.

Writes go through a temporary copy next to the file: tags are written there, read
back to verify, and only then renamed over the original (two phases, so the caller
can store the undo record first). ID3v2.3 files stay v2.3.
"""

from __future__ import annotations

import os
import re
import shutil
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any, ClassVar, Protocol

import mutagen
from mutagen.id3 import COMM, ID3, POPM, Frames
from mutagen.mp4 import MP4, MP4FreeForm

from ..analysis.tempo import round_bpm
from ..fsutil import temp_beside
from ..keys import Key, format_key
from ..rpc_schema import TagOptions
from .backup import make_patch

FIELDS = ("key", "bpm", "comment", "grouping", "rating")
# Metadata fields for cleaning and mass editing (SPEC 2.10).
TEXT_FIELDS = ("title", "artist", "album", "genre", "year", "label")
_ID3_FRAMES = {
    "key": "TKEY",
    "bpm": "TBPM",
    "grouping": "TIT1",
    "title": "TIT2",
    "artist": "TPE1",
    "album": "TALB",
    "genre": "TCON",
    "year": "TDRC",
    "label": "TPUB",
}
SEPARATOR = " | "
_VARIABLE = re.compile(r"\{(\w+)\}")


class TagWriteError(RuntimeError):
    pass


@dataclass(frozen=True)
class TagValues:
    key: Key | None
    key_alt: Key | None
    bpm: float | None
    energy: int | None


@dataclass(frozen=True)
class FieldChange:
    field: str
    before: str | None
    after: str


class _Adapter(Protocol):
    supports_rating: bool

    def get(self, field: str) -> str | None: ...

    def set(self, field: str, value: str) -> None: ...

    def bpm_text(self, text: str) -> str: ...

    def save(self) -> None: ...


def _text(values: Any) -> str | None:
    if values is None:
        return None
    if isinstance(values, list | tuple):
        values = values[0] if values else None
    if isinstance(values, bytes):
        values = values.decode("utf-8", "replace")
    text = str(values).strip() if values is not None else ""
    return text or None


class _ID3Adapter:
    supports_rating = True

    def __init__(self, audio: Any) -> None:
        if audio.tags is None:
            audio.add_tags()
        self.audio = audio
        self.tags: ID3 = audio.tags

    def _comment(self) -> Any:  # mutagen COMM frame (untyped)
        plain = [c for c in self.tags.getall("COMM") if c.desc == ""]
        return plain[0] if plain else None

    def get(self, field: str) -> str | None:
        if field == "comment":
            c = self._comment()
            return _text(c.text) if c else None
        if field == "rating":
            popm = self.tags.getall("POPM")
            return str(round(popm[0].rating / 25.5)) if popm else None
        frame = self.tags.get(_ID3_FRAMES[field])
        return _text(frame.text) if frame is not None else None

    def set(self, field: str, value: str) -> None:
        if not value:
            if field == "comment":
                for c in [c for c in self.tags.getall("COMM") if c.desc == ""]:
                    self.tags.delall(c.HashKey)
            else:
                self.tags.delall("POPM" if field == "rating" else _ID3_FRAMES[field])
            return
        if field == "comment":
            c = self._comment()
            if c is not None:
                c.encoding, c.text = 3, [value]
            else:
                self.tags.add(COMM(encoding=3, lang="eng", desc="", text=[value]))
        elif field == "rating":
            self.tags.delall("POPM")
            self.tags.add(POPM(email="", rating=min(255, round(int(value) * 25.5)), count=0))
        else:
            frame = Frames[_ID3_FRAMES[field]]
            self.tags.setall(_ID3_FRAMES[field], [frame(encoding=3, text=[value])])

    def bpm_text(self, text: str) -> str:
        # ID3 defines TBPM as an integer; DJ software may ignore "124.00".
        return str(round(float(text)))

    def save(self) -> None:
        version = 3 if self.tags.version[1] == 3 else 4
        self.audio.save(v2_version=version)


class _MP4Adapter:
    supports_rating = False
    KEYS: ClassVar[dict[str, str]] = {
        "key": "----:com.apple.iTunes:initialkey",
        "comment": "\xa9cmt",
        "grouping": "\xa9grp",
        "title": "\xa9nam",
        "artist": "\xa9ART",
        "album": "\xa9alb",
        "genre": "\xa9gen",
        "year": "\xa9day",
        "label": "----:com.apple.iTunes:LABEL",
    }
    FREEFORM = frozenset({"key", "label"})

    def __init__(self, audio: MP4) -> None:
        if audio.tags is None:
            audio.add_tags()
        self.audio = audio
        self.tags: Any = audio.tags

    def get(self, field: str) -> str | None:
        if field == "bpm":
            tmpo = self.tags.get("tmpo")
            return str(tmpo[0]) if tmpo else None
        if field == "rating":
            return None
        return _text(self.tags.get(self.KEYS[field]))

    def set(self, field: str, value: str) -> None:
        if not value:
            self.tags.pop("tmpo" if field == "bpm" else self.KEYS[field], None)
        elif field == "bpm":
            self.tags["tmpo"] = [int(value)]
        elif field in self.FREEFORM:
            self.tags[self.KEYS[field]] = [MP4FreeForm(value.encode("utf-8"))]
        else:
            self.tags[self.KEYS[field]] = [value]

    def bpm_text(self, text: str) -> str:
        return str(round(float(text)))  # MP4 'tmpo' holds an integer

    def save(self) -> None:
        self.audio.save()


class _VorbisAdapter:
    supports_rating = True
    KEYS: ClassVar[dict[str, str]] = {
        "key": "INITIALKEY",
        "bpm": "BPM",
        "comment": "COMMENT",
        "grouping": "GROUPING",
        "rating": "RATING",
        "title": "TITLE",
        "artist": "ARTIST",
        "album": "ALBUM",
        "genre": "GENRE",
        "year": "DATE",
        "label": "LABEL",
    }

    def __init__(self, audio: Any) -> None:
        if audio.tags is None:
            audio.add_tags()
        self.audio = audio
        self.tags: Any = audio.tags

    def get(self, field: str) -> str | None:
        value = _text(self.tags.get(self.KEYS[field]))
        if field == "rating" and value is not None:
            try:
                return str(round(float(value) / 10))
            except ValueError:
                return value
        return value

    def set(self, field: str, value: str) -> None:
        if not value:
            if self.KEYS[field] in self.tags:
                del self.tags[self.KEYS[field]]
            return
        self.tags[self.KEYS[field]] = [str(int(value) * 10) if field == "rating" else value]

    def bpm_text(self, text: str) -> str:
        return text

    def save(self) -> None:
        self.audio.save()


def _open(path: Path) -> _Adapter:
    try:
        audio = mutagen.File(path)
    except Exception as exc:  # mutagen raises many unrelated exception types
        raise TagWriteError(f"cannot read tags of {path.name}: {exc}") from exc
    if audio is None:
        raise TagWriteError(f"unsupported file: {path.name}")
    if isinstance(audio, MP4):
        return _MP4Adapter(audio)
    name = type(audio).__name__
    if name in ("FLAC", "OggVorbis", "OggOpus"):
        return _VorbisAdapter(audio)
    if name in ("MP3", "WAVE", "AIFF") or isinstance(getattr(audio, "tags", None), ID3):
        return _ID3Adapter(audio)
    raise TagWriteError(f"writing tags to {name} files is not supported")


def render(template: str, variables: dict[str, str]) -> str:
    """Fill ``{name}`` placeholders; unknown ones stay as typed (no format injection)."""
    text = _VARIABLE.sub(lambda m: variables.get(m.group(1), m.group(0)), template)
    return re.sub(r"\s+", " ", text).strip()


def _desired(adapter: _Adapter, values: TagValues, options: TagOptions) -> dict[str, str]:
    notation = options.notation or "alphanumeric"
    decimals = 2 if options.bpm_decimals is None else options.bpm_decimals
    key = format_key(values.key, notation) if values.key else ""
    bpm = f"{round_bpm(values.bpm, decimals):.{decimals}f}" if values.bpm else ""
    out: dict[str, str] = {}
    if options.write_key and key:
        out["key"] = key
    if options.write_bpm and bpm:
        out["bpm"] = adapter.bpm_text(bpm)
    if options.write_comment and (key or bpm or values.energy):
        original = adapter.get("comment") or ""
        rendered = render(
            options.comment_template,
            {
                "key": key,
                "key_alt": format_key(values.key_alt, notation) if values.key_alt else "",
                "energy": str(values.energy) if values.energy else "",
                "bpm": bpm,
                "comment_original": original,
            },
        )
        if options.comment_position == "replace" or not original:
            out["comment"] = rendered
        elif rendered in original:
            out["comment"] = original  # already written: never stack copies
        elif options.comment_position == "before":
            out["comment"] = f"{rendered}{SEPARATOR}{original}"
        else:
            out["comment"] = f"{original}{SEPARATOR}{rendered}"
    if values.energy:
        if options.energy_in_grouping:
            out["grouping"] = str(values.energy)
        if options.energy_in_rating and adapter.supports_rating:
            out["rating"] = str(values.energy)
    return out


def plan_changes(path: Path, values: TagValues, options: TagOptions) -> list[FieldChange]:
    """What a write would change (the mandatory preview); the file is not modified."""
    adapter = _open(path)
    changes = []
    for field, after in _desired(adapter, values, options).items():
        before = adapter.get(field)
        if before != after:
            changes.append(FieldChange(field, before, after))
    return changes


def read_fields(path: Path, fields: tuple[str, ...]) -> dict[str, str | None]:
    adapter = _open(path)
    return {f: adapter.get(f) for f in fields}


def plan_fields(path: Path, desired: dict[str, str]) -> list[FieldChange]:
    """Changes to give the fields the ``desired`` values ("" removes a field)."""
    adapter = _open(path)
    changes = []
    for field, after in desired.items():
        before = adapter.get(field)
        if (before or "") != after:
            changes.append(FieldChange(field, before, after))
    return changes


@dataclass
class PreparedWrite:
    """A verified copy waiting to replace the original (call ``commit`` or ``discard``)."""

    path: Path
    tmp: Path
    patch: bytes
    changes: list[FieldChange]

    def commit(self) -> None:
        self.tmp.replace(self.path)

    def discard(self) -> None:
        self.tmp.unlink(missing_ok=True)


def prepare_mutation(
    path: Path,
    mutate: Callable[[Path], None],
    verify: Callable[[Path], bool],
    changes: list[FieldChange],
) -> PreparedWrite:
    """Apply ``mutate`` to an exclusive copy of ``path``, check it with ``verify`` and
    keep the patch that restores the original; the caller commits or discards it."""
    original = path.read_bytes()
    # Exclusive, randomly named copy (never follows a planted link); the extension is
    # kept because mutagen also uses it to recognise the format.
    fd, tmp = temp_beside(path, suffix=f".tonalia-tmp{path.suffix}")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(original)
        shutil.copymode(path, tmp)
        mutate(tmp)
        if not verify(tmp):
            raise TagWriteError("verification failed after writing")
        with tmp.open("rb+") as f:
            os.fsync(f.fileno())
        patch = make_patch(original, tmp.read_bytes())
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise
    return PreparedWrite(path, tmp, patch, changes)


def prepare_write(path: Path, changes: list[FieldChange]) -> PreparedWrite | None:
    if not changes:
        return None

    def mutate(tmp: Path) -> None:
        adapter = _open(tmp)
        for change in changes:
            adapter.set(change.field, change.after)
        adapter.save()

    def verify(tmp: Path) -> bool:
        check = _open(tmp)
        wrong = [c.field for c in changes if (check.get(c.field) or "") != c.after]
        if wrong:
            raise TagWriteError(f"verification failed for {', '.join(wrong)}")
        return True

    return prepare_mutation(path, mutate, verify, changes)


def write_tags(path: Path, changes: list[FieldChange]) -> PreparedWrite | None:
    """Prepare and commit in one step (tests, tools); returns None when nothing changes."""
    prepared = prepare_write(path, changes)
    if prepared is not None:
        prepared.commit()
    return prepared
