from pathlib import Path

import pytest

from tonalia_engine.keys import Key, parse_key
from tools.eval_key import _simplex
from tools.evaluation import (
    dataset_pairs,
    mirex_category,
    parse_reference_key,
    read_csv,
    tempo_accuracy,
)


def k(text: str) -> Key:
    key = parse_key(text)
    assert key is not None
    return key


@pytest.mark.parametrize(
    ("estimate", "reference", "category"),
    [
        ("Am", "Am", "correct"),
        ("Em", "Am", "fifth"),  # a fifth above
        ("Dm", "Am", "fifth"),  # a fifth below
        ("C", "Am", "relative"),
        ("A", "Am", "parallel"),
        ("F#m", "Am", "other"),
        ("G", "C", "fifth"),
        ("Am", "C", "relative"),
        ("Cm", "C", "parallel"),
    ],
)
def test_mirex_categories(estimate: str, reference: str, category: str) -> None:
    assert mirex_category(k(estimate), k(reference)) == category


def test_no_estimate() -> None:
    assert mirex_category(None, k("C")) == "none"


@pytest.mark.parametrize(
    ("estimate", "reference", "acc1", "acc2"),
    [
        (124.0, 124.0, True, True),
        (128.9, 124.0, True, True),  # within 4 %
        (130.0, 124.0, False, False),
        (62.0, 124.0, False, True),  # half
        (174.0, 87.0, False, True),  # double
        (120.0, 40.0, False, True),  # triple
        (None, 124.0, False, False),
    ],
)
def test_tempo_accuracy(estimate: float | None, reference: float, acc1: bool, acc2: bool) -> None:
    assert tempo_accuracy(estimate, reference) == (acc1, acc2)


def test_reference_parsing_and_csv(tmp_path: Path) -> None:
    assert parse_reference_key("Eb major") == Key(3, "major")
    assert parse_reference_key("A minor\n") == Key(9, "minor")
    csv = tmp_path / "refs ñ.csv"
    csv.write_text("ruta,tonalidad\nuno.mp3,8A\n/abs/dos.flac, Am \n", encoding="utf-8")
    rows = read_csv(csv)
    assert [(r.path, r.value) for r in rows] == [
        (tmp_path / "uno.mp3", "8A"),
        (Path("/abs/dos.flac"), "Am"),
    ]


def test_weight_grid_covers_the_simplex() -> None:
    combos = _simplex(4, 0.1)
    assert len(combos) == 286
    assert all(abs(sum(c) - 1.0) < 1e-9 for c in combos)


def test_dataset_pairs(tmp_path: Path) -> None:
    (tmp_path / "audio").mkdir()
    (tmp_path / "ann").mkdir()
    (tmp_path / "audio" / "1.LOFI.mp3").write_bytes(b"")
    (tmp_path / "ann" / "1.LOFI.key").write_text("A minor")
    (tmp_path / "ann" / "2.LOFI.key").write_text("C major")  # no audio
    pairs = dataset_pairs(tmp_path / "audio", tmp_path / "ann", ".key")
    assert [(p.path.name, p.value) for p in pairs] == [("1.LOFI.mp3", "A minor")]


def test_dataset_pairs_by_leading_id(tmp_path: Path) -> None:
    (tmp_path / "audio").mkdir()
    (tmp_path / "ann").mkdir()
    (tmp_path / "audio" / "10089 Some Artist - Song (Original Mix).mp3").write_bytes(b"")
    (tmp_path / "ann" / "10089.LOFI.key").write_text("Eb major")
    pairs = dataset_pairs(tmp_path / "audio", tmp_path / "ann", ".key")
    assert [(p.path.name, p.value) for p in pairs] == [
        ("10089 Some Artist - Song (Original Mix).mp3", "Eb major")
    ]


def test_dataset_pairs_reads_genre(tmp_path: Path) -> None:
    for d in ("audio", "ann", "genre"):
        (tmp_path / d).mkdir()
    (tmp_path / "audio" / "7.LOFI.mp3").write_bytes(b"")
    (tmp_path / "ann" / "7.LOFI.bpm").write_text("174")
    (tmp_path / "genre" / "7.LOFI.genre").write_text("drum-and-bass\n")
    (pair,) = dataset_pairs(tmp_path / "audio", tmp_path / "ann", ".bpm", tmp_path / "genre")
    assert (pair.value, pair.genre) == ("174", "drum-and-bass")
