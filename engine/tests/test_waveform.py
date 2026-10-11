from pathlib import Path

import numpy as np
import pytest

from tonalia_engine.analysis.waveform import (
    BANDS,
    POINTS_PER_SECOND,
    Waveform,
    compute_waveform,
    read_waveform,
    write_waveform,
)

SR = 44100


def tone(freq: float, seconds: float, amp: float = 0.8) -> np.ndarray:
    t = np.arange(int(seconds * SR)) / SR
    return (amp * np.sin(2 * np.pi * freq * t)).astype(np.float32)


def test_resolution_and_shape() -> None:
    wf = compute_waveform(tone(440, 10.0), SR)
    assert wf.points_per_second == POINTS_PER_SECOND == 150
    assert wf.data.shape == (1500, len(BANDS))
    assert wf.data.dtype == np.uint8


@pytest.mark.parametrize(("freq", "band"), [(60.0, 0), (1000.0, 1), (9000.0, 2)])
def test_energy_lands_in_the_right_band(freq: float, band: int) -> None:
    wf = compute_waveform(tone(freq, 4.0), SR)
    middle = wf.data[100:-100].astype(float).mean(axis=0)
    assert int(np.argmax(middle)) == band
    others = [middle[b] for b in range(3) if b != band]
    assert middle[band] > 3 * max(others)


def test_quiet_and_loud_are_distinguished() -> None:
    loud = compute_waveform(tone(1000, 2.0, amp=0.9), SR).data[:, 1].mean()
    quiet = compute_waveform(tone(1000, 2.0, amp=0.05), SR).data[:, 1].mean()
    assert loud > 2 * quiet > 0


def test_binary_roundtrip_is_exact(tmp_path: Path) -> None:
    wf = compute_waveform(tone(220, 3.0) + tone(5000, 3.0, 0.2), SR)
    path = tmp_path / "formas de onda 🌊" / "7.twf"
    write_waveform(path, wf)
    back = read_waveform(path)
    assert back == wf
    assert path.stat().st_size == 16 + wf.data.size  # header + 3 bytes per point
    assert not list(path.parent.glob("*.tmp"))  # atomic write leaves no temp file


def test_rejects_foreign_files(tmp_path: Path) -> None:
    path = tmp_path / "x.twf"
    path.write_bytes(b"RIFF....not a waveform")
    with pytest.raises(ValueError):
        read_waveform(path)


def test_equality_ignores_nothing() -> None:
    a = Waveform(150, np.zeros((3, 3), np.uint8))
    b = Waveform(150, np.ones((3, 3), np.uint8))
    assert a != b
