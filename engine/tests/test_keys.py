import json
from pathlib import Path
from typing import Any

import pytest

from tonalia_engine.keys import (
    NOTATIONS,
    Key,
    compatibility,
    format_key,
    from_alphanumeric,
    parse_key,
    shift,
    wheel_number,
)

CASES: dict[str, Any] = json.loads(
    (Path(__file__).parent / "data" / "keys_cases.json").read_text(encoding="utf-8")
)
FIELD = {
    "alphanumeric": "alphanumeric",
    "open_key": "openKey",
    "classical": "classical",
    "classical_flat": "classicalFlat",
}


@pytest.mark.parametrize("case", CASES["notations"], ids=lambda c: c["alphanumeric"])
def test_notations(case: dict[str, Any]) -> None:
    key = Key(case["root"], case["mode"])
    assert from_alphanumeric(case["alphanumeric"]) == key
    for notation in NOTATIONS:
        assert format_key(key, notation) == case[FIELD[notation]]
        # every notation round-trips through the parser
        assert parse_key(case[FIELD[notation]]) == key


def test_all_24_keys_are_distinct() -> None:
    keys = {Key(c["root"], c["mode"]) for c in CASES["notations"]}
    assert len(keys) == 24
    assert sorted(wheel_number(k) for k in keys) == sorted(list(range(1, 13)) * 2)


@pytest.mark.parametrize(("a", "b", "score", "relation"), CASES["compatibility"])
def test_compatibility(a: str, b: str, score: float, relation: str) -> None:
    result = compatibility(from_alphanumeric(a), from_alphanumeric(b))
    assert result.score == pytest.approx(score)
    assert result.relation == relation


@pytest.mark.parametrize(("key", "semitones", "expected"), CASES["shift"])
def test_shift(key: str, semitones: int, expected: str) -> None:
    assert format_key(shift(from_alphanumeric(key), semitones), "alphanumeric") == expected


@pytest.mark.parametrize(("text", "expected"), CASES["parse"])
def test_parse(text: str, expected: str | None) -> None:
    parsed = parse_key(text)
    assert (format_key(parsed, "alphanumeric") if parsed else None) == expected


def test_shift_composes_and_preserves_mode() -> None:
    for case in CASES["notations"]:
        key = Key(case["root"], case["mode"])
        for s in range(-12, 13):
            moved = shift(key, s)
            assert moved.mode == key.mode
            assert shift(moved, -s) == key
            assert shift(shift(key, s), 3) == shift(key, s + 3)


def test_invalid_keys_are_rejected() -> None:
    with pytest.raises(ValueError):
        Key(12, "major")
    with pytest.raises(ValueError):
        from_alphanumeric("13A")
