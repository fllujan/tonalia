"""Export stems or whole tracks for a DAW (SPEC 2.16).

Each item is rendered through :mod:`render` (original or with pitch shift and tempo) and
converted losslessly from the 24-bit render to WAV, AIFF or FLAC 24-bit. File names come
from a template (``{artist} - {title} ({stem}) [{key} {bpm}]``) with the key and BPM after
the shift; names are made portable (Windows and macOS) and an existing file is never
overwritten: the new one gets " (2)", " (3)"… Files are written to a temporary name in the
destination folder and only then moved into place.
"""

from __future__ import annotations

import contextlib
import logging
import os
import re
import shutil
import subprocess
import unicodedata
import uuid
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from pathlib import Path

from .audio_io import _NO_WINDOW, DecodeError, ffmpeg_local_input, ffmpeg_path
from .db import Database
from .jobs import JobContext
from .keys import Key, format_key, shift
from .render import RenderError, RenderService
from .rpc_schema import (
    Notation,
    RenderSource,
    RenderSpec,
    StemExportFailure,
    StemExportFile,
    StemExportFormat,
    StemExportItem,
    StemExportNames,
    StemExportResult,
    StemModel,
)

log = logging.getLogger(__name__)

DEFAULT_LABELS: dict[RenderSource, str] = {
    "mix": "Track",
    "vocals": "Vocals",
    "drums": "Drums",
    "bass": "Bass",
    "other": "Other",
    "instrumental": "Instrumental",
}
EXTENSIONS: dict[str, str] = {"wav": ".wav", "aiff": ".aiff", "flac": ".flac"}
CODECS: dict[str, list[str]] = {
    "wav": ["-c:a", "pcm_s24le", "-f", "wav"],
    "aiff": ["-c:a", "pcm_s24be", "-f", "aiff"],
    "flac": ["-c:a", "flac", "-sample_fmt", "s32", "-bits_per_raw_sample", "24", "-f", "flac"],
}
MAX_NAME_BYTES = 200  # leaves room for " (n)" and the extension under the 255-byte limit

_RESERVED = re.compile(r"^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$", re.IGNORECASE)
_SLASHES = re.compile(r"[/\\:]")
_FORBIDDEN = re.compile(r'[<>"|?*]')
_CONTROL = re.compile(r"[\x00-\x1f\x7f]")
_TOKEN = re.compile(r"\{(\w+)\}")


class ExportError(ValueError):
    """The export cannot start (reported as invalid params)."""


def sanitize(name: str) -> str:
    """A file name (without extension) valid on Windows and macOS."""
    text = unicodedata.normalize("NFC", name)
    text = _CONTROL.sub(" ", text)
    text = _SLASHES.sub("-", text)
    text = _FORBIDDEN.sub("", text)
    text = re.sub(r"\s+", " ", text).strip(" .")
    encoded = text.encode()
    if len(encoded) > MAX_NAME_BYTES:
        text = encoded[:MAX_NAME_BYTES].decode("utf-8", "ignore").rstrip(" .")
    if not text:
        return "untitled"
    return f"_{text}" if _RESERVED.match(text) else text


def format_bpm(bpm: float | None, decimals: int) -> str:
    if bpm is None:
        return ""
    return f"{bpm:.{decimals}f}".rstrip("0").rstrip(".") if decimals else f"{bpm:.0f}"


def file_name(template: str, values: Mapping[str, str]) -> str:
    """Fill ``template``; unknown ``{tokens}`` stay as written, empty parts disappear."""
    text = _TOKEN.sub(lambda m: values.get(m.group(1), m.group(0)), template)
    text = re.sub(r"\s+", " ", text)
    previous = None
    while previous != text:
        previous = text
        text = re.sub(r"\(\s*\)|\[\s*\]|\{\s*\}", "", text)  # empty brackets
        text = re.sub(r"([(\[])\s+", r"\1", text)
        text = re.sub(r"\s+([)\]])", r"\1", text)
        # Dangling separators (hyphen, en dash, middle dot, underscore, comma).
        text = re.sub(r"^\s*[-\u2013\u00b7_,]\s*|\s*[-\u2013\u00b7_,]\s*$", "", text)
        text = re.sub(r"\s+[-\u2013\u00b7_,]\s+(?=[-\u2013\u00b7_,(\[]|$)", " ", text)
        text = re.sub(r"\s+", " ", text).strip()
    return sanitize(text)


def unique_path(folder: Path, stem: str, ext: str, taken: set[Path]) -> Path:
    """``folder/stem+ext``, or ``stem (n)+ext`` if that exists or was already chosen."""
    lowered = {str(p).casefold() for p in taken}
    n = 1
    while True:
        name = f"{stem}{ext}" if n == 1 else f"{stem} ({n}){ext}"
        path = folder / name
        if not path.exists() and str(path).casefold() not in lowered:
            return path
        n += 1


@dataclass(frozen=True)
class _TrackInfo:
    title: str
    artist: str
    key: Key | None
    bpm: float | None


class StemExporter:
    def __init__(
        self,
        db: Database,
        data_dir: Path,
        *,
        notation: Notation,
        bpm_decimals: int,
        default_model: StemModel,
    ) -> None:
        self.db = db
        self.render = RenderService(db, data_dir)
        self.notation = notation
        self.bpm_decimals = bpm_decimals
        self.default_model = default_model

    def _track(self, track_id: int) -> _TrackInfo | None:
        row = self.db.conn.execute(
            "SELECT COALESCE(t.title, t.display_title) AS title, t.artist, t.path,"
            " a.key_root, a.key_mode, a.bpm FROM tracks t"
            " LEFT JOIN analysis a ON a.track_id = t.id WHERE t.id = ?",
            (track_id,),
        ).fetchone()
        if row is None:
            return None
        key = None if row["key_root"] is None else Key(row["key_root"], row["key_mode"])
        return _TrackInfo(
            title=row["title"] or Path(row["path"]).stem,
            artist=row["artist"] or "",
            key=key,
            bpm=row["bpm"],
        )

    def name_for(
        self, item: StemExportItem, template: str, labels: Mapping[RenderSource, str]
    ) -> str:
        info = self._track(item.track_id)
        if info is None:
            return sanitize(f"track {item.track_id}")
        key = None if info.key is None else shift(info.key, round(item.semitones))
        bpm = item.target_bpm if item.target_bpm is not None else info.bpm
        values = {
            "artist": info.artist,
            "title": info.title,
            "stem": labels.get(item.source) or DEFAULT_LABELS[item.source],
            "key": "" if key is None else format_key(key, self.notation),
            "bpm": format_bpm(bpm, self.bpm_decimals),
        }
        return file_name(template, values)

    def names(
        self,
        items: list[StemExportItem],
        folder: Path,
        fmt: StemExportFormat,
        template: str,
        labels: Mapping[RenderSource, str],
    ) -> StemExportNames:
        taken: set[Path] = set()
        names: list[str] = []
        for item in items:
            path = unique_path(
                folder, self.name_for(item, template, labels), EXTENSIONS[fmt], taken
            )
            taken.add(path)
            names.append(path.name)
        return StemExportNames(folder=str(folder), names=names)

    def export(
        self,
        items: list[StemExportItem],
        folder: Path,
        fmt: StemExportFormat,
        template: str,
        labels: Mapping[RenderSource, str],
        job: JobContext,
    ) -> StemExportResult:
        folder.mkdir(parents=True, exist_ok=True)
        result = StemExportResult(folder=str(folder), files=[], failed=[])
        taken: set[Path] = set()
        for i, item in enumerate(items):
            job.check_cancelled()

            def report(percent: float, i: int = i, item: StemExportItem = item) -> None:
                job.progress(
                    "export",
                    100.0 * (i + percent / 100.0) / len(items),
                    track_id=item.track_id,
                    done=i,
                    total=len(items),
                )

            report(0.0)
            try:
                rendered = self._render(item, job, report)
                stem = self.name_for(item, template, labels)
                path = unique_path(folder, stem, EXTENSIONS[fmt], taken)
                taken.add(path)
                _convert(rendered, path, fmt)
                result.files.append(
                    StemExportFile(track_id=item.track_id, source=item.source, path=str(path))
                )
            except (RenderError, DecodeError, ExportError, OSError) as exc:
                log.warning("stem export failed for %s/%s: %s", item.track_id, item.source, exc)
                result.failed.append(
                    StemExportFailure(track_id=item.track_id, source=item.source, error=str(exc))
                )
        job.progress("export", 100.0, done=len(items), total=len(items), force=True)
        return result

    def _render(
        self, item: StemExportItem, job: JobContext, report: Callable[[float], None]
    ) -> Path:
        spec = RenderSpec(
            track_id=item.track_id,
            source=item.source,
            semitones=item.semitones,
            target_bpm=item.target_bpm,
        )
        plan = self.render.plan(spec, self.default_model)
        hit = self.render.cached(plan)
        if hit is None:
            # The render reports 0-100 for this item; keep 5 % for the conversion.
            hit = self.render.render(plan, job.check_cancelled, lambda p: report(0.95 * p))
        return Path(hit.path)


def _convert(source: Path, path: Path, fmt: StemExportFormat) -> None:
    """Lossless 24-bit conversion of a render into ``path``, never replacing a file."""
    tmp = path.with_name(f".{path.stem}-{uuid.uuid4().hex[:8]}.part")
    try:
        if fmt == "wav":
            shutil.copyfile(source, tmp)  # renders are already 24-bit WAV at 44.1 kHz
        else:
            cmd = [ffmpeg_path(), "-nostdin", "-hide_banner", "-loglevel", "error", "-y"]
            cmd += ffmpeg_local_input(source)
            cmd += [*CODECS[fmt], f"file:{tmp}"]
            proc = subprocess.run(cmd, capture_output=True, check=False, creationflags=_NO_WINDOW)
            if proc.returncode != 0:
                lines = proc.stderr.decode("utf-8", "replace").strip().splitlines()
                raise ExportError(
                    f"cannot write {path.name}: {lines[-1] if lines else proc.returncode}"
                )
        _move_no_replace(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)


def _move_no_replace(tmp: Path, path: Path) -> None:
    try:
        os.link(tmp, path)  # fails if ``path`` appeared meanwhile: never overwrite
    except FileExistsError:
        raise ExportError(f"{path.name} already exists") from None
    except OSError:
        # File systems without hard links (FAT/exFAT drives): check, then rename.
        if path.exists():
            raise ExportError(f"{path.name} already exists") from None
        tmp.replace(path)
        return
    with contextlib.suppress(OSError):
        tmp.unlink()


__all__ = ["DEFAULT_LABELS", "ExportError", "RenderSource", "StemExporter"]
