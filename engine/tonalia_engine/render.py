"""Processed audio for previews, the Pro decks and exports (SPEC 2.15 and 2.16).

A render is a segment of a track (or of one of its stems) with pitch shift and time
stretch applied by the bundled Rubber Band CLI in its high-quality (R3) engine. Results
are cached as 24-bit stereo WAV at 44.1 kHz in ``<data>/cache/render/<hash>.wav``, keyed by
a hash of the source and the parameters, so asking twice costs nothing.

Alignment: the whole source is decoded (the same timeline the analysis used), the segment
is cut with a pre-roll so the stretcher has settled by the first wanted sample, and the
first downbeat inside the segment is reported in samples of the rendered file. Rubber
Band's offline mode maps time linearly, so downbeat ``t`` of the original lands at
``(t - start) * time_ratio`` in the render.
"""

from __future__ import annotations

import contextlib
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import cast, get_args

import numpy as np

from .analysis.structure import downbeats
from .analysis.tempo import BeatGrid
from .audio_io import (
    _NO_WINDOW,
    _REPO_BINARIES,
    ANALYSIS_SAMPLE_RATE,
    AudioArray,
    _target_triple,
    decode,
    ffmpeg_path,
)
from .db import Database
from .jobs import JobCancelled
from .rpc_schema import RenderResult, RenderSpec, StemModel

SAMPLE_RATE = ANALYSIS_SAMPLE_RATE
RENDER_VERSION = 1  # bump when the processing changes, so old cache entries are not reused
PRE_ROLL = 0.5  # seconds decoded around the segment so the stretcher has context
MIN_RATIO, MAX_RATIO = 0.5, 2.0  # time ratios outside this are not musical
MAX_CACHE_BYTES = 4 * 1024**3


class RenderError(ValueError):
    """The render cannot be made with these parameters (reported as invalid params)."""


def rubberband_path() -> str:
    """``TONALIA_RUBBERBAND`` (set by the Rust core), the repo's binaries (dev), then PATH."""
    if env := os.environ.get("TONALIA_RUBBERBAND"):
        return env
    ext = ".exe" if sys.platform == "win32" else ""
    dev = _REPO_BINARIES / f"rubberband-{_target_triple()}{ext}"
    if dev.is_file():
        return str(dev)
    found = shutil.which("rubberband")
    if found:
        return found
    raise RenderError(
        "Rubber Band not found (set TONALIA_RUBBERBAND or run scripts/fetch-binaries)"
    )


def cache_dir(data_dir: Path) -> Path:
    return data_dir / "cache" / "render"


def time_ratio(track_bpm: float | None, target_bpm: float | None) -> float:
    """Rendered duration / original duration to play ``track_bpm`` at ``target_bpm``."""
    if target_bpm is None or (track_bpm is not None and abs(track_bpm - target_bpm) < 1e-9):
        return 1.0
    if not track_bpm:
        raise RenderError("the track has no tempo yet: analyse it before changing its tempo")
    ratio = track_bpm / target_bpm
    if not MIN_RATIO <= ratio <= MAX_RATIO:
        raise RenderError(f"{track_bpm:g} → {target_bpm:g} BPM is out of range (half to double)")
    return ratio


def first_downbeat(
    grid: BeatGrid | None, track_duration: float, start: float, ratio: float, sr: int
) -> int | None:
    """First downbeat at or after ``start``, in samples of the rendered audio."""
    if grid is None:
        return None
    times = downbeats(grid, track_duration)
    after = times[times >= start - 5e-4]
    if after.size == 0:
        return None
    return max(0, round((float(after[0]) - start) * ratio * sr))


def cache_key(
    *, source: str, start: float, duration: float | None, semitones: float, ratio: float
) -> str:
    payload = json.dumps(
        {
            "v": RENDER_VERSION,
            "source": source,
            "start": round(start, 4),
            "duration": None if duration is None else round(duration, 4),
            "semitones": round(semitones, 4),
            "ratio": round(ratio, 6),
        },
        sort_keys=True,
    )
    return hashlib.sha256(payload.encode()).hexdigest()[:32]


def prune_cache(
    directory: Path, max_bytes: int = MAX_CACHE_BYTES, keep: Path | None = None
) -> None:
    """Delete the least recently used renders until the cache fits in ``max_bytes``."""
    entries: list[tuple[float, int, Path]] = []
    for path in directory.glob("*.wav"):
        with contextlib.suppress(OSError):
            st = path.stat()
            entries.append((st.st_mtime, st.st_size, path))
    total = sum(size for _, size, _ in entries)
    for _, size, path in sorted(entries):
        if total <= max_bytes:
            break
        if keep is not None and path == keep:
            continue
        with contextlib.suppress(OSError):
            path.unlink()
            total -= size


# ---- audio files ----


def _ffmpeg_write(audio: AudioArray, path: Path, codec: list[str]) -> None:
    cmd = [
        ffmpeg_path(),
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-f",
        "f32le",
        "-ar",
        str(SAMPLE_RATE),
        "-ac",
        str(audio.shape[1]),
        "-i",
        "pipe:0",
        *codec,
        f"file:{path}",
    ]
    data = np.ascontiguousarray(audio, dtype="<f4").tobytes()
    proc = subprocess.run(
        cmd, input=data, capture_output=True, check=False, creationflags=_NO_WINDOW
    )
    if proc.returncode != 0:
        reason = proc.stderr.decode("utf-8", "replace").strip().splitlines()
        raise RenderError(f"cannot write {path.name}: {reason[-1] if reason else proc.returncode}")


def write_wav(audio: AudioArray, path: Path) -> None:
    """Write (n, 2) float audio as 24-bit WAV, atomically."""
    tmp = path.with_name(f".{path.stem}-{uuid.uuid4().hex[:8]}.tmp")
    try:
        _ffmpeg_write(np.clip(audio, -1.0, 1.0), tmp, ["-c:a", "pcm_s24le", "-f", "wav"])
        tmp.replace(path)
    finally:
        tmp.unlink(missing_ok=True)


def stretch(
    audio: AudioArray,
    semitones: float,
    ratio: float,
    check_cancelled: Callable[[], None],
    *,
    tmp_dir: Path | None = None,
) -> AudioArray:
    """Pitch-shift and time-stretch with Rubber Band R3 (offline, high quality)."""
    work = Path(tempfile.mkdtemp(prefix="tonalia-render-", dir=tmp_dir))
    try:
        src, dst = work / "in.wav", work / "out.wav"
        _ffmpeg_write(audio, src, ["-c:a", "pcm_f32le", "-f", "wav"])
        check_cancelled()
        cmd = [rubberband_path(), "-3", "-q", "-t", f"{ratio:.9f}", "-p", f"{semitones:.6f}"]
        cmd += [str(src), str(dst)]
        try:
            proc = subprocess.Popen(
                cmd,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
                creationflags=_NO_WINDOW,
            )
        except OSError as exc:
            raise RenderError(f"could not run Rubber Band: {exc}") from exc
        try:
            while proc.poll() is None:
                check_cancelled()
                time.sleep(0.05)
        except BaseException:
            proc.kill()
            proc.wait()
            raise
        stderr = proc.stderr.read().decode("utf-8", "replace") if proc.stderr else ""
        if proc.stderr:
            proc.stderr.close()
        if proc.returncode != 0:
            lines = stderr.strip().splitlines()
            raise RenderError(f"Rubber Band failed: {lines[-1] if lines else proc.returncode}")
        return decode(dst, channels=2)
    finally:
        shutil.rmtree(work, ignore_errors=True)


# ---- the service ----


def _never_cancelled() -> None:
    return None


def _no_progress(percent: float) -> None:
    return None


@dataclass(frozen=True)
class RenderPlan:
    source_path: Path
    source_id: str  # what the cache key hashes for the source audio
    track_duration: float | None
    track_bpm: float | None
    grid: BeatGrid | None
    start: float
    duration: float | None
    semitones: float
    ratio: float
    path: Path  # cache file

    @property
    def processed(self) -> bool:
        return abs(self.semitones) > 1e-6 or abs(self.ratio - 1.0) > 1e-9


class RenderService:
    def __init__(self, db: Database, data_dir: Path) -> None:
        self.db = db
        self.data_dir = data_dir

    @property
    def cache_dir(self) -> Path:
        return cache_dir(self.data_dir)

    def plan(self, spec: RenderSpec, default_model: StemModel) -> RenderPlan:
        """Resolve the source and parameters; raises RenderError for impossible renders."""
        row = self.db.conn.execute(
            "SELECT t.path, t.file_hash, t.duration, a.bpm, a.beat_grid FROM tracks t"
            " LEFT JOIN analysis a ON a.track_id = t.id WHERE t.id = ?",
            (spec.track_id,),
        ).fetchone()
        if row is None:
            raise RenderError(f"unknown track {spec.track_id}")
        duration = cast("float | None", row["duration"])
        if duration is not None and spec.start >= duration:
            raise RenderError(f"start {spec.start:g} s is beyond the end of the track")
        if spec.source == "mix":
            source_path = Path(row["path"])
            source_id = f"mix:{row['file_hash'] or source_path}"
        else:
            source_path, source_id = self._stem_source(spec, row["file_hash"], default_model)
        bpm = cast("float | None", row["bpm"])
        ratio = time_ratio(bpm, spec.target_bpm)
        grid = BeatGrid(**json.loads(row["beat_grid"])) if row["beat_grid"] else None
        key = cache_key(
            source=source_id,
            start=spec.start,
            duration=spec.duration,
            semitones=spec.semitones,
            ratio=ratio,
        )
        return RenderPlan(
            source_path=source_path,
            source_id=source_id,
            track_duration=duration,
            track_bpm=bpm,
            grid=grid,
            start=spec.start,
            duration=spec.duration,
            semitones=spec.semitones,
            ratio=ratio,
            path=self.cache_dir / f"{key}.wav",
        )

    def _stem_source(
        self, spec: RenderSpec, file_hash: str | None, default_model: StemModel
    ) -> tuple[Path, str]:
        # Without an explicit model, the default model's stems or, failing that, any
        # model's (stems separated before the default changed stay usable).
        models = (
            [spec.model]
            if spec.model
            else [default_model, *(m for m in get_args(StemModel) if m != default_model)]
        )
        for model in models:
            row = self.db.conn.execute(
                f"SELECT {spec.source}_path AS path, source_hash FROM stems"
                " WHERE track_id = ? AND model = ?",
                (spec.track_id, model),
            ).fetchone()
            if row is None or row["source_hash"] != file_hash or not row["path"]:
                continue
            path = Path(row["path"])
            try:
                st = path.stat()
            except OSError:
                continue
            return path, f"{spec.source}:{model}:{path}:{st.st_size}:{st.st_mtime_ns}"
        raise RenderError("the stems of this track are not separated yet")

    def cached(self, plan: RenderPlan) -> RenderResult | None:
        if not plan.path.is_file():
            return None
        with contextlib.suppress(OSError):
            os.utime(plan.path)  # least recently used order for pruning
        frames = _wav_frames(plan.path)
        if frames is None:
            return None
        return self._result(plan, frames, cached=True)

    def render(
        self,
        plan: RenderPlan,
        check_cancelled: Callable[[], None] = _never_cancelled,
        progress: Callable[[float], None] = _no_progress,
    ) -> RenderResult:
        audio = self.audio(plan, check_cancelled, progress)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        write_wav(audio, plan.path)
        progress(100.0)
        prune_cache(self.cache_dir, keep=plan.path)
        return self._result(plan, audio.shape[0], cached=False)

    def audio(
        self,
        plan: RenderPlan,
        check_cancelled: Callable[[], None] = lambda: None,
        progress: Callable[[float], None] = lambda p: None,
    ) -> AudioArray:
        """The rendered samples, (n, 2) float32 (also used by the stems export)."""
        source = decode(plan.source_path, channels=2)
        check_cancelled()
        progress(15.0)
        total = source.shape[0]
        begin = min(total, round(plan.start * SAMPLE_RATE))
        end = (
            total
            if plan.duration is None
            else min(total, begin + round(plan.duration * SAMPLE_RATE))
        )
        if begin >= end:
            raise RenderError(f"start {plan.start:g} s is beyond the end of the track")
        if not plan.processed:
            return np.ascontiguousarray(source[begin:end])
        pad = round(PRE_ROLL * SAMPLE_RATE)
        lo, hi = max(0, begin - pad), min(total, end + pad)
        stretched = stretch(source[lo:hi], plan.semitones, plan.ratio, check_cancelled)
        progress(90.0)
        cut = round((begin - lo) * plan.ratio)
        length = round((end - begin) * plan.ratio)
        out = stretched[cut : cut + length]
        if out.shape[0] < length:  # the stretcher may come up a few samples short
            out = np.concatenate([out, np.zeros((length - out.shape[0], 2), dtype=np.float32)])
        return np.ascontiguousarray(out)

    def _result(self, plan: RenderPlan, frames: int, *, cached: bool) -> RenderResult:
        track_duration = plan.track_duration or (plan.start + frames / plan.ratio / SAMPLE_RATE)
        downbeat = first_downbeat(plan.grid, track_duration, plan.start, plan.ratio, SAMPLE_RATE)
        return RenderResult(
            path=str(plan.path),
            sample_rate=SAMPLE_RATE,
            frames=frames,
            duration=frames / SAMPLE_RATE,
            bpm=None if plan.track_bpm is None else plan.track_bpm / plan.ratio,
            time_ratio=plan.ratio,
            first_downbeat=downbeat if downbeat is not None and downbeat < frames else None,
            cached=cached,
        )


def _wav_frames(path: Path) -> int | None:
    """Frame count of a cached 24-bit stereo WAV written by :func:`write_wav`."""
    try:
        with path.open("rb") as f:
            header = f.read(4096)
    except OSError:
        return None
    pos = header.find(b"data")
    if header[:4] != b"RIFF" or pos < 0:
        return None
    size = int.from_bytes(header[pos + 4 : pos + 8], "little")
    if size in (0, 0xFFFFFFFF):  # streamed header: fall back to the file size
        size = path.stat().st_size - (pos + 8)
    return size // (3 * 2)


__all__ = ["JobCancelled", "RenderError", "RenderService"]
