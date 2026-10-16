"""Render a set to one continuous audio file (SPEC 14.2).

The set is laid on one output timeline, beat by beat:

- each transition comes from the mix points (SPEC 14.1): A plays until the end of the
  overlap and B comes in at its point, both on their beats;
- tempo ``native``: every track plays at its own BPM, and during a transition the tempo
  ramps from A's to B's one beat at a time, the same ramp for both tracks, so their beats
  coincide on every beat of the overlap; tempo ``fixed``: every beat of every track lands
  on the grid of one BPM;
- each track is rendered with Rubber Band (R3) through a time map: its beats are key
  frames that land on their output times (and its key shift, if the set has one);
- equal-power crossfade over the overlap (a cut ramps over 10 ms), with an optional bass
  swap: B comes in without its lows, and halfway through the lows swap from A to B;
- gain only: each track at its ReplayGain (13.6), then the whole file to the target
  loudness (-14 LUFS by default). No compressor or limiter: a stretch of the set (one
  track, between the middles of its transitions) whose true peak would pass -1 dBTP gets
  less gain instead.

Every track's render is cached by its source and its key frames, so changing one
transition only renders again the two tracks it joins. The mix is assembled in a memory
mapped file and streamed to FFmpeg, so a two-hour set does not need gigabytes of memory.
Next to the file go a track list with times (``.txt``) and a ``.cue`` sheet; FLAC and MP3
can also carry chapters.
"""

from __future__ import annotations

import contextlib
import hashlib
import json
import math
import os
import shutil
import subprocess
import tempfile
import time
import uuid
from collections.abc import Callable, Iterator, Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from functools import cache
from pathlib import Path

import numpy as np
import numpy.typing as npt
import pyloudnorm
from scipy.signal import butter, lfilter, lfilter_zi, sosfiltfilt

from .analysis.quality import true_peak
from .analysis.structure import downbeats
from .analysis.tempo import BeatGrid
from .audio_io import _NO_WINDOW, ANALYSIS_SAMPLE_RATE, decode, ffmpeg_path
from .db import Database
from .errors import TonaliaError
from .grid import beat_times
from .jobs import JobCancelled, JobContext
from .mix_points import TrackMix, plan, sections, style_setting
from .render import _ffmpeg_write, prune_cache, rubberband_path, write_wav
from .rpc_schema import (
    MixPoints,
    RenderSetParams,
    RenderSetResult,
    RenderSetTrack,
)

SR = ANALYSIS_SAMPLE_RATE
RENDER_SET_VERSION = 1
PAD = 0.5  # seconds of context around each track's part, for the stretcher
CUT_FADE = 0.01
MAX_PEAK_DBTP = -1.0
GAIN_RAMP = 1.0  # seconds over which the gain moves from one stretch to the next
BASS_HZ = 200.0
MIN_RATIO, MAX_RATIO = 0.5, 2.0
CHUNK = SR * 10
MAX_CACHE_BYTES = 6 * 1024**3
FloatArray = npt.NDArray[np.float64]
Audio = npt.NDArray[np.float32]


class RenderSetError(TonaliaError, ValueError):
    reason = "not_analysed"


@cache
def mp3_available() -> bool:
    """Whether the bundled FFmpeg has the LAME encoder (LGPL, compatible with AGPL)."""
    try:
        out = subprocess.run(
            [ffmpeg_path(), "-hide_banner", "-encoders"],
            capture_output=True,
            text=True,
            check=False,
            timeout=20,
            creationflags=_NO_WINDOW,
        ).stdout
    except (OSError, subprocess.SubprocessError):
        return False
    return "libmp3lame" in out


def formats() -> list[str]:
    return ["wav", "flac", *(["mp3"] if mp3_available() else [])]


# ---- the tracks ----


@dataclass
class _Track:
    id: int
    path: Path
    source_id: str
    title: str
    artist: str | None
    duration: float
    grid: BeatGrid
    beats: FloatArray
    gain_db: float  # ReplayGain to -18 LUFS (0 when unknown or not asked)
    shift: int
    mix: TrackMix
    keys: list[tuple[float, float]] = field(default_factory=list)  # (source s, output s)


def _load(db: Database, p: RenderSetParams) -> list[_Track]:
    items = [(i.track_id, i.shift) for i in p.items]
    if p.playlist_id is not None:
        rows = db.conn.execute(
            "SELECT track_id FROM playlist_tracks WHERE playlist_id = ? ORDER BY position",
            (p.playlist_id,),
        ).fetchall()
        items = [(int(r[0]), 0) for r in rows]
    if len(items) < 1:
        raise RenderSetError("the set is empty", reason="invalid_set")
    out = []
    for track_id, shift in items:
        row = db.conn.execute(
            "SELECT t.path, t.file_hash, t.title, t.display_title, t.artist, t.duration,"
            " a.beat_grid, a.replaygain_db FROM tracks t LEFT JOIN analysis a"
            " ON a.track_id = t.id WHERE t.id = ?",
            (track_id,),
        ).fetchone()
        if row is None:
            raise RenderSetError(f"unknown track {track_id}", reason="track_not_found")
        title = row["title"] or row["display_title"] or Path(row["path"]).stem
        if not row["beat_grid"] or not row["duration"]:
            raise RenderSetError(
                f"{title} is not analysed yet (it needs a beatgrid)",
                reason="not_analysed",
                name=title,
            )
        grid = BeatGrid(**json.loads(row["beat_grid"]))
        duration = float(row["duration"])
        segments = db.conn.execute(
            "SELECT label, start_sec, end_sec FROM segments WHERE track_id = ? ORDER BY start_sec",
            (track_id,),
        ).fetchall()
        gain = row["replaygain_db"] if p.normalize and row["replaygain_db"] is not None else 0.0
        out.append(
            _Track(
                id=track_id,
                path=Path(row["path"]),
                source_id=f"{row['file_hash'] or row['path']}",
                title=title,
                artist=row["artist"],
                duration=duration,
                grid=grid,
                beats=beat_times(grid, duration),
                gain_db=float(gain),
                shift=shift if p.apply_shifts else 0,
                mix=TrackMix(grid, duration, sections(grid, duration, segments)),
            )
        )
    return out


# ---- the timeline ----


@dataclass(frozen=True)
class _Transition:
    points: MixPoints
    start: float  # output seconds where B comes in
    end: float  # output seconds where A is gone
    beats: int
    out_beats: FloatArray  # output time of each beat of the overlap (beats + 1)


def _nearest(beats: FloatArray, t: float) -> int:
    return int(np.argmin(np.abs(beats - t))) if beats.size else 0


def _local_bpm(track: _Track, at: float) -> float:
    i = _nearest(track.beats, at)
    span = track.beats[max(0, i - 4) : i + 5]
    if span.size < 2:
        return track.grid.bpm
    return 60.0 / float(np.median(np.diff(span)))


def _check_ratio(track: _Track, bpm: float) -> None:
    ratio = track.grid.bpm / bpm
    if not MIN_RATIO <= ratio <= MAX_RATIO:
        raise RenderSetError(
            f"{track.title}: {track.grid.bpm:g} → {bpm:g} BPM is out of range (half to double)",
            reason="bpm_out_of_range",
            name=track.title,
        )


def layout(
    tracks: list[_Track],
    *,
    style: str,
    overlap: int,
    tempo: str,
    fixed_bpm: float | None,
) -> tuple[list[_Transition], float]:
    """Fill each track's key frames; returns the transitions and the set's length."""
    fixed = fixed_bpm or tracks[0].grid.bpm
    if tempo == "fixed":
        for t in tracks:
            _check_ratio(t, fixed)
    transitions: list[_Transition] = []
    first = tracks[0]
    start = float(downbeats(first.grid, first.duration)[0]) if first.beats.size else 0.0
    first.keys = [(start, 0.0)]
    for i, a in enumerate(tracks):
        src, out = a.keys[-1]
        nxt = tracks[i + 1] if i + 1 < len(tracks) else None
        until = a.duration
        pts = None
        if nxt is not None:
            pts = plan(a.mix, nxt.mix, style, overlap)  # type: ignore[arg-type]
            until = max(src, pts.a_start)
        # The body: native speed, or every beat on the fixed grid.
        if tempo == "fixed":
            beat_out = 60.0 / fixed
            first_beat, last_beat = _nearest(a.beats, src), _nearest(a.beats, until)
            for k in range(first_beat + 1, last_beat + 1):
                a.keys.append((float(a.beats[k]), out + (k - first_beat) * beat_out))
        elif until > src:
            a.keys.append((until, out + (until - src)))
        src, out = a.keys[-1]
        if nxt is None or pts is None:
            # The last track plays to its end.
            slope = (60.0 / fixed) / (60.0 / _local_bpm(a, src)) if tempo == "fixed" else 1.0
            a.keys.append((a.duration, out + (a.duration - src) * slope))
            break
        ia, ib = _nearest(a.beats, pts.a_start), _nearest(nxt.beats, pts.b_start)
        n = min(pts.overlap_bars * 4, a.beats.size - 1 - ia, nxt.beats.size - 1 - ib)
        n = max(0, n)
        bpm_a = fixed if tempo == "fixed" else _local_bpm(a, pts.a_start)
        bpm_b = fixed if tempo == "fixed" else _local_bpm(nxt, pts.b_start)
        steps = 60.0 / (bpm_a + (bpm_b - bpm_a) * (np.arange(n) + 0.5) / max(n, 1))
        out_beats = out + np.concatenate([[0.0], np.cumsum(steps)])
        for k in range(1, n + 1):
            a.keys.append((float(a.beats[ia + k]), float(out_beats[k])))
        nxt.keys = [(float(nxt.beats[ib + k]), float(out_beats[k])) for k in range(n + 1)]
        transitions.append(
            _Transition(pts, out, float(out_beats[-1]), n, out_beats.astype(np.float64))
        )
    last = tracks[-1]
    return transitions, last.keys[-1][1]


# ---- rendering one track ----


def _cache_key(track: _Track, lo: float, hi: float, keys: Sequence[tuple[float, float]]) -> str:
    payload = json.dumps(
        {
            "v": RENDER_SET_VERSION,
            "source": track.source_id,
            "lo": round(lo, 4),
            "hi": round(hi, 4),
            "keys": [[round(s, 4), round(o, 4)] for s, o in keys],
            "shift": track.shift,
        }
    )
    return hashlib.sha256(payload.encode()).hexdigest()[:32]


def _slope(a: tuple[float, float], b: tuple[float, float]) -> float:
    return (b[1] - a[1]) / (b[0] - a[0]) if b[0] > a[0] else 1.0


def _render_track(
    track: _Track, cache: Path, check: Callable[[], None]
) -> tuple[Audio, float, bool]:
    """The track's part on the output timeline: samples from its first key frame to its
    last, and whether it came from the cache."""
    keys = [k for i, k in enumerate(track.keys) if i == 0 or k[0] > track.keys[i - 1][0] + 1e-6]
    if len(keys) < 2:
        keys = [keys[0], (keys[0][0] + 0.1, keys[0][1] + 0.1)]
    lo, hi = max(0.0, keys[0][0] - PAD), min(track.duration, keys[-1][0] + PAD)
    first, last = _slope(keys[0], keys[1]), _slope(keys[-2], keys[-1])
    out_lo = keys[0][1] - (keys[0][0] - lo) * first
    out_hi = keys[-1][1] + (hi - keys[-1][0]) * last
    path = cache / f"{_cache_key(track, lo, hi, keys)}.wav"
    length = round((keys[-1][1] - keys[0][1]) * SR)
    cut = round((keys[0][1] - out_lo) * SR)
    natural = track.shift == 0 and all(
        abs(_slope(keys[i], keys[i + 1]) - 1.0) < 1e-6 for i in range(len(keys) - 1)
    )
    cached = path.is_file()
    if cached:
        with contextlib.suppress(OSError):
            os.utime(path)
        audio = decode(path, channels=2)
    else:
        source = decode(track.path, channels=2)
        check()
        part = source[round(lo * SR) : round(hi * SR)]
        if natural:
            audio = np.ascontiguousarray(part)
        else:
            audio = _stretch(part, keys, lo, out_lo, out_hi - out_lo, track.shift, check)
            cache.mkdir(parents=True, exist_ok=True)
            write_wav(audio, path)
    audio = audio[cut : cut + length]
    if audio.shape[0] < length:
        audio = np.concatenate([audio, np.zeros((length - audio.shape[0], 2), np.float32)])
    return np.ascontiguousarray(audio, dtype=np.float32), keys[0][1], cached


def _stretch(
    part: Audio,
    keys: Sequence[tuple[float, float]],
    lo: float,
    out_lo: float,
    seconds: float,
    shift: int,
    check: Callable[[], None],
) -> Audio:
    """Rubber Band R3 through a time map: each key frame lands on its output time."""
    work = Path(tempfile.mkdtemp(prefix="tonalia-set-"))
    try:
        src, dst, mapping = work / "in.wav", work / "out.wav", work / "map.txt"
        _ffmpeg_write(part, src, ["-c:a", "pcm_f32le", "-f", "wav"])
        frames = part.shape[0]
        lines, last = [], -1
        for s, o in keys:
            f_in = round((s - lo) * SR)
            if 0 < f_in < frames and f_in > last:
                lines.append(f"{f_in} {round((o - out_lo) * SR)}")
                last = f_in
        mapping.write_text("\n".join(lines) + "\n", encoding="ascii")
        cmd = [rubberband_path(), "-3", "-q", "-M", str(mapping), "-D", f"{seconds:.6f}"]
        cmd += ["-p", f"{shift:.6f}", str(src), str(dst)]
        proc = subprocess.Popen(
            cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, creationflags=_NO_WINDOW
        )
        try:
            while proc.poll() is None:
                check()
                time.sleep(0.05)
        except BaseException:
            proc.kill()
            proc.wait()
            raise
        err = proc.stderr.read().decode("utf-8", "replace") if proc.stderr else ""
        if proc.stderr:
            proc.stderr.close()
        if proc.returncode != 0:
            lines = err.strip().splitlines()
            raise RenderSetError(
                f"Rubber Band failed: {lines[-1] if lines else proc.returncode}",
                reason="rubberband_failed",
            )
        return decode(dst, channels=2)
    finally:
        shutil.rmtree(work, ignore_errors=True)


# ---- fades, bass swap and gain ----


def _equal_power(n: int, rising: bool) -> FloatArray:
    p = np.linspace(0.0, 1.0, n, endpoint=False) if n else np.zeros(0)
    return np.sin(p * np.pi / 2) if rising else np.cos(p * np.pi / 2)


def _split_lows(audio: Audio) -> tuple[Audio, Audio]:
    sos = butter(4, BASS_HZ, btype="lowpass", fs=SR, output="sos")
    low = sosfiltfilt(sos, audio, axis=0).astype(np.float32) if audio.shape[0] > 30 else audio * 0
    return low, (audio - low).astype(np.float32)


def _swap_weight(n: int, beat: int) -> FloatArray:
    """1 before the middle of the overlap and 0 after, over one beat: A's lows."""
    w = np.ones(n)
    mid = n // 2
    ramp = max(1, min(beat, n // 4))
    lo, hi = max(0, mid - ramp // 2), min(n, mid + ramp // 2 + 1)
    w[lo:hi] = np.linspace(1.0, 0.0, hi - lo)
    w[hi:] = 0.0
    return w


def _shape(
    audio: Audio,
    start: float,
    head: _Transition | None,
    tail: _Transition | None,
    bass_swap: bool,
    gain_db: float,
) -> Audio:
    """Fades (and bass swap) of one track's part placed at output second ``start``."""
    out = audio * np.float32(10 ** (gain_db / 20))
    n = out.shape[0]
    for tr, rising in ((head, True), (tail, False)):
        if tr is None:
            continue
        a, b = round((tr.start - start) * SR), round((tr.end - start) * SR)
        a, b = max(0, a), min(n, max(b, a + round(CUT_FADE * SR)))
        if b <= a:
            continue
        seg = out[a:b]
        fade = _equal_power(b - a, rising)
        if bass_swap and tr.beats > 0:
            beat = round((tr.end - tr.start) / tr.beats * SR)
            w = _swap_weight(b - a, beat)
            low, high = _split_lows(seg)
            lows = w if not rising else 1.0 - w
            seg = high * fade[:, None] + low * lows[:, None]
        else:
            seg = seg * fade[:, None]
        out[a:b] = seg.astype(np.float32)
        if rising:
            out[:a] = 0
        else:
            out[b:] = 0
    return out


class _Loudness:
    """BS.1770-4 integrated loudness of a signal fed in chunks (K-weighting with state,
    400 ms blocks every 100 ms, absolute and relative gates) and its true peak."""

    def __init__(self, channels: int = 2) -> None:
        meter = pyloudnorm.Meter(SR)
        self.stages = [(f.b, f.a) for f in meter._filters.values()]
        self.state = [[lfilter_zi(b, a) * 0.0 for _ in range(channels)] for b, a in self.stages]
        self.step = round(0.1 * SR)
        self.carry = np.zeros((0, channels))
        self.sub: list[float] = []  # mean square of every 100 ms, summed over channels
        self.peak = 0.0

    def feed(self, chunk: Audio) -> None:
        x = chunk.astype(np.float64)
        self.peak = max(self.peak, true_peak(chunk))
        for s, (b, a) in enumerate(self.stages):
            for c in range(x.shape[1]):
                x[:, c], self.state[s][c] = lfilter(b, a, x[:, c], zi=self.state[s][c])
        x = np.concatenate([self.carry, x])
        whole = (x.shape[0] // self.step) * self.step
        if whole:
            blocks = x[:whole].reshape(-1, self.step, x.shape[1])
            self.sub.extend((blocks**2).mean(axis=1).sum(axis=1).tolist())
        self.carry = x[whole:]

    @property
    def lufs(self) -> float:
        sub = np.array(self.sub)
        if sub.size < 4:
            return -70.0
        z = np.convolve(sub, np.ones(4) / 4, mode="valid")  # 400 ms blocks
        loud = -0.691 + 10 * np.log10(z + 1e-12)
        z = z[loud > -70.0]
        if z.size == 0:
            return -70.0
        relative = -0.691 + 10 * np.log10(z.mean()) - 10.0
        z = z[-0.691 + 10 * np.log10(z) > relative]
        return float(-0.691 + 10 * np.log10(z.mean())) if z.size else -70.0

    @property
    def peak_db(self) -> float:
        return 20 * math.log10(max(self.peak, 1e-10))


def _chunks(total: int) -> Iterator[tuple[int, int]]:
    for start in range(0, total, CHUNK):
        yield start, min(total, start + CHUNK)


def _gain_curve(lo: int, hi: int, bounds: Sequence[float], gains: Sequence[float]) -> FloatArray:
    """Linear gain (from dB) for samples ``lo:hi``: each stretch's gain, ramping over
    ``GAIN_RAMP`` seconds around each boundary."""
    t = np.arange(lo, hi) / SR
    db = np.full(t.shape, gains[0])
    for k, edge in enumerate(bounds):
        before, after = gains[k], gains[k + 1]
        ramp = np.clip((t - (edge - GAIN_RAMP / 2)) / GAIN_RAMP, 0.0, 1.0)
        db = np.where(t >= edge - GAIN_RAMP / 2, before + (after - before) * ramp, db)
    return 10 ** (db / 20)


# ---- the set ----


def _track_list(tracks: list[_Track], starts: list[float]) -> list[RenderSetTrack]:
    return [
        RenderSetTrack(track_id=t.id, title=t.title, artist=t.artist, start=round(s, 3))
        for t, s in zip(tracks, starts, strict=True)
    ]


def _clock(seconds: float) -> str:
    whole = int(seconds)
    h, rest = divmod(whole, 3600)
    return f"{h}:{rest // 60:02d}:{rest % 60:02d}" if h else f"{rest // 60:02d}:{rest % 60:02d}"


def _cue_time(seconds: float) -> str:
    frames = round(seconds * 75)
    minutes, rest = divmod(frames, 75 * 60)
    return f"{minutes:02d}:{rest // 75:02d}:{rest % 75:02d}"


def _quote(text: str) -> str:
    return text.replace('"', "'")


def write_lists(path: Path, items: list[RenderSetTrack]) -> tuple[Path, Path]:
    txt, cue = path.with_suffix(".txt"), path.with_suffix(".cue")
    lines = [f"{_clock(i.start)}  {i.artist + ' - ' if i.artist else ''}{i.title}" for i in items]
    sheet = [f'FILE "{_quote(path.name)}" {"MP3" if path.suffix == ".mp3" else "WAVE"}']
    for n, i in enumerate(items, 1):
        sheet += [f"  TRACK {n:02d} AUDIO", f'    TITLE "{_quote(i.title)}"']
        if i.artist:
            sheet.append(f'    PERFORMER "{_quote(i.artist)}"')
        sheet.append(f"    INDEX 01 {_cue_time(i.start)}")
    for target, text in ((txt, "\n".join(lines)), (cue, "\n".join(sheet))):
        tmp = target.with_name(f".{target.name}.{uuid.uuid4().hex[:8]}.tmp")
        tmp.write_text(text + "\n", encoding="utf-8")
        tmp.replace(target)
    return txt, cue


def _chapters(items: list[RenderSetTrack], total: float, path: Path) -> None:
    lines = [";FFMETADATA1"]
    for n, i in enumerate(items):
        end = items[n + 1].start if n + 1 < len(items) else total
        title = f"{i.artist} - {i.title}" if i.artist else i.title
        safe = "".join("\\" + c if c in "=;#\\\n" else c for c in title)
        lines += ["[CHAPTER]", "TIMEBASE=1/1000", f"START={round(i.start * 1000)}"]
        lines += [f"END={round(end * 1000)}", f"title={safe}"]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def _flac_chapters(items: list[RenderSetTrack]) -> list[str]:
    """FLAC has no chapter block FFmpeg writes: the CHAPTERnnn / CHAPTERnnnNAME comments
    that players (and FFmpeg itself) read as chapters."""
    args = []
    for n, i in enumerate(items, 1):
        ms = round(i.start * 1000)
        h, rest = divmod(ms, 3_600_000)
        stamp = f"{h:02d}:{rest // 60_000:02d}:{rest % 60_000 // 1000:02d}.{rest % 1000:03d}"
        name = f"{i.artist} - {i.title}" if i.artist else i.title
        args += ["-metadata", f"CHAPTER{n:03d}={stamp}", "-metadata", f"CHAPTER{n:03d}NAME={name}"]
    return args


CODECS = {
    "wav": ["-c:a", "pcm_s24le", "-f", "wav"],
    "flac": ["-c:a", "flac", "-sample_fmt", "s32", "-bits_per_raw_sample", "24", "-f", "flac"],
    "mp3": ["-c:a", "libmp3lame", "-b:a", "320k", "-id3v2_version", "3", "-f", "mp3"],
}


def validate(db: Database, p: RenderSetParams) -> None:
    """Raise for a set that cannot be rendered, before starting the long job."""
    if p.format == "mp3" and not mp3_available():
        raise RenderSetError("this FFmpeg cannot write MP3", reason="unsupported_format")
    if p.preview_transition is None and not p.path:
        raise RenderSetError("choose where to save the set", reason="invalid_params")
    tracks = _load(db, p)
    transitions, _ = layout(
        tracks,
        style=p.style or style_setting(db),
        overlap=p.overlap_bars,
        tempo=p.tempo,
        fixed_bpm=p.fixed_bpm,
    )
    if p.preview_transition is not None and p.preview_transition >= len(transitions):
        raise RenderSetError(f"no transition {p.preview_transition}", reason="invalid_params")


def render_set(
    db: Database, data_dir: Path, p: RenderSetParams, job: JobContext
) -> RenderSetResult:
    started = time.perf_counter()
    if p.format == "mp3" and not mp3_available():
        raise RenderSetError("this FFmpeg cannot write MP3", reason="unsupported_format")
    if p.preview_transition is None and not p.path:
        raise RenderSetError("choose where to save the set", reason="invalid_params")
    tracks = _load(db, p)
    style = p.style or style_setting(db)
    transitions, total = layout(
        tracks, style=style, overlap=p.overlap_bars, tempo=p.tempo, fixed_bpm=p.fixed_bpm
    )
    starts = [t.keys[0][1] for t in tracks]
    chosen = list(range(len(tracks)))
    window = (0.0, total)
    if p.preview_transition is not None:
        i = p.preview_transition
        if not 0 <= i < len(transitions):
            raise RenderSetError(f"no transition {i}", reason="invalid_params")
        bar = 240.0 / tracks[i].grid.bpm
        chosen = [i, i + 1]
        window = (
            max(0.0, transitions[i].start - 8 * bar),
            min(total, transitions[i].end + 8 * bar),
        )
    cache = data_dir / "cache" / "render_set"
    cache.mkdir(parents=True, exist_ok=True)
    work = Path(tempfile.mkdtemp(prefix="tonalia-mix-", dir=cache))

    def check() -> None:
        if job.cancelled:
            raise JobCancelled()

    try:
        length = round((window[1] - window[0]) * SR) + 1
        mix = np.lib.format.open_memmap(
            work / "mix.npy", mode="w+", dtype=np.float32, shape=(length, 2)
        )
        done = rendered = from_cache = 0
        workers = max(1, min(4, (os.cpu_count() or 2) - 1, len(chosen)))
        with ThreadPoolExecutor(workers) as pool:
            futures = {i: pool.submit(_render_track, tracks[i], cache, check) for i in chosen}
            for i in chosen:
                audio, at, cached = futures[i].result()
                check()
                shaped = _shape(
                    audio,
                    at,
                    transitions[i - 1] if i > 0 else None,
                    transitions[i] if i < len(transitions) else None,
                    p.bass_swap,
                    tracks[i].gain_db,
                )
                begin = round((at - window[0]) * SR)
                a, b = max(0, begin), min(length, begin + shaped.shape[0])
                if b > a:
                    mix[a:b] += shaped[a - begin : b - begin]
                from_cache += cached
                rendered += not cached
                done += 1
                job.progress("rendering", 90 * done / len(chosen), done=done, total=len(chosen))
        # The loudness of the whole set, then each stretch's gain under the peak limit.
        meter = _Loudness()
        for a, b in _chunks(length):
            check()
            meter.feed(mix[a:b])
        wanted = p.target_lufs - meter.lufs
        bounds = [((tr.start + tr.end) / 2) - window[0] for tr in transitions]
        bounds = [x for x in bounds if 0 < x < length / SR]
        edges = [0.0, *bounds, length / SR]
        gains, lowered = [], 0
        for k in range(len(edges) - 1):
            a = max(0, round((edges[k] - GAIN_RAMP) * SR))
            b = min(length, round((edges[k + 1] + GAIN_RAMP) * SR))
            peak_db = 20 * math.log10(max(true_peak(mix[a:b]), 1e-10))
            gain = min(wanted, MAX_PEAK_DBTP - 0.05 - peak_db)
            lowered += gain < wanted - 0.01
            gains.append(gain)
        job.progress("writing", 92)
        out_path = Path(p.path) if p.path and p.preview_transition is None else None
        final = _Loudness()
        if out_path is None:
            target = cache / f"preview-{uuid.uuid4().hex[:12]}.wav"
            fmt = "wav"
        else:
            target = out_path
            fmt = p.format
        items = _track_list([tracks[i] for i in chosen], [starts[i] - window[0] for i in chosen])
        chapters: list[str] = []
        if p.chapters and fmt == "mp3":
            meta = work / "chapters.txt"
            _chapters(items, length / SR, meta)
            chapters = ["-f", "ffmetadata", "-i", str(meta), "-map", "0:a", "-map_chapters", "1"]
        elif p.chapters and fmt == "flac":
            chapters = _flac_chapters(items)
        _encode(mix, length, fmt, target, chapters, bounds, gains, final, check)
        txt = cue = None
        if out_path is not None:
            txt, cue = write_lists(out_path, items)
        else:
            prune_cache(cache, MAX_CACHE_BYTES)
        job.progress("writing", 100)
        return RenderSetResult(
            path=str(target),
            txt_path=str(txt) if txt else None,
            cue_path=str(cue) if cue else None,
            format=fmt,
            duration=round(length / SR, 3),
            tracks=items,
            loudness_lufs=round(final.lufs, 2),
            true_peak_db=round(final.peak_db, 2),
            lowered=lowered,
            rendered=rendered,
            cached=from_cache,
            preview=p.preview_transition is not None,
            elapsed_ms=round((time.perf_counter() - started) * 1000),
        )
    finally:
        shutil.rmtree(work, ignore_errors=True)
        prune_cache(cache, MAX_CACHE_BYTES)


def _encode(
    mix: Audio,
    length: int,
    fmt: str,
    target: Path,
    chapters: Sequence[str],
    bounds: Sequence[float],
    gains: Sequence[float],
    meter: _Loudness,
    check: Callable[[], None],
) -> None:
    """Stream the mix with its gain to FFmpeg, atomically next to ``target``."""
    tmp = target.with_name(f".{target.stem}.{uuid.uuid4().hex[:8]}.tonalia-tmp{target.suffix}")
    cmd = [ffmpeg_path(), "-nostdin", "-hide_banner", "-loglevel", "error", "-y"]
    cmd += ["-f", "f32le", "-ar", str(SR), "-ac", "2", "-i", "pipe:0"]
    cmd += [*chapters, *CODECS[fmt], f"file:{tmp}"]
    proc = subprocess.Popen(
        cmd, stdin=subprocess.PIPE, stderr=subprocess.PIPE, creationflags=_NO_WINDOW
    )
    assert proc.stdin is not None
    try:
        for a, b in _chunks(length):
            check()
            chunk = (mix[a:b] * _gain_curve(a, b, bounds, gains)[:, None]).astype(np.float32)
            meter.feed(chunk)
            proc.stdin.write(np.ascontiguousarray(np.clip(chunk, -1, 1), dtype="<f4").tobytes())
        proc.stdin.close()
        err = proc.stderr.read().decode("utf-8", "replace") if proc.stderr else ""
        if proc.wait() != 0:
            lines = err.strip().splitlines()
            raise RenderSetError(
                f"cannot write {target.name}: {lines[-1] if lines else proc.returncode}",
                reason="write_failed",
                name=target.name,
            )
        tmp.replace(target)
    except BaseException:
        with contextlib.suppress(OSError):
            if proc.poll() is None:
                proc.kill()
        proc.wait()
        tmp.unlink(missing_ok=True)
        raise
    finally:
        if proc.stderr:
            proc.stderr.close()
