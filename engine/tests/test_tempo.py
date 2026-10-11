import numpy as np
import pytest

from tests.fixtures.music import progression
from tests.fixtures.rhythm import SR, click_track, tempo_change_track
from tonalia_engine.analysis.tempo import TempoSettings, detect_tempo, prior_centre, round_bpm
from tonalia_engine.keys import Key


@pytest.mark.parametrize("bpm", [90.0, 100.5, 120.0, 124.0, 126.0, 128.0, 140.0, 174.0])
def test_constant_tempo_is_precise(bpm: float) -> None:
    # 87 vs 174 is ambiguous from rhythm alone; the genre resolves it (SPEC 2.4).
    genre = "Drum & Bass" if bpm >= 160 else None
    result = detect_tempo(click_track(bpm, 60.0, first_beat=0.37), SR, genre=genre)
    assert result is not None
    assert result.bpm == pytest.approx(bpm, abs=0.05)
    assert result.grid.kind == "constant"
    assert 0.0 <= result.confidence <= 1.0
    # Beats line up with the true grid within 15 ms.
    period = 60.0 / bpm
    phase_error = ((np.asarray(result.beats) - 0.37 + period / 2) % period) - period / 2
    assert np.max(np.abs(phase_error)) < 0.015


@pytest.mark.parametrize("downbeat_beat", [0, 1, 2, 3])
def test_downbeat_is_found(downbeat_beat: int) -> None:
    bpm, first = 124.0, 0.21
    result = detect_tempo(click_track(bpm, 64.0, first_beat=first, downbeat_beat=downbeat_beat), SR)
    assert result is not None
    bar = 4 * 60.0 / bpm
    expected = first + downbeat_beat * 60.0 / bpm
    offset = ((result.grid.first_downbeat - expected + bar / 2) % bar) - bar / 2
    assert abs(offset) < 0.015


def test_half_tempo_is_doubled_into_range() -> None:
    result = detect_tempo(click_track(64.0, 60.0), SR)
    assert result is not None and result.bpm == pytest.approx(128.0, abs=0.1)


def test_fast_tempo_without_genre_is_one_of_the_octaves() -> None:
    result = detect_tempo(click_track(174.0, 60.0), SR)
    assert result is not None
    assert min(abs(result.bpm - 87.0), abs(result.bpm - 174.0)) < 0.05


def test_custom_range_halves_fast_tempo() -> None:
    settings = TempoSettings(min_bpm=60.0, max_bpm=120.0)
    result = detect_tempo(click_track(174.0, 60.0), SR, settings=settings)
    assert result is not None and result.bpm == pytest.approx(87.0, abs=0.05)


def test_drum_and_bass_genre_prefers_fast_octave() -> None:
    audio = click_track(172.0, 60.0)
    result = detect_tempo(audio, SR, genre="Drum & Bass")
    assert result is not None and result.bpm == pytest.approx(172.0, abs=0.1)


def test_variable_tempo_yields_beat_list() -> None:
    result = detect_tempo(tempo_change_track(120.0, 126.0, 60.0), SR)
    assert result is not None
    assert result.grid.kind == "variable"
    assert result.grid.beats is not None and len(result.grid.beats) > 200
    beats = np.asarray(result.grid.beats)
    first_half = np.median(np.diff(beats[beats < 55]))
    second_half = np.median(np.diff(beats[beats > 65]))
    assert 60 / first_half == pytest.approx(120.0, abs=0.5)
    assert 60 / second_half == pytest.approx(126.0, abs=0.5)


def test_jittered_constant_tempo_stays_constant() -> None:
    # Real recordings and the onset envelope add a few ms of timing noise per beat; that
    # must not be mistaken for a tempo change.
    audio = click_track(126.0, 90.0, first_beat=0.25, jitter=0.006)
    result = detect_tempo(audio, SR)
    assert result is not None
    assert result.grid.kind == "constant"
    assert result.bpm == pytest.approx(126.0, abs=0.1)


@pytest.mark.parametrize(
    ("genre", "centre"),
    [
        ("Drum & Bass", 174.0),
        ("drum-and-bass", 174.0),
        ("Jungle", 174.0),
        ("Dubstep", 140.0),
        ("Psy-Trance", 142.0),
        ("Trance", 138.0),
        ("Techno", 130.0),
        ("Deep House", 124.0),
        ("Hip-Hop", 95.0),
        ("Chill-Out", 100.0),
        (None, 125.0),
        ("Polka", 125.0),
    ],
)
def test_prior_centre_by_genre(genre: str | None, centre: float) -> None:
    assert prior_centre(genre) == centre


def test_music_with_drums() -> None:
    music = progression(Key(9, "minor"), 48.0)
    drums = click_track(126.0, 48.0, first_beat=0.1)
    result = detect_tempo(0.5 * music + drums[: len(music)], SR)
    assert result is not None and result.bpm == pytest.approx(126.0, abs=0.05)


def test_silence_returns_none() -> None:
    assert detect_tempo(np.zeros(SR * 10, dtype=np.float32), SR) is None


@pytest.mark.parametrize(
    ("bpm", "decimals", "expected"),
    [(124.034, 0, 124.0), (124.034, 1, 124.0), (124.06, 1, 124.1), (99.999, 2, 100.0)],
)
def test_round_bpm(bpm: float, decimals: int, expected: float) -> None:
    assert round_bpm(bpm, decimals) == expected
