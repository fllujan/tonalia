"""Spectrogram of quality (SPEC 13.5): the picture, its cut-off line, the cache, the RPC,
and the fake-high-quality check measuring the very same cut-off on filtered fixtures."""

from __future__ import annotations

import base64
import wave
from pathlib import Path

import numpy as np
import pytest

from tests.fixtures.generate import encode
from tests.test_analysis_queue import call, import_folder, wait_job
from tonalia_engine.analysis.quality import analyze_quality, likely_source_kbps, spectral_cutoff
from tonalia_engine.analysis.spectrogram import (
    ROWS,
    compute_spectrogram,
    read_spectrogram,
    write_spectrogram,
)
from tonalia_engine.server import EngineContext

SR = 44100


def noise(seconds: float = 20.0, lowpass: float | None = None, seed: int = 0) -> np.ndarray:
    """Broadband music-like noise, optionally cut like a low-bitrate encode."""
    rng = np.random.default_rng(seed)
    x = rng.standard_normal(int(seconds * SR)) * 0.15
    t = np.arange(len(x)) / SR
    x += 0.4 * np.sin(2 * np.pi * 55 * t) * (np.sin(2 * np.pi * 2 * t) > 0)
    if lowpass is not None:
        # An encoder's low-pass is a brick wall: nothing is left above it.
        spectrum = np.fft.rfft(x)
        spectrum[np.fft.rfftfreq(len(x), 1 / SR) > lowpass] = 0
        x = np.fft.irfft(spectrum, len(x))
    return np.clip(x, -0.95, 0.95)


@pytest.mark.parametrize(("lowpass", "low", "high"), [
    (16000, 15300, 16600),
    (19000, 18300, 19600),
    (None, 20500, 22050),
])  # fmt: skip
def test_the_cutoff_line_matches_the_filter(lowpass: float | None, low: float, high: float) -> None:
    spec = compute_spectrogram(noise(lowpass=lowpass), SR)
    assert low <= spec.cutoff_hz <= high
    assert spec.data.shape[0] == ROWS and 0 < spec.data.shape[1] <= 480
    # Above the cut the picture goes dark; below it is lit.
    row = int(spec.cutoff_hz / spec.max_hz * ROWS)
    if lowpass is not None:
        assert spec.data[: row - 4].mean() > spec.data[min(ROWS - 1, row + 6) :].mean() + 60


def test_the_quality_check_uses_the_same_cutoff() -> None:
    audio = noise(lowpass=16000)
    spec = compute_spectrogram(audio, SR)
    assert spec.cutoff_hz == round(spectral_cutoff(audio, SR))
    stereo = np.column_stack([audio, audio]).astype(np.float32)
    q = analyze_quality(stereo, SR, fmt="mp3", bitrate=320, cutoff_hz=spec.cutoff_hz)
    assert q is not None and "fake_hq" in q.flags and q.cutoff_hz == spec.cutoff_hz
    assert likely_source_kbps(spec.cutoff_hz) == 128


def test_likely_source_bitrate() -> None:
    assert likely_source_kbps(11000) == 64
    assert likely_source_kbps(16000) == 128
    assert likely_source_kbps(17000) == 128  # LAME cuts its 128 kbps at about 17 kHz
    assert likely_source_kbps(17600) == 160
    assert likely_source_kbps(19000) == 192
    assert likely_source_kbps(20500) is None


def test_the_cache_file_round_trips_and_rejects_garbage(tmp_path: Path) -> None:
    spec = compute_spectrogram(noise(seconds=5, lowpass=16000), SR)
    path = tmp_path / "spectrograms" / "1.tsg"
    write_spectrogram(path, spec)
    back = read_spectrogram(path)
    assert np.array_equal(back.data, spec.data) and back.cutoff_hz == spec.cutoff_hz
    path.write_bytes(b"TSG1 broken")
    with pytest.raises(ValueError):
        read_spectrogram(path)


def test_very_short_audio_gives_an_empty_picture() -> None:
    spec = compute_spectrogram(np.zeros(1000), SR)
    assert spec.data.shape == (ROWS, 0)


def _encode_mp3_like_flac(folder: Path) -> Path:
    """A FLAC whose audio stops at 16 kHz: a lossless file made from a 128 kbps MP3."""
    folder.mkdir(parents=True, exist_ok=True)
    source = folder.parent / "source.wav"
    pcm = (noise(seconds=12, lowpass=16000) * 32767).astype("<i2")
    with wave.open(str(source), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    path = encode(source, folder / "Transcodificado ñ.flac", "flac")
    source.unlink()
    return path


def test_rpc_computes_it_for_old_tracks_then_the_analysis_caches_it(
    engine_ctx: EngineContext, tmp_path: Path
) -> None:
    folder = tmp_path / "Música 🎧"
    _encode_mp3_like_flac(folder)
    import_folder(engine_ctx, folder)
    track_id = call(engine_ctx, "library.list", {})["items"][0]["id"]
    # Not analysed yet: computed from the file, then cached.
    first = call(engine_ctx, "quality.spectrogram", {"trackId": track_id})
    assert 15300 <= first["cutoffHz"] <= 16600 and first["likelyKbps"] == 128
    assert first["format"] == "flac" and first["maxHz"] == SR / 2
    data = base64.b64decode(first["data"])
    assert len(data) == first["rows"] * first["columns"]
    # A second call gives the same picture.
    assert call(engine_ctx, "quality.spectrogram", {"trackId": track_id})["data"] == first["data"]
    # Analysing writes the cache and flags the fake lossless file with the same cut-off.
    job = call(engine_ctx, "analysis.start", {"trackIds": [track_id]})
    assert wait_job(engine_ctx, job["jobId"], timeout=300)["status"] == "done"
    path, cutoff, flags = engine_ctx.db.conn.execute(
        "SELECT spectrogram_path, cutoff_hz, quality_flags FROM analysis WHERE track_id = ?",
        (track_id,),
    ).fetchone()
    assert Path(path).is_file() and Path(path).parent.name == "spectrograms"
    assert "fake_hq" in flags
    after = call(engine_ctx, "quality.spectrogram", {"trackId": track_id})
    assert after["cutoffHz"] == cutoff and after["fakeHq"] is True
    # Removing the track deletes the cache (never the audio).
    call(engine_ctx, "library.remove", {"trackIds": [track_id]})
    assert not Path(path).exists()


def test_rpc_errors_are_coded(engine_ctx: EngineContext, tmp_path: Path) -> None:
    import json

    from tonalia_engine.server import build_dispatcher

    def err(params: dict[str, int]) -> str:
        out = build_dispatcher(engine_ctx).handle_line(
            json.dumps(
                {"jsonrpc": "2.0", "id": 1, "method": "quality.spectrogram", "params": params}
            )
        )
        assert out is not None
        return str(json.loads(out)["error"]["data"]["reason"])

    assert err({"trackId": 999}) == "track_not_found"
    folder = tmp_path / "gone"
    path = _encode_mp3_like_flac(folder)
    import_folder(engine_ctx, folder)
    track_id = call(engine_ctx, "library.list", {})["items"][0]["id"]
    path.unlink()
    assert err({"trackId": track_id}) == "file_not_found"
