from pathlib import Path

import numpy as np
import pytest

from tests.fixtures.generate import FORMATS, make_all
from tonalia_engine import audio_io
from tonalia_engine.audio_io import ANALYSIS_SAMPLE_RATE, DecodeError, decode, downmix


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


def test_downmix_matches_ffmpeg_mono(tmp_path: Path) -> None:
    # Different content per channel, so the downmix rule really matters.
    import wave

    t = np.arange(ANALYSIS_SAMPLE_RATE * 2) / ANALYSIS_SAMPLE_RATE
    left, right = 0.4 * np.sin(2 * np.pi * 220 * t), 0.3 * np.sin(2 * np.pi * 330 * t)
    path = tmp_path / "estéreo 🎛️.wav"
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(ANALYSIS_SAMPLE_RATE)
        w.writeframes((np.column_stack([left, right]) * 32767).astype("<i2").tobytes())
    stereo = decode(path, channels=2)
    assert np.allclose(downmix(stereo), decode(path), atol=1e-6)
    mono = decode(path)
    assert downmix(mono) is mono  # already mono: unchanged
    duplicated = np.column_stack([mono, mono])  # a mono file decoded as stereo
    assert np.array_equal(downmix(duplicated), mono)


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


@pytest.mark.parametrize("name", ["-y tricky.wav", "concat x.wav", "http%3A tono.wav"])
def test_hostile_file_names_are_read_as_local_files(
    fixtures: dict[str, Path], tmp_path: Path, name: str
) -> None:
    target = tmp_path / name
    target.write_bytes(fixtures["wav"].read_bytes())
    assert len(decode(target)) > 0


def test_playlists_cannot_reach_the_network(tmp_path: Path) -> None:
    playlist = tmp_path / "evil.m3u8"
    playlist.write_text(
        "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:10\n#EXTINF:10.0,\n"
        "http://127.0.0.1:9/never.ts\n#EXT-X-ENDLIST\n",
        encoding="utf-8",
    )
    with pytest.raises(DecodeError):
        decode(playlist)


def test_input_arguments_are_confined_to_local_files(tmp_path: Path) -> None:
    args = audio_io.ffmpeg_local_input(tmp_path / "http:x.mp3")
    assert args[:2] == ["-protocol_whitelist", "file"]
    assert args[2] == "-i"
    assert args[3] == f"file:{(tmp_path / 'http:x.mp3').resolve()}"


def test_ffmpeg_resolution_prefers_env(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    fake = tmp_path / "ffmpeg-custom"
    fake.write_text("", encoding="utf-8")
    monkeypatch.setenv("TONALIA_FFMPEG", str(fake))
    assert audio_io.ffmpeg_path() == str(fake)
