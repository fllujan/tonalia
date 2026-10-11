import numpy as np
import pyloudnorm
import pytest

from tonalia_engine.analysis.quality import QualityResult, analyze_quality

SR = 44100


def report(audio: np.ndarray, sr: int, fmt: str, bitrate: int) -> QualityResult:
    result = analyze_quality(audio, sr, fmt=fmt, bitrate=bitrate)
    assert result is not None
    return result


def stereo(mono: np.ndarray) -> np.ndarray:
    return np.column_stack([mono, mono]).astype(np.float32)


def music(seconds: float = 20.0, lufs: float = -9.0, seed: int = 0) -> np.ndarray:
    """Broadband noise with a beat, normalized to a club loudness."""
    rng = np.random.default_rng(seed)
    n = int(seconds * SR)
    x = rng.standard_normal(n) * 0.2
    t = np.arange(n) / SR
    x += 0.5 * np.sin(2 * np.pi * 55 * t) * (np.sin(2 * np.pi * 2 * t) > 0)
    x *= 10 ** ((lufs - pyloudnorm.Meter(SR).integrated_loudness(x)) / 20)
    return np.clip(x, -0.95, 0.95)


def test_clean_track_has_no_flags() -> None:
    q = report(stereo(music()), SR, fmt="flac", bitrate=900)
    assert q.flags == []
    # BS.1770 sums the channels: the same signal on both sides measures 3 dB louder.
    assert q.loudness_lufs == pytest.approx(-9.0 + 3.01, abs=0.6)
    assert q.peak_db < 0
    assert q.clipping_ratio < 1e-4
    assert q.cutoff_hz > 19000


def test_clipping_is_detected() -> None:
    clipped = np.clip(music(lufs=-9.0) * 3.0, -1.0, 1.0)
    q = report(stereo(clipped), SR, fmt="wav", bitrate=1411)
    assert "clipping" in q.flags
    assert q.clipping_ratio > 0.01
    assert q.peak_db == pytest.approx(0.0, abs=0.01)


def test_low_bitrate_only_for_mp3() -> None:
    audio = stereo(music())
    assert "low_bitrate" in report(audio, SR, fmt="mp3", bitrate=128).flags
    assert "low_bitrate" not in report(audio, SR, fmt="mp3", bitrate=320).flags
    assert "low_bitrate" not in report(audio, SR, fmt="m4a", bitrate=128).flags


def test_fake_high_quality_from_spectral_cutoff() -> None:
    # Lossy encoders cut like a brick wall (about 15-16 kHz at 128 kbps).
    spectrum = np.fft.rfft(music())
    spectrum[np.fft.rfftfreq(int(20.0 * SR), 1 / SR) > 15000] = 0
    dull = np.fft.irfft(spectrum, n=int(20.0 * SR))
    q = report(stereo(dull), SR, fmt="mp3", bitrate=320)
    assert "fake_hq" in q.flags
    assert 14000 < q.cutoff_hz < 16000
    # A genuinely low-bitrate file with the same cutoff is "low bitrate", not "fake".
    low = report(stereo(dull), SR, fmt="mp3", bitrate=128)
    assert "fake_hq" not in low.flags and "low_bitrate" in low.flags


def test_quiet_and_silence_flags() -> None:
    quiet = report(stereo(music(lufs=-20.0)), SR, fmt="flac", bitrate=900)
    assert "quiet" in quiet.flags
    padded = np.concatenate([np.zeros(5 * SR), music(), np.zeros(4 * SR)])
    q = report(stereo(padded), SR, fmt="flac", bitrate=900)
    assert {"silence_start", "silence_end"} <= set(q.flags)
    assert q.silence_start == pytest.approx(5.0, abs=0.1)
    assert q.silence_end == pytest.approx(4.0, abs=0.1)


def test_mono_input_and_silence_only() -> None:
    q = report(music().astype(np.float32), SR, fmt="flac", bitrate=900)
    assert q.flags == []
    assert analyze_quality(np.zeros((SR * 5, 2), np.float32), SR, fmt="wav", bitrate=1411) is None
