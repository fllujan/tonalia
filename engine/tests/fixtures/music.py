"""Synthetic tonal music for analysis tests (SPEC §5: no copyrighted audio).

``progression`` renders a looping chord progression in a given key with additive
harmonic tones, a bass line and a short scale melody, optionally detuned (e.g. A=432)
and preceded by a drums-only intro (noise bursts and a sine "kick").
"""

from __future__ import annotations

import numpy as np
import numpy.typing as npt

from tonalia_engine.keys import Key

SR = 44100
F32 = npt.NDArray[np.float32]

# Scale degrees (semitones from the tonic) and chord progressions.
MAJOR_SCALE = (0, 2, 4, 5, 7, 9, 11)
MINOR_SCALE = (0, 2, 3, 5, 7, 8, 10)
# Cadential progressions (I IV V I / i iv V i): unambiguous tonal material. A loop such as
# I vi IV V is genuinely ambiguous with the relative minor and is not used for assertions.
MAJOR_PROGRESSION = ((0, 4, 7), (5, 9, 12), (7, 11, 14), (0, 4, 7))
MINOR_PROGRESSION = ((0, 3, 7), (5, 8, 12), (7, 11, 14), (0, 3, 7))


def midi_to_hz(midi: float, a4: float = 440.0) -> float:
    return float(a4 * 2.0 ** ((midi - 69) / 12))


def tone(freq: float, seconds: float, sr: int = SR, harmonics: int = 6, amp: float = 0.2) -> F32:
    t = np.arange(int(seconds * sr)) / sr
    out = np.zeros_like(t)
    for h in range(1, harmonics + 1):
        if freq * h < sr / 2:
            out += (0.7 ** (h - 1)) * np.sin(2 * np.pi * freq * h * t)
    envelope = np.minimum(1.0, t / 0.02) * np.minimum(1.0, (seconds - t) / 0.05)
    result: F32 = (amp * out * envelope).astype(np.float32)
    return result


def drums(seconds: float, bpm: float = 124.0, sr: int = SR, seed: int = 0) -> F32:
    """Kick on every beat and noisy hats on off-beats: no pitched content."""
    rng = np.random.default_rng(seed)
    out = np.zeros(int(seconds * sr), dtype=np.float32)
    beat = 60.0 / bpm
    kick_t = np.arange(int(0.25 * sr)) / sr
    kick = (np.sin(2 * np.pi * 55 * kick_t * np.exp(-kick_t * 8)) * np.exp(-kick_t * 18)).astype(
        np.float32
    )
    hat = (rng.standard_normal(int(0.05 * sr)) * np.exp(-np.arange(int(0.05 * sr)) / 400)).astype(
        np.float32
    )
    for i in range(int(seconds / beat)):
        start = int(i * beat * sr)
        out[start : start + len(kick)] += 0.6 * kick[: len(out) - start]
        off = int((i + 0.5) * beat * sr)
        if off < len(out):
            out[off : off + len(hat)] += 0.15 * hat[: len(out) - off]
    return out


def progression(
    key: Key,
    seconds: float = 32.0,
    *,
    a4: float = 440.0,
    chord_seconds: float = 2.0,
    drum_intro: float = 0.0,
    with_drums: bool = False,
    sr: int = SR,
) -> F32:
    tonic = 48 + key.root  # C3 + root
    chords = MAJOR_PROGRESSION if key.mode == "major" else MINOR_PROGRESSION
    scale = MAJOR_SCALE if key.mode == "major" else MINOR_SCALE
    parts: list[F32] = []
    n_chords = max(1, int(seconds / chord_seconds))
    for i in range(n_chords):
        chord = chords[i % len(chords)]
        seg = np.zeros(int(chord_seconds * sr), dtype=np.float32)
        for interval in chord:
            seg += tone(midi_to_hz(tonic + interval, a4), chord_seconds, sr)
        seg += tone(midi_to_hz(tonic - 12 + chord[0], a4), chord_seconds, sr, amp=0.25)
        # Melody: two scale notes per chord, walking up the scale.
        for j in range(2):
            degree = scale[(2 * i + j) % len(scale)]
            note = tone(midi_to_hz(tonic + 12 + degree, a4), chord_seconds / 2, sr, amp=0.12)
            start = int(j * chord_seconds / 2 * sr)
            seg[start : start + len(note)] += note
        parts.append(seg)
    music = np.concatenate(parts)
    if with_drums:
        music += drums(len(music) / sr, sr=sr)
    if drum_intro > 0:
        music = np.concatenate([drums(drum_intro, sr=sr), music])
    peak = float(np.max(np.abs(music))) or 1.0
    return (0.8 * music / peak).astype(np.float32)
