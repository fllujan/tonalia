"""Synthetic library for the end-to-end smoke test (SPEC 8 acceptance).

``python -m tests.fixtures.e2e <folder>`` writes a few FLAC tracks with known keys and
tempos (chords + drum loop, generated here: no copyrighted audio). Names carry accents
and an emoji on purpose.
"""

from __future__ import annotations

import io
import sys
import wave
from pathlib import Path

import numpy as np

from tests.fixtures.generate import encode
from tests.fixtures.music import SR, progression
from tests.fixtures.rhythm import click_track
from tonalia_engine.keys import Key

TRACKS: list[tuple[str, Key, float]] = [
    ("Noche en La menor 🌙", Key(9, "minor"), 124.0),  # 8A: deck A
    ("Mi menor — subida", Key(4, "minor"), 124.0),  # 9A: ±1 on the wheel
    ("Do mayor relativo", Key(0, "major"), 124.0),  # 8B: relative
    ("Fa sostenido lejano", Key(6, "major"), 124.0),  # 2B: only with a key change
]
SECONDS = 64.0


def write(folder: Path, title: str, key: Key, bpm: float) -> Path:
    music = progression(key, SECONDS)
    drums = click_track(bpm, SECONDS)
    audio = np.clip(0.5 * music + 0.6 * drums[: len(music)], -1, 1)
    wav = folder / f"{title}.wav"
    with wave.open(str(wav), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((audio * 32767).astype("<i2").tobytes())
    out = encode(wav, folder / f"{title}.flac", "flac")
    wav.unlink()
    return out


def main(folder: Path) -> None:
    # The paths carry emoji; a Windows console would encode them as cp1252.
    if isinstance(sys.stdout, io.TextIOWrapper):
        sys.stdout.reconfigure(encoding="utf-8")
    folder.mkdir(parents=True, exist_ok=True)
    for title, key, bpm in TRACKS:
        print(write(folder, title, key, bpm))


if __name__ == "__main__":
    main(Path(sys.argv[1]))
