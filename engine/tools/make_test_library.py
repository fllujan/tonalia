"""Generate a synthetic music library for import tests and manual QA.

Files are short sine tones (no copyrighted audio), tagged with invented titles and
artists (DESIGN.md §8) and named with accents, emojis and spaces to exercise path
handling. Every file has distinct content, so none is treated as a duplicate.

    uv run python -m tools.make_test_library ~/Música\\ de\\ prueba --count 1000
"""

from __future__ import annotations

import argparse
import shutil
import tempfile
from dataclasses import dataclass
from pathlib import Path

from mutagen.flac import FLAC
from mutagen.id3 import ID3, TCON, TIT2, TPE1
from mutagen.mp3 import MP3
from mutagen.mp4 import MP4

from tests.fixtures.generate import encode, write_tone_wav

TITLES = [
    ("Midnight Bloom", "Lumen Drift", "Melodic House"),
    ("Golden Hour Tide", "Sora Vela", "Deep House"),
    ("Neon Cathedral", "Kairo", "Techno"),
    ("Velvet Static", "Mara Ion", "Organic House"),
    ("Heatwave Protocol", "Duo Arcadia", "Tech House"),
    ("Paper Satellites", "Ines Halo", "Downtempo"),
    ("Run The Signal (Acapella)", "Nova Reign", "Acapella"),
    ("Sunset Engine", "The Quiet Orbit", "Progressive"),
    ("Cobalt Rain", "Eli Marsh", "Drum & Bass"),
    ("Last Train To Lisbon", "Amaro", "Afro House"),
]
FOLDERS = [
    "Bolos 🌅",
    "Peak time 🔥",
    "Cierre 🌙",
    "Radio 🎙️/Show semanal",
    "Por probar 🧪",
    "Vinilos ñ",
]
FORMATS = ["flac", "mp3", "m4a"]


@dataclass
class GeneratedTrack:
    path: Path
    title: str
    artist: str
    genre: str


def _tag(path: Path, fmt: str, title: str, artist: str, genre: str) -> None:
    if fmt == "flac":
        flac = FLAC(path)
        flac["title"], flac["artist"], flac["genre"] = title, artist, genre
        flac.save()
    elif fmt == "mp3":
        mp3 = MP3(path)
        if mp3.tags is None:
            mp3.add_tags()
        tags = mp3.tags
        assert isinstance(tags, ID3)
        tags.add(TIT2(encoding=3, text=title))
        tags.add(TPE1(encoding=3, text=artist))
        tags.add(TCON(encoding=3, text=genre))
        mp3.save()
    else:
        mp4 = MP4(path)
        mp4["\xa9nam"], mp4["\xa9ART"], mp4["\xa9gen"] = title, artist, genre
        mp4.save()


def make_library(root: Path, count: int, seconds: float = 0.2) -> list[GeneratedTrack]:
    with tempfile.TemporaryDirectory() as tmp:
        source = write_tone_wav(Path(tmp) / "tone.wav", seconds=seconds, channels=1)
        templates = {fmt: encode(source, Path(tmp) / f"t.{fmt}", fmt) for fmt in FORMATS}
        tracks: list[GeneratedTrack] = []
        for i in range(count):
            title, artist, genre = TITLES[i % len(TITLES)]
            title = f"{title} #{i + 1:04d}"
            artist = f"{artist} ñ" if i % 7 == 0 else artist
            fmt = FORMATS[i % len(FORMATS)]
            folder = root / FOLDERS[i % len(FOLDERS)]
            folder.mkdir(parents=True, exist_ok=True)
            # The en dash is deliberate: real file names are full of non-ASCII punctuation.
            dest = folder / f"{i + 1:04d} - {artist} – {title} 🎵.{fmt}"  # noqa: RUF001
            shutil.copyfile(templates[fmt], dest)
            _tag(dest, fmt, title, artist, genre)  # unique tags -> unique content hash
            tracks.append(GeneratedTrack(dest, title, artist, genre))
        return tracks


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("out", type=Path)
    parser.add_argument("--count", type=int, default=1000)
    parser.add_argument("--seconds", type=float, default=0.2)
    args = parser.parse_args()
    tracks = make_library(args.out, args.count, args.seconds)
    print(f"Wrote {len(tracks)} files under {args.out}")


if __name__ == "__main__":
    main()
