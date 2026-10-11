"""Musical keys: notations, harmonic-wheel compatibility and pitch shifting (SPEC 2.3).

A key is stored as a root pitch class (C = 0 … B = 11) and a mode. The harmonic wheel
numbers keys 1-12 around the circle of fifths: majors are "B", their relative minors
"A" (8B = C major, 8A = A minor). ``app/src/lib/keys.ts`` mirrors this module and both
are tested against ``tests/data/keys_cases.json``.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal

Mode = Literal["major", "minor"]
Notation = Literal["alphanumeric", "open_key", "classical", "classical_flat"]
Relation = Literal[
    "same", "adjacent", "relative", "diagonal", "energy_boost", "semitone_up", "none"
]

NOTATIONS: tuple[Notation, ...] = ("alphanumeric", "open_key", "classical", "classical_flat")

SHARP_NAMES = ("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")
FLAT_NAMES = ("C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B")

# Transition scores between two keys by wheel relation (SPEC 2.3).
SCORES: dict[Relation, float] = {
    "same": 1.0,
    "adjacent": 0.9,
    "relative": 0.85,
    "diagonal": 0.6,
    "energy_boost": 0.55,
    "semitone_up": 0.5,
    "none": 0.0,
}


@dataclass(frozen=True)
class Key:
    root: int
    mode: Mode

    def __post_init__(self) -> None:
        if not 0 <= self.root <= 11:
            raise ValueError(f"root must be 0-11, got {self.root}")
        if self.mode not in ("major", "minor"):
            raise ValueError(f"invalid mode {self.mode!r}")


@dataclass(frozen=True)
class Compatibility:
    score: float
    relation: Relation


def wheel_number(key: Key) -> int:
    """1-12 position on the harmonic wheel (circle of fifths, 8 = C major / A minor)."""
    major_root = key.root if key.mode == "major" else (key.root + 3) % 12
    return (7 * major_root + 7) % 12 + 1


def wheel_letter(key: Key) -> str:
    return "B" if key.mode == "major" else "A"


def from_wheel(number: int, letter: str) -> Key:
    if not 1 <= number <= 12 or letter.upper() not in ("A", "B"):
        raise ValueError(f"invalid wheel position {number}{letter}")
    # Inverse of wheel_number: 7 is its own inverse modulo 12.
    major_root = (7 * (number - 8)) % 12
    if letter.upper() == "B":
        return Key(major_root, "major")
    return Key((major_root + 9) % 12, "minor")


def from_alphanumeric(text: str) -> Key:
    match = re.fullmatch(r"\s*0?(\d{1,2})\s*([ABab])\s*", text)
    if not match:
        raise ValueError(f"not an alphanumeric key: {text!r}")
    return from_wheel(int(match.group(1)), match.group(2))


def format_key(key: Key, notation: Notation) -> str:
    n = wheel_number(key)
    if notation == "alphanumeric":
        return f"{n}{wheel_letter(key)}"
    if notation == "open_key":
        return f"{(n + 4) % 12 + 1}{'d' if key.mode == 'major' else 'm'}"
    names = SHARP_NAMES if notation == "classical" else FLAT_NAMES
    return names[key.root] + ("m" if key.mode == "minor" else "")


_NOTE_VALUES = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
_CLASSICAL = re.compile(
    r"([A-Ga-g])\s*([#♯b♭]?)\s*(m|min|minor|maj|major|dur|moll)?",
    re.IGNORECASE,
)


def parse_key(text: str) -> Key | None:
    """Parse a key written in any supported notation (as found in file tags)."""
    s = text.strip()
    if not s:
        return None
    alnum = re.fullmatch(r"0?(\d{1,2})\s*([ABab])", s)
    if alnum:
        n = int(alnum.group(1))
        return from_wheel(n, alnum.group(2)) if 1 <= n <= 12 else None
    open_key = re.fullmatch(r"0?(\d{1,2})\s*([mdMD])", s)
    if open_key:
        n = int(open_key.group(1))
        if not 1 <= n <= 12:
            return None
        number = (n - 6) % 12 + 1  # inverse of open = ((n + 4) mod 12) + 1
        return from_wheel(number, "A" if open_key.group(2).lower() == "m" else "B")
    classical = _CLASSICAL.fullmatch(s)
    if not classical:
        return None
    letter, accidental, quality = classical.groups()
    # A lone lowercase "b" after a note is a flat, never "B minor" shorthand.
    root = _NOTE_VALUES[letter.upper()]
    if accidental in ("#", "♯"):
        root += 1
    elif accidental in ("b", "♭"):
        root -= 1
    q = (quality or "").lower()
    if q == "m" and quality == "M":
        mode: Mode = "major"  # "CM" is the conventional shorthand for C major
    else:
        mode = "minor" if q in ("m", "min", "minor", "moll") else "major"
    return Key(root % 12, mode)


def compatibility(a: Key, b: Key) -> Compatibility:
    """Score for mixing from key ``a`` into key ``b`` (SPEC 2.3 table)."""
    na, nb = wheel_number(a), wheel_number(b)
    step = (nb - na) % 12
    same_letter = a.mode == b.mode
    relation: Relation
    if same_letter and step == 0:
        relation = "same"
    elif same_letter and step in (1, 11):
        relation = "adjacent"
    elif not same_letter and step == 0:
        relation = "relative"
    elif not same_letter and (
        (a.mode == "minor" and step == 1) or (a.mode == "major" and step == 11)
    ):
        relation = "diagonal"
    elif same_letter and step == 2:
        relation = "energy_boost"
    elif same_letter and step == 7:
        relation = "semitone_up"
    else:
        relation = "none"
    return Compatibility(SCORES[relation], relation)


def shift(key: Key, semitones: int) -> Key:
    """Transpose by ``semitones``: +1 semitone moves +7 on the wheel, same letter."""
    return Key((key.root + semitones) % 12, key.mode)
