"""Audio decoding through the bundled FFmpeg.

Analysis works on mono float32 at 44.1 kHz; stems and previews request stereo.
Mono uses FFmpeg's standard downmix (L and R summed at -3 dB), so correlated material
peaks ~3 dB higher than either channel: loudness and clipping must be measured on the
stereo decode.
FFmpeg is located via ``TONALIA_FFMPEG`` (set by the Rust core), then the repo's
``app/src-tauri/binaries/ffmpeg-<triple>`` (dev, after ``scripts/fetch-binaries``),
then ``PATH``.
"""

from __future__ import annotations

import os
import platform
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np
import numpy.typing as npt

ANALYSIS_SAMPLE_RATE = 44100

AudioArray = npt.NDArray[np.float32]

_REPO_BINARIES = Path(__file__).resolve().parents[2] / "app" / "src-tauri" / "binaries"
_NO_WINDOW = 0x0800_0000 if sys.platform == "win32" else 0  # CREATE_NO_WINDOW


class DecodeError(RuntimeError):
    """The file could not be decoded (missing, corrupt or unsupported)."""


def _target_triple() -> str:
    arch = "aarch64" if platform.machine().lower() in ("arm64", "aarch64") else "x86_64"
    if sys.platform == "darwin":
        return f"{arch}-apple-darwin"
    if sys.platform == "win32":
        return f"{arch}-pc-windows-msvc"
    return f"{arch}-unknown-linux-gnu"


def ffmpeg_path() -> str:
    if env := os.environ.get("TONALIA_FFMPEG"):
        return env
    ext = ".exe" if sys.platform == "win32" else ""
    dev = _REPO_BINARIES / f"ffmpeg-{_target_triple()}{ext}"
    if dev.is_file():
        return str(dev)
    found = shutil.which("ffmpeg")
    if found:
        return found
    raise DecodeError("FFmpeg not found (set TONALIA_FFMPEG or run scripts/fetch-binaries)")


def ffmpeg_local_input(path: Path) -> list[str]:
    """Input arguments that confine FFmpeg to the local file system.

    Untrusted files must never make FFmpeg open the network or other files: the
    explicit ``file:`` prefix stops names like ``http:…``/``concat:…`` (or ones starting
    with ``-``) from being parsed as protocols or options, and the whitelist stops
    playlists (HLS/M3U8, concat) inside a file from reaching remote URLs.
    """
    return ["-protocol_whitelist", "file", "-i", f"file:{path.resolve()}"]


def decode(
    path: Path,
    *,
    sample_rate: int = ANALYSIS_SAMPLE_RATE,
    channels: int = 1,
    start: float | None = None,
    duration: float | None = None,
) -> AudioArray:
    """Decode ``path`` to float32 samples: shape ``(n,)`` for mono, ``(n, channels)`` otherwise."""
    if not path.is_file():
        raise DecodeError(f"file not found: {path}")
    # One decoder thread: tracks are already analysed in parallel processes, and extra
    # decoder threads only spin (FLAC 24-bit decoding took twice as long with them).
    cmd = [ffmpeg_path(), "-nostdin", "-hide_banner", "-loglevel", "error", "-threads", "1"]
    if start is not None:
        cmd += ["-ss", f"{start:.6f}"]
    cmd += ffmpeg_local_input(path)
    if duration is not None:
        cmd += ["-t", f"{duration:.6f}"]
    cmd += ["-vn", "-ac", str(channels), "-ar", str(sample_rate)]
    cmd += ["-f", "f32le", "-c:a", "pcm_f32le", "pipe:1"]
    try:
        proc = subprocess.run(cmd, capture_output=True, check=False, creationflags=_NO_WINDOW)
    except OSError as exc:
        raise DecodeError(f"could not run FFmpeg: {exc}") from exc
    if proc.returncode != 0:
        lines = proc.stderr.decode("utf-8", "replace").strip().splitlines()
        reason = lines[-1] if lines else f"exit code {proc.returncode}"
        raise DecodeError(f"cannot decode {path.name}: {reason}")
    samples = np.frombuffer(proc.stdout, dtype="<f4").astype(np.float32, copy=False)
    if samples.size == 0:
        raise DecodeError(f"no audio stream in {path.name}")
    if channels > 1:
        samples = samples[: samples.size - samples.size % channels].reshape(-1, channels)
    return samples


def downmix(audio: AudioArray) -> AudioArray:
    """Mono exactly as FFmpeg's ``-ac 1`` makes it from stereo: (L + R) / sqrt(2).

    Lets the analysis decode once in stereo (needed for peaks and loudness) and still get
    the same mono samples every analysis stage was calibrated with.
    """
    if audio.ndim == 1:
        return audio
    if audio.shape[1] == 1 or np.array_equal(audio[:, 0], audio[:, 1]):
        # A mono file decoded as stereo is duplicated; FFmpeg would return it unchanged.
        return np.ascontiguousarray(audio[:, 0])
    mono: AudioArray = (audio[:, :2].sum(axis=1) * np.float32(np.sqrt(0.5))).astype(np.float32)
    return mono
