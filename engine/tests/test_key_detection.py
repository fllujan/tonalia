import numpy as np
import pytest

from tests.fixtures.music import SR, drums, progression
from tonalia_engine.analysis.chroma import estimate_tuning, harmonic_spectrogram, hpcp
from tonalia_engine.analysis.key import KeyWeights, detect_key
from tonalia_engine.keys import Key, format_key

ALL_KEYS = [Key(root, mode) for mode in ("major", "minor") for root in range(12)]


@pytest.mark.parametrize("key", ALL_KEYS, ids=lambda k: format_key(k, "alphanumeric"))
def test_detects_all_24_keys(key: Key) -> None:
    result = detect_key(progression(key, 24.0), SR)
    assert result is not None
    assert result.key == key, (
        f"expected {format_key(key, 'classical')}, got {format_key(result.key, 'classical')}"
    )
    assert 0.0 <= result.confidence <= 1.0
    assert len(result.alternatives) == 2
    assert key not in result.alternatives


def test_confidence_is_high_for_clear_material() -> None:
    result = detect_key(progression(Key(9, "minor"), 32.0), SR)
    assert result is not None and result.confidence >= 0.5
    assert len(result.scores) == 24
    assert max(result.scores, key=result.scores.__getitem__) == "8A"


def test_tuning_is_estimated_and_compensated() -> None:
    key = Key(2, "major")
    audio = progression(key, 24.0, a4=432.0)
    result = detect_key(audio, SR)
    assert result is not None
    assert result.key == key
    assert result.tuning_hz == pytest.approx(432.0, abs=2.0)


def test_tuning_estimate_at_440() -> None:
    spec, freqs = harmonic_spectrogram(progression(Key(0, "major"), 16.0), SR)
    assert estimate_tuning(spec, freqs) == pytest.approx(440.0, abs=1.5)


def test_drum_intro_is_ignored() -> None:
    key = Key(7, "minor")
    audio = progression(key, 24.0, drum_intro=16.0, with_drums=True)
    result = detect_key(audio, SR)
    assert result is not None and result.key == key


def test_secondary_key_is_reported_when_it_dominates_long_enough() -> None:
    first = progression(Key(0, "major"), 90.0)
    second = progression(Key(2, "major"), 60.0)
    result = detect_key(np.concatenate([first, second]), SR)
    assert result is not None
    assert result.key == Key(0, "major")
    assert result.secondary is not None
    assert result.secondary.key == Key(2, "major")
    assert result.secondary.start_sec == pytest.approx(90.0, abs=30.0)
    assert 0.25 < result.secondary.share < 0.6


def test_no_secondary_key_for_a_single_key_track() -> None:
    result = detect_key(progression(Key(5, "major"), 120.0), SR)
    assert result is not None and result.secondary is None


def test_silence_and_pure_percussion_return_none() -> None:
    assert detect_key(np.zeros(SR * 10, dtype=np.float32), SR) is None
    assert detect_key(drums(20.0), SR) is None


def test_hpcp_peaks_on_chord_tones() -> None:
    spec, freqs = harmonic_spectrogram(progression(Key(0, "major"), 8.0, chord_seconds=8.0), SR)
    profile = hpcp(spec, freqs, 440.0).mean(axis=0)
    top3 = set(np.argsort(profile)[-3:].tolist())
    assert top3 == {0, 4, 7}  # C, E, G


def test_weights_are_loaded_and_normalized() -> None:
    weights = KeyWeights.load()
    assert set(weights.profiles) == {"edma", "bgate", "temperley", "krumhansl"}
    assert sum(weights.profiles.values()) == pytest.approx(1.0)


def test_learned_model_is_transposition_invariant() -> None:
    from tonalia_engine.analysis.key import N_CHANNELS, KeyModel

    rng = np.random.default_rng(0)
    model = KeyModel(rng.normal(size=(2, N_CHANNELS, 12)), np.array([0.1, -0.1]))
    features = rng.random((N_CHANNELS, 12))
    base = model.logits(features)
    for shift in range(12):
        shifted = model.logits(np.roll(features, shift, axis=-1))
        # Key index = root + 12 * mode: rolling the features moves every root by `shift`.
        expected = np.concatenate([np.roll(base[:12], shift), np.roll(base[12:], shift)])
        assert np.allclose(shifted, expected)
    p = model.probabilities(features)
    assert p.shape == (24,) and p.sum() == pytest.approx(1.0)


def test_learned_model_ships_with_the_engine() -> None:
    from tonalia_engine.analysis.key import KeyModel

    assert KeyModel.load() is not None
