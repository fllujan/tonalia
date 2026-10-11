"""Synthetic audio fixtures (never commit real audio).

``write_tone_wav`` writes a sine tone as 16-bit PCM WAV using only the stdlib;
``encode`` transcodes it with the bundled FFmpeg into every supported format.
Run directly to materialize the fixtures into a folder for manual inspection:

    uv run python -m tests.fixtures.generate /tmp/tonalia-fixtures
"""

from __future__ import annotations

import subprocess
import sys
import wave
from pathlib import Path

import numpy as np

from tonalia_engine.audio_io import ffmpeg_path

# extension -> FFmpeg encoder arguments
FORMATS: dict[str, list[str]] = {
    "wav": ["-c:a", "pcm_s16le"],
    "aiff": ["-c:a", "pcm_s16be"],
    "flac": ["-c:a", "flac"],
    "mp3": ["-c:a", "libmp3lame", "-b:a", "192k"],
    "m4a": ["-c:a", "aac", "-b:a", "192k"],
    "alac.m4a": ["-c:a", "alac"],
    "ogg": ["-c:a", "libvorbis", "-q:a", "5"],
}

# Fallback encoders for FFmpeg builds without the external libraries.
FALLBACKS: dict[str, list[str]] = {
    "ogg": ["-c:a", "vorbis", "-strict", "experimental", "-ac", "2"],
}


def write_tone_wav(
    path: Path,
    freq: float = 440.0,
    seconds: float = 2.0,
    sample_rate: int = 44100,
    channels: int = 2,
    amplitude: float = 0.5,
) -> Path:
    t = np.arange(int(seconds * sample_rate)) / sample_rate
    mono = amplitude * np.sin(2 * np.pi * freq * t)
    frames = np.repeat(mono[:, None], channels, axis=1)
    pcm = (frames * 32767).astype("<i2")
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(channels)
        w.setsampwidth(2)
        w.setframerate(sample_rate)
        w.writeframes(pcm.tobytes())
    return path


def encode(source: Path, dest: Path, fmt: str) -> Path:
    base = [
        ffmpeg_path(),
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        str(source),
    ]
    result = subprocess.run([*base, *FORMATS[fmt], str(dest)], capture_output=True, text=True)
    if result.returncode != 0 and fmt in FALLBACKS:
        result = subprocess.run([*base, *FALLBACKS[fmt], str(dest)], capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg could not encode {fmt}: {result.stderr.strip()}")
    return dest


def make_all(folder: Path, stem: str = "tono 440 Hz ñ 🎧", freq: float = 440.0) -> dict[str, Path]:
    source = write_tone_wav(folder / f"{stem}.source.wav", freq=freq)
    return {fmt: encode(source, folder / f"{stem}.{fmt}", fmt) for fmt in FORMATS}


if __name__ == "__main__":
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "fixtures-out")
    for fmt, path in make_all(out).items():
        print(f"{fmt:9} {path}")
