"""Render a set to audio (SPEC 14.2): the click test (downbeats of every transition within
5 ms, the track list on the file's times), loudness and true peak, the cache, the fixed
tempo, bass swap, track lists and chapters, previews, errors and cancelling."""

from __future__ import annotations

import json
import subprocess
import wave
from pathlib import Path
from typing import Any

import numpy as np
import pyloudnorm
import pytest
from scipy.signal import butter, find_peaks, sosfiltfilt

from tests.test_analysis_queue import call, wait_job
from tests.test_render import needs_rubberband
from tonalia_engine import render_set
from tonalia_engine.analysis.quality import true_peak
from tonalia_engine.audio_io import decode, ffmpeg_path
from tonalia_engine.server import EngineContext, build_dispatcher

pytestmark = needs_rubberband

SR = 44100
FIRST = 0.5
BARS = 48
BPMS = (120.0, 122.0, 124.0, 126.0, 128.0)
CLICKS = (900.0, 2600.0, 1500.0, 4200.0, 2000.0)  # neighbours never share a band
LOWS = (55.0, 82.0, 62.0, 90.0, 70.0)  # each track's bass tone


def make_track(path: Path, bpm: float, click_hz: float, low_hz: float, bars: int = BARS) -> float:
    """Clicks on every beat over a steady bass and pad (a steady loudness), plus 1 s."""
    beat = 60.0 / bpm
    duration = FIRST + bars * 4 * beat + 1.0
    t = np.arange(int(duration * SR)) / SR
    # A pad the loudness meter hears (K-weighting barely counts the bass tone).
    x = 0.08 * np.sin(2 * np.pi * low_hz * t) + 0.15 * np.sin(2 * np.pi * 440 * t)
    burst = np.sin(2 * np.pi * click_hz * np.arange(int(0.006 * SR)) / SR) * np.hanning(
        int(0.006 * SR)
    )
    for k in range(bars * 4):
        at = round((FIRST + k * beat) * SR)
        x[at : at + burst.size] += (0.25 if k % 4 == 0 else 0.18) * burst
    pcm = (np.clip(x, -1, 1) * 32767).astype("<i2")
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(np.repeat(pcm[:, None], 2, axis=1).tobytes())
    return duration


def add_set(ctx: EngineContext, folder: Path, count: int = 5, bars: int = BARS) -> list[int]:
    folder.mkdir(parents=True, exist_ok=True)
    ids = []
    for n in range(1, count + 1):
        bpm, click, low = BPMS[(n - 1) % 5], CLICKS[(n - 1) % 5], LOWS[(n - 1) % 5]
        path = folder / f"Tema {n} ñ.wav"
        duration = make_track(path, bpm, click, low, bars)
        bar = 240.0 / bpm
        cur = ctx.db.conn.execute(
            "INSERT INTO tracks (path, file_hash, title, artist, status, display_title, duration,"
            " search_text) VALUES (?, ?, ?, 'Lumen Drift', 'ready', ?, ?, '')",
            (str(path), f"hash{n}", f"Tema {n}", f"Tema {n}", duration),
        )
        tid = int(cur.lastrowid or 0)
        grid = {"kind": "constant", "bpm": bpm, "first_downbeat": FIRST}
        ctx.db.conn.execute(
            "INSERT INTO analysis (track_id, key_root, key_mode, bpm, energy, beat_grid,"
            " replaygain_db) VALUES (?, 9, 'minor', ?, 7, ?, 0.0)",
            (tid, bpm, json.dumps(grid)),
        )
        for label, a, b in (("intro", 0, 16), ("drop", 16, bars - 16), ("outro", bars - 16, bars)):
            ctx.db.conn.execute(
                "INSERT INTO segments (track_id, start_sec, end_sec, label) VALUES (?, ?, ?, ?)",
                (tid, 0.0 if a == 0 else FIRST + a * bar, FIRST + b * bar, label),
            )
        ids.append(tid)
    return ids


def render(ctx: EngineContext, **params: Any) -> dict[str, Any]:
    job = call(ctx, "render.set", params)
    finished = wait_job(ctx, job["jobId"], timeout=600)
    assert finished["status"] == "done", finished
    result: dict[str, Any] = finished["result"]
    return result


def onsets(audio: np.ndarray, hz: float, a: float, b: float) -> np.ndarray:
    """Click times (s) in band ``hz`` between output seconds ``a`` and ``b``."""
    lo, hi = int(a * SR), int(b * SR)
    sos = butter(4, [hz * 0.85, hz * 1.15], btype="bandpass", fs=SR, output="sos")
    env = np.abs(sosfiltfilt(sos, audio[lo:hi, 0].astype(np.float64)))
    if env.size == 0 or env.max() == 0:
        return np.zeros(0)
    # The stretcher leaves some clicks quieter than others: a low threshold finds them all.
    peaks, _ = find_peaks(env, height=env.max() * 0.08, distance=int(0.2 * SR))
    return (peaks + lo) / SR


@pytest.fixture
def set_ids(engine_ctx: EngineContext, tmp_path: Path) -> list[int]:
    return add_set(engine_ctx, tmp_path / "Música 🎧")


def items(ids: list[int], shifts: dict[int, int] | None = None) -> list[dict[str, int]]:
    return [{"trackId": i, "shift": (shifts or {}).get(i, 0)} for i in ids]


def test_click_test_transitions_line_up_and_the_list_matches(
    engine_ctx: EngineContext, set_ids: list[int], tmp_path: Path
) -> None:
    out = tmp_path / "Mi set.wav"
    result = render(
        engine_ctx, items=items(set_ids), path=str(out), overlapBars=16, targetLufs=-14.0
    )
    audio = decode(out, channels=2)
    assert abs(audio.shape[0] / SR - result["duration"]) < 0.05
    starts = [t["start"] for t in result["tracks"]]
    assert starts[0] == 0.0 and starts == sorted(starts)
    for i in range(4):
        # The overlap: from B's entry, 16 bars at the ramp's tempo (at most A's beat).
        a, b = starts[i + 1], starts[i + 1] + 16 * 4 * 60 / min(BPMS[i], BPMS[i + 1])
        # The middle half, where both decks are loud enough to hear every click.
        mid_a, mid_b = a + (b - a) * 0.25, a + (b - a) * 0.75
        clicks_a = onsets(audio, CLICKS[i], mid_a, mid_b)
        clicks_b = onsets(audio, CLICKS[i + 1], mid_a, mid_b)
        assert clicks_a.size > 10 and clicks_b.size > 10
        gaps = np.array([np.min(np.abs(clicks_b - c)) for c in clicks_a])
        # A click at the very edge of the window may have its partner just outside.
        inner = (clicks_a > mid_a + 0.3) & (clicks_a < mid_b - 0.3)
        assert gaps[inner].max() < 0.005, (i, clicks_a[inner & (gaps >= 0.005)].tolist())
        # The list says where B comes in: counting the ramp's beats from that time (the
        # tempo goes from A's to B's one beat at a time) lands on every click of B.
        n = 16 * 4
        steps = 60 / (BPMS[i] + (BPMS[i + 1] - BPMS[i]) * (np.arange(n) + 0.5) / n)
        expected = a + np.concatenate([[0.0], np.cumsum(steps)])
        assert max(np.min(np.abs(expected - c)) for c in clicks_b) < 0.005
    # Loudness at the target (±1 LU), never over -1 dBTP.
    loudness = pyloudnorm.Meter(SR).integrated_loudness(audio.astype(np.float64))
    assert abs(loudness - (-14.0)) <= 1.0
    assert abs(result["loudnessLufs"] - loudness) < 0.3
    assert 20 * np.log10(true_peak(audio)) <= -1.0 + 0.05
    # The track list next to the file.
    txt = Path(result["txtPath"]).read_text(encoding="utf-8").splitlines()
    assert txt[0] == "00:00  Lumen Drift - Tema 1" and len(txt) == 5
    cue = Path(result["cuePath"]).read_text(encoding="utf-8")
    assert cue.startswith('FILE "Mi set.wav" WAVE') and cue.count("INDEX 01") == 5
    assert result["rendered"] == 5 and result["cached"] == 0

    # Changing one track's key renders only that track again.
    again = render(engine_ctx, items=items(set_ids, {set_ids[2]: 1}), path=str(out), overlapBars=16)
    assert (again["rendered"], again["cached"]) == (1, 4)


def test_fixed_tempo_puts_every_beat_on_one_grid(
    engine_ctx: EngineContext, set_ids: list[int], tmp_path: Path
) -> None:
    out = tmp_path / "fijo.flac"
    result = render(
        engine_ctx,
        items=items(set_ids[:2]),
        path=str(out),
        format="flac",
        tempo="fixed",
        fixedBpm=125.0,
        overlapBars=8,
        chapters=True,
    )
    audio = decode(out, channels=2)
    clicks = onsets(audio, CLICKS[0], 1.0, result["tracks"][1]["start"] - 1.0)
    assert np.allclose(np.diff(clicks), 60 / 125.0, atol=0.002)
    probe = subprocess.run(
        [ffmpeg_path(), "-hide_banner", "-i", str(out)], capture_output=True, text=True
    ).stderr
    assert "Chapter #0:1" in probe and "Lumen Drift - Tema 2" in probe


def test_bass_swap_hands_the_lows_over_halfway(
    engine_ctx: EngineContext, set_ids: list[int], tmp_path: Path
) -> None:
    out = tmp_path / "graves.wav"
    result = render(
        engine_ctx, items=items(set_ids[:2]), path=str(out), overlapBars=16, bassSwap=True
    )
    audio = decode(out, channels=2)[:, 0].astype(np.float64)
    start = result["tracks"][1]["start"]
    half = 8 * 4 * 60 / BPMS[0]

    def level(hz: float, a: float, b: float) -> float:
        seg = audio[int(a * SR) : int(b * SR)]
        spectrum = np.abs(np.fft.rfft(seg * np.hanning(seg.size)))
        freqs = np.fft.rfftfreq(seg.size, 1 / SR)
        return float(spectrum[np.abs(freqs - hz) < 2].max())

    first, second = (start + 0.5, start + half - 1.0), (start + half + 1.0, start + 2 * half - 1)
    assert level(LOWS[0], *first) > 8 * level(LOWS[1], *first)  # A's lows, not B's
    assert level(LOWS[1], *second) > 8 * level(LOWS[0], *second)  # then B's


def test_previewing_one_transition(engine_ctx: EngineContext, set_ids: list[int]) -> None:
    result = render(engine_ctx, items=items(set_ids), previewTransition=1, overlapBars=16)
    assert result["preview"] is True and result["txtPath"] is None
    assert Path(result["path"]).is_file() and result["format"] == "wav"
    assert [t["trackId"] for t in result["tracks"]] == set_ids[1:3]
    assert 16 * 2 < result["duration"] < 40 * 2  # the overlap and 8 bars either side


def test_errors_are_coded_and_reported_before_the_job(
    engine_ctx: EngineContext, set_ids: list[int], tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def reason(params: dict[str, Any]) -> str:
        out = build_dispatcher(engine_ctx).handle_line(
            json.dumps({"jsonrpc": "2.0", "id": 1, "method": "render.set", "params": params})
        )
        assert out is not None
        return str(json.loads(out)["error"]["data"]["reason"])

    path = str(tmp_path / "x.wav")
    engine_ctx.db.conn.execute(
        "UPDATE analysis SET beat_grid = NULL WHERE track_id = ?", (set_ids[4],)
    )
    assert reason({"items": items(set_ids), "path": path}) == "not_analysed"
    ok = set_ids[:2]
    assert reason({"items": items(ok), "path": path, "tempo": "fixed", "fixedBpm": 60}) == (
        "bpm_out_of_range"
    )
    assert reason({"items": [], "path": path}) == "invalid_set"
    assert reason({"items": items(ok)}) == "invalid_params"
    monkeypatch.setattr(render_set, "mp3_available", lambda: False)
    assert reason({"items": items(ok), "path": path, "format": "mp3"}) == "unsupported_format"
    assert call(engine_ctx, "render.setFormats", {})["formats"] == ["wav", "flac"]


def test_cancelling_leaves_no_file(
    engine_ctx: EngineContext, set_ids: list[int], tmp_path: Path
) -> None:
    out = tmp_path / "cancelado.wav"
    job = call(engine_ctx, "render.set", {"items": items(set_ids), "path": str(out)})
    call(engine_ctx, "job.cancel", {"jobId": job["jobId"]})
    finished = wait_job(engine_ctx, job["jobId"], timeout=600)
    assert finished["status"] in ("cancelled", "done")
    if finished["status"] == "cancelled":
        assert not out.exists()
    assert not list(tmp_path.glob("*.tonalia-tmp*"))


@pytest.mark.skipif(
    not __import__("os").environ.get("TONALIA_BENCH"), reason="set TONALIA_BENCH=1 to run"
)
def test_benchmark_a_60_minute_set(engine_ctx: EngineContext, tmp_path: Path) -> None:
    """SPEC 14.2: a 60-minute set in under 5 minutes on an M1 (run by hand)."""
    import time

    ids = add_set(engine_ctx, tmp_path / "hora", count=11, bars=176)  # ~6 min each
    started = time.perf_counter()
    result = render(engine_ctx, items=items(ids), path=str(tmp_path / "hora.flac"), format="flac")
    elapsed = time.perf_counter() - started
    print(f"60-min set: {result['duration'] / 60:.1f} min of audio in {elapsed:.0f} s")
    assert result["duration"] > 55 * 60 and elapsed < 300
