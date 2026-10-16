"""Render (SPEC 2.15 and 2.16): pitch shift, time stretch, segments, stems and the cache."""

from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any

import numpy as np
import pytest

from tests.test_analysis_queue import call, import_folder, wait_job
from tonalia_engine import render
from tonalia_engine.analysis.tempo import BeatGrid
from tonalia_engine.audio_io import decode
from tonalia_engine.jobs import JobCancelled
from tonalia_engine.render import (
    RenderError,
    cache_key,
    first_downbeat,
    prune_cache,
    rubberband_path,
    stretch,
    time_ratio,
)
from tonalia_engine.server import EngineContext, build_dispatcher
from tonalia_engine.stems import STEMS, write_flac

SR = 44100


def has_rubberband() -> bool:
    try:
        rubberband_path()
    except RenderError:
        return False
    return True


needs_rubberband = pytest.mark.skipif(not has_rubberband(), reason="rubberband not available")


# ---- pure helpers ----


def test_time_ratio() -> None:
    assert time_ratio(120.0, None) == 1.0
    assert time_ratio(120.0, 120.0) == 1.0
    assert time_ratio(120.0, 126.0) == pytest.approx(120 / 126)
    with pytest.raises(RenderError, match="tempo"):
        time_ratio(None, 126.0)
    with pytest.raises(RenderError, match="range"):
        time_ratio(60.0, 140.0)
    with pytest.raises(RenderError, match="range"):
        time_ratio(170.0, 80.0)


def test_first_downbeat_of_a_segment() -> None:
    grid = BeatGrid("constant", 120.0, 0.3)  # one bar = 2 s
    assert first_downbeat(grid, 300.0, 0.0, 1.0, SR) == round(0.3 * SR)
    # From 5.0 s the next downbeat is 6.3 s: 1.3 s in, stretched by the ratio.
    assert first_downbeat(grid, 300.0, 5.0, 1.0, SR) == round(1.3 * SR)
    assert first_downbeat(grid, 300.0, 5.0, 120 / 126, SR) == round(1.3 * 120 / 126 * SR)
    # A segment starting exactly on a downbeat aligns at sample 0.
    assert first_downbeat(grid, 300.0, 6.3, 1.0, SR) == 0
    variable = BeatGrid("variable", 120.0, 1.0, beats=[0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.6, 4.1, 4.6])
    assert first_downbeat(variable, 300.0, 1.2, 1.0, SR) == round(1.8 * SR)  # 3.0 s
    assert first_downbeat(None, 300.0, 0.0, 1.0, SR) is None


def test_cache_key_depends_on_every_parameter() -> None:
    base: dict[str, Any] = {
        "source": "mix:abc",
        "start": 0.0,
        "duration": 10.0,
        "semitones": 0.0,
        "ratio": 1.0,
    }
    key = cache_key(**base)
    assert key == cache_key(**base) and len(key) == 32
    for field, value in [
        ("source", "vocals:abc"),
        ("start", 0.5),
        ("duration", None),
        ("semitones", 2.0),
        ("ratio", 0.95),
    ]:
        assert cache_key(**{**base, field: value}) != key


def test_prune_cache_removes_the_oldest(tmp_path: Path) -> None:
    for i, name in enumerate(["a", "b", "c"]):
        f = tmp_path / f"{name}.wav"
        f.write_bytes(b"x" * 100)
        os.utime(f, (1000 + i, 1000 + i))
    prune_cache(tmp_path, max_bytes=250, keep=tmp_path / "a.wav")
    assert sorted(p.name for p in tmp_path.iterdir()) == ["a.wav", "c.wav"]


@needs_rubberband
def test_stretch_can_be_cancelled(tmp_path: Path) -> None:
    audio = np.zeros((SR * 20, 2), dtype=np.float32)

    def cancel() -> None:
        raise JobCancelled

    with pytest.raises(JobCancelled):
        stretch(audio, 2.0, 1.0, cancel, tmp_dir=tmp_path)
    assert list(tmp_path.iterdir()) == []


# ---- through RPC ----


def tone(freq: float, seconds: float) -> np.ndarray:
    t = np.arange(int(seconds * SR)) / SR
    mono = (0.5 * np.sin(2 * np.pi * freq * t)).astype(np.float32)
    return np.stack([mono, mono], axis=1)


def clicks(bpm: float, first: float, seconds: float) -> np.ndarray:
    """A short decaying 2 kHz burst on every beat."""
    out = np.zeros(int(seconds * SR), dtype=np.float32)
    burst_t = np.arange(int(0.01 * SR)) / SR
    burst = (0.8 * np.sin(2 * np.pi * 2000 * burst_t) * np.exp(-burst_t / 0.002)).astype(np.float32)
    for t in np.arange(first, seconds - 0.02, 60.0 / bpm):
        i = round(t * SR)
        out[i : i + burst.size] += burst
    return np.stack([out, out], axis=1)


def onsets(audio: np.ndarray, min_gap: float = 0.2) -> list[float]:
    env = np.abs(audio[:, 0])
    threshold = 0.3 * env.max()
    found: list[float] = []
    i = 0
    above = np.flatnonzero(env > threshold)
    while i < above.size:
        found.append(above[i] / SR)
        nxt = np.searchsorted(above, above[i] + int(min_gap * SR))
        i = int(nxt)
    return found


def add_track(ctx: EngineContext, folder: Path, name: str, audio: np.ndarray) -> int:
    folder.mkdir(parents=True, exist_ok=True)
    write_flac(audio, folder / name)
    import_folder(ctx, folder)
    row = ctx.db.conn.execute("SELECT id FROM tracks WHERE path LIKE ?", (f"%{name}",)).fetchone()
    return int(row["id"])


def set_grid(ctx: EngineContext, track_id: int, bpm: float, first: float) -> None:
    ctx.db.conn.execute(
        "INSERT OR REPLACE INTO analysis (track_id, bpm, beat_grid) VALUES (?, ?, ?)",
        (
            track_id,
            bpm,
            json.dumps({"kind": "constant", "bpm": bpm, "first_downbeat": first, "beats": None}),
        ),
    )


def render_now(ctx: EngineContext, **spec: Any) -> dict[str, Any]:
    reply = call(ctx, "render.preview", spec)
    if reply.get("result"):
        result: dict[str, Any] = reply["result"]
        return result
    finished = wait_job(ctx, reply["jobId"])
    assert finished["status"] == "done", finished
    assert finished["result"]["cached"] is False
    out: dict[str, Any] = finished["result"]
    return out


def rpc_error(ctx: EngineContext, method: str, params: Any) -> dict[str, Any]:
    msg = {"jsonrpc": "2.0", "id": 1, "method": method, "params": params}
    out = build_dispatcher(ctx).handle_line(json.dumps(msg))
    assert out is not None
    reply = json.loads(out)
    assert "error" in reply, reply
    error: dict[str, Any] = reply["error"]
    return error


def dominant_frequency(audio: np.ndarray) -> float:
    mono = audio[:, 0].astype(np.float64)
    window = np.hanning(mono.size)
    spectrum = np.abs(np.fft.rfft(mono * window, n=mono.size * 4))
    freqs = np.fft.rfftfreq(mono.size * 4, 1 / SR)
    return float(freqs[int(np.argmax(spectrum))])


@needs_rubberband
def test_plus_two_semitones_is_two_semitones_higher(
    engine_ctx: EngineContext, tmp_path: Path
) -> None:
    track = add_track(engine_ctx, tmp_path / "Tonos ñ 🎹", "la 440.flac", tone(440.0, 6.0))
    result = render_now(engine_ctx, trackId=track, semitones=2)
    audio = decode(Path(result["path"]), channels=2)
    assert result["sampleRate"] == SR and result["timeRatio"] == 1.0
    assert result["frames"] == audio.shape[0] == pytest.approx(6.0 * SR, abs=2)
    middle = audio[SR : 5 * SR]
    expected = 440.0 * 2 ** (2 / 12)  # 493.88 Hz
    assert dominant_frequency(middle) == pytest.approx(expected, rel=0.002)
    assert 12 * np.log2(dominant_frequency(middle) / 440.0) == pytest.approx(2.0, abs=0.03)


@needs_rubberband
def test_time_stretch_keeps_downbeats_aligned(engine_ctx: EngineContext, tmp_path: Path) -> None:
    track = add_track(engine_ctx, tmp_path / "clicks", "clicks 120.flac", clicks(120, 0.3, 30))
    set_grid(engine_ctx, track, 120.0, 0.3)
    result = render_now(engine_ctx, trackId=track, start=5.0, duration=8.0, targetBpm=126.0)
    ratio = 120 / 126
    assert result["timeRatio"] == pytest.approx(ratio)
    assert result["bpm"] == pytest.approx(126.0)
    assert result["duration"] == pytest.approx(8.0 * ratio, abs=1e-3)
    audio = decode(Path(result["path"]), channels=2)
    found = onsets(audio)
    # Beats of the original at 5.3, 5.8, … map to (t - 5) * ratio in the render.
    expected = [(t - 5.0) * ratio for t in np.arange(5.3, 12.9, 0.5)]
    assert len(found) == len(expected)
    errors = np.abs(np.asarray(found) - np.asarray(expected))
    assert errors.max() < 0.005, errors
    # The reported first downbeat (6.3 s in the original) is where the click is.
    assert abs(result["firstDownbeat"] / SR - (6.3 - 5.0) * ratio) < 1e-4
    assert min(abs(f - result["firstDownbeat"] / SR) for f in found) < 0.005


@needs_rubberband
def test_renders_are_cached(engine_ctx: EngineContext, tmp_path: Path) -> None:
    track = add_track(engine_ctx, tmp_path / "cache", "tone.flac", tone(330.0, 4.0))
    first = render_now(engine_ctx, trackId=track, semitones=-1, start=1.0, duration=2.0)
    started = time.monotonic()
    reply = call(
        engine_ctx,
        "render.preview",
        {"trackId": track, "semitones": -1, "start": 1.0, "duration": 2.0},
    )
    assert time.monotonic() - started < 0.5
    assert reply["jobId"] is None
    assert reply["result"]["cached"] is True
    assert reply["result"]["path"] == first["path"]
    assert Path(first["path"]).parent == engine_ctx.data_dir / "cache" / "render"
    # A different shift is a different file.
    other = render_now(engine_ctx, trackId=track, semitones=1, start=1.0, duration=2.0)
    assert other["path"] != first["path"]


def test_unprocessed_segment_is_copied_exactly(engine_ctx: EngineContext, tmp_path: Path) -> None:
    audio = tone(220.0, 5.0)
    track = add_track(engine_ctx, tmp_path / "plain", "plain.flac", audio)
    result = render_now(engine_ctx, trackId=track, start=1.5, duration=2.0)
    out = decode(Path(result["path"]), channels=2)
    assert result["firstDownbeat"] is None and result["bpm"] is None
    assert out.shape == (2 * SR, 2)
    assert np.max(np.abs(out - audio[int(1.5 * SR) : int(3.5 * SR)])) < 1e-5


def test_renders_a_stem(engine_ctx: EngineContext, tmp_path: Path) -> None:
    mix = tone(220.0, 4.0)
    track = add_track(engine_ctx, tmp_path / "stems", "song.flac", mix)
    folder = tmp_path / "stem files"
    folder.mkdir()
    paths = {}
    for i, name in enumerate(STEMS):
        paths[name] = folder / f"{name}.flac"
        write_flac((mix * (0.1 * (i + 1))).astype(np.float32), paths[name])
    file_hash = engine_ctx.db.conn.execute(
        "SELECT file_hash FROM tracks WHERE id = ?", (track,)
    ).fetchone()[0]
    engine_ctx.db.conn.execute(
        "INSERT INTO stems (track_id, model, vocals_path, drums_path, bass_path, other_path,"
        " instrumental_path, source_hash) VALUES (?, 'htdemucs_ft', ?, ?, ?, ?, ?, ?)",
        (track, *(str(paths[n]) for n in STEMS), file_hash),
    )
    result = render_now(engine_ctx, trackId=track, source="vocals", duration=1.0)
    out = decode(Path(result["path"]), channels=2)
    expected = decode(paths["vocals"], channels=2)[:SR]
    assert np.max(np.abs(out - expected)) < 1e-5
    other = render_now(engine_ctx, trackId=track, source="drums", duration=1.0)
    assert other["path"] != result["path"]


def test_rejects_impossible_renders(engine_ctx: EngineContext, tmp_path: Path) -> None:
    track = add_track(engine_ctx, tmp_path / "errors", "short.flac", tone(220.0, 2.0))
    error = rpc_error(engine_ctx, "render.preview", {"trackId": track, "source": "vocals"})
    assert "stems" in error["message"]
    error = rpc_error(engine_ctx, "render.preview", {"trackId": track, "targetBpm": 128})
    assert "tempo" in error["message"]
    error = rpc_error(engine_ctx, "render.preview", {"trackId": track, "start": 3.0})
    assert "beyond" in error["message"]
    error = rpc_error(engine_ctx, "render.preview", {"trackId": 999, "semitones": 1})
    assert "999" in error["message"]
    error = rpc_error(engine_ctx, "render.preview", {"trackId": track, "semitones": 13})
    assert error["code"] == -32602


def test_render_uses_the_bundled_binary_from_the_env(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    fake = tmp_path / "rb"
    fake.write_text("", encoding="utf-8")
    monkeypatch.setenv("TONALIA_RUBBERBAND", str(fake))
    assert render.rubberband_path() == str(fake)


def align_starts(
    downbeats: list[float], delays: list[float], now: float, lead: float = 0.12
) -> list[float]:
    """Mirror of ``alignStarts`` in app/src/features/decks/sync.ts (the decks' scheduler)."""
    late = max([0.0, *(d - delays[i] for i, d in enumerate(downbeats))])
    common = now + lead + late
    return [common + delays[i] - d for i, d in enumerate(downbeats)]


@needs_rubberband
def test_two_decks_play_their_downbeats_together(engine_ctx: EngineContext, tmp_path: Path) -> None:
    """SPEC 8 acceptance: deck B (117 BPM, +2 st) matched to deck A (124 BPM) and both
    scheduled from the reported first downbeats keep every beat within 5 ms for 16 bars."""
    a = add_track(engine_ctx, tmp_path / "decks", "deck a 124.flac", clicks(124, 0.41, 60))
    b = add_track(engine_ctx, tmp_path / "decks", "deck b 117.flac", clicks(117, 1.07, 60))
    set_grid(engine_ctx, a, 124.0, 0.41)
    set_grid(engine_ctx, b, 117.0, 1.07)
    bar_a, bar_b = 240 / 124, 240 / 117
    # Segments start off the grid, as after a click on the waveform between bars.
    ra = render_now(engine_ctx, trackId=a, start=10.0, duration=16 * bar_a + 1)
    rb = render_now(
        engine_ctx, trackId=b, start=20.3, duration=16 * bar_b + 1, semitones=2, targetBpm=124.0
    )
    assert rb["timeRatio"] == pytest.approx(117 / 124)
    downbeats = [ra["firstDownbeat"] / SR, rb["firstDownbeat"] / SR]
    start_a, start_b = align_starts(downbeats, [0.0, 0.0], now=3.0)
    on_a = np.asarray(onsets(decode(Path(ra["path"]), channels=2))) + start_a
    on_b = np.asarray(onsets(decode(Path(rb["path"]), channels=2))) + start_b
    common = start_a + downbeats[0]
    window = (common - 1e-3, common + 16 * bar_a - 0.1)
    beats_b = on_b[(on_b >= window[0]) & (on_b <= window[1])]
    assert beats_b.size >= 63  # 16 bars of 4 beats
    errors = np.array([np.min(np.abs(on_a - t)) for t in beats_b])
    assert errors.max() < 0.005, errors.max()
