from pathlib import Path

import numpy as np
import pytest

from tests.fixtures.generate import FORMATS, make_all
from tonalia_engine import audio_io
from tonalia_engine.audio_io import ANALYSIS_SAMPLE_RATE, DecodeError, decode


@pytest.fixture(scope="module")
def fixtures(tmp_path_factory: pytest.TempPathFactory) -> dict[str, Path]:
    return make_all(tmp_path_factory.mktemp("Música con espacios ñ 🎵"))


def dominant_frequency(samples: np.ndarray, sample_rate: int) -> float:
    spectrum = np.abs(np.fft.rfft(samples * np.hanning(len(samples))))
    return float(np.fft.rfftfreq(len(samples), 1 / sample_rate)[np.argmax(spectrum)])


@pytest.mark.parametrize("fmt", list(FORMATS))
def test_decodes_every_format_to_mono_float32(fixtures: dict[str, Path], fmt: str) -> None:
    samples = decode(fixtures[fmt])
    assert samples.dtype == np.float32
    assert samples.ndim == 1
    # Lossy codecs add encoder padding; allow ~100 ms of slack.
    assert abs(len(samples) / ANALYSIS_SAMPLE_RATE - 2.0) < 0.1
    assert dominant_frequency(samples, ANALYSIS_SAMPLE_RATE) == pytest.approx(440, abs=2)
    # FFmpeg's standard downmix sums L and R at -3 dB: a 0.5 tone on both sides -> 0.5 * sqrt(2).
    assert float(np.max(np.abs(samples))) == pytest.approx(0.5 * np.sqrt(2), abs=0.06)


def test_stereo_and_resampling(fixtures: dict[str, Path]) -> None:
    samples = decode(fixtures["flac"], sample_rate=22050, channels=2)
    assert samples.shape[1] == 2
    assert abs(samples.shape[0] / 22050 - 2.0) < 0.01
    assert float(np.max(np.abs(samples))) == pytest.approx(0.5, abs=0.01)


def test_segment(fixtures: dict[str, Path]) -> None:
    samples = decode(fixtures["wav"], start=0.5, duration=1.0)
    assert len(samples) == pytest.approx(ANALYSIS_SAMPLE_RATE, abs=64)


def test_corrupt_file_raises_decode_error(tmp_path: Path) -> None:
    bad = tmp_path / "roto ñ.mp3"
    bad.write_bytes(b"this is not audio" * 100)
    with pytest.raises(DecodeError) as exc:
        decode(bad)
    assert str(exc.value)


def test_missing_file_raises_decode_error(tmp_path: Path) -> None:
    with pytest.raises(DecodeError):
        decode(tmp_path / "no existe 🎧.wav")


def test_ffmpeg_resolution_prefers_env(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    fake = tmp_path / "ffmpeg-custom"
    fake.write_text("")
    monkeypatch.setenv("TONALIA_FFMPEG", str(fake))
    assert audio_io.ffmpeg_path() == str(fake)
