"""Key detection with a small convolutional network (SPEC 12.1), run in numpy.

Input: a log-frequency spectrogram with two bins per semitone over four octaves (C2-C6),
tuning-compensated, made from the harmonic spectrogram the key analysis already computes
(11 025 Hz, ~5.4 frames/s), log-compressed and standardized per track.

Network (after Korzeniowski & Widmer, "Genre-agnostic key classification with
convolutional neural networks", ISMIR 2018): five 5x5 convolutions with 8 channels, a
convolution over the whole frequency axis, a 1x1 convolution to the 24 keys and the mean
over time. Several such networks trained with different seeds are averaged.
Batch normalization is folded into the convolutions when the weights are
exported, so inference is only convolutions, ELUs and a mean.

The weights (``key_cnn.npz``) are trained by ``tools/train_key_cnn.py`` on
GiantSteps-MTG-Key with transposition augmentation; GiantSteps Key stays a test set.
"""

from __future__ import annotations

from dataclasses import dataclass
from importlib import resources

import numpy as np
import numpy.typing as npt

from .chroma import FloatArray

BINS_PER_SEMITONE = 2
LOW_MIDI = 36  # C2, the lowest note of the network's input
OCTAVES = 4
INPUT_BINS = 12 * OCTAVES * BINS_PER_SEMITONE  # 96
# Training needs the same spectrogram shifted up to ±6 semitones (transposition
# augmentation), so the features it caches span 6 more semitones on each side.
MAX_SHIFT = 6

Float32Array = npt.NDArray[np.float32]


def filterbank(freqs: FloatArray, a4: float, low_midi: int, n_bins: int) -> FloatArray:
    """Triangular filters on a log axis, ``n_bins`` half-semitones from ``low_midi``.

    Each filter falls to zero at its neighbours' centres. Where the STFT is too coarse for
    a filter to contain any bin (the lowest notes), it interpolates the two nearest bins,
    so no input bin is ever empty. Shape (len(freqs), n_bins), each column sums to 1.
    """
    step = 1.0 / BINS_PER_SEMITONE
    midi = low_midi + step * np.arange(n_bins)
    centres = a4 * 2.0 ** ((midi - 69.0) / 12.0)
    safe = np.maximum(freqs, 1e-6)
    distance = np.abs(12.0 * np.log2(safe[:, None] / centres[None, :])) / step  # in bins
    bank = np.maximum(0.0, 1.0 - distance)
    bank[freqs <= 0] = 0.0
    for j in np.nonzero(bank.sum(axis=0) <= 1e-9)[0]:
        hi = int(np.searchsorted(freqs, centres[j]))
        hi = min(max(hi, 1), len(freqs) - 1)
        lo = hi - 1
        t = (centres[j] - freqs[lo]) / max(freqs[hi] - freqs[lo], 1e-9)
        bank[lo, j], bank[hi, j] = 1.0 - t, t
    out: FloatArray = bank / bank.sum(axis=0, keepdims=True)
    return out


def log_spectrogram(
    spec: FloatArray,
    freqs: FloatArray,
    a4: float,
    low_midi: int = LOW_MIDI,
    n_bins: int = INPUT_BINS,
) -> Float32Array:
    """The network's input for a magnitude spectrogram: (frames, n_bins), standardized."""
    x = np.log1p(spec @ filterbank(freqs, a4, low_midi, n_bins))
    x = (x - x.mean()) / (x.std() + 1e-6)
    out: Float32Array = x.astype(np.float32)
    return out


def _elu(x: Float32Array) -> Float32Array:
    out: Float32Array = np.where(x > 0, x, np.expm1(np.minimum(x, 0))).astype(np.float32)
    return out


def _conv_same(x: Float32Array, weight: Float32Array, bias: Float32Array) -> Float32Array:
    """'Same' 2-D convolution of (T, F, Cin) with (kh, kw, Cin, Cout), in time chunks."""
    kh, kw, cin, cout = weight.shape
    ph, pw = kh // 2, kw // 2
    padded = np.pad(x, ((ph, ph), (pw, pw), (0, 0)))
    w = weight.reshape(kh * kw * cin, cout)
    t, f = x.shape[0], x.shape[1]
    out = np.empty((t, f, cout), dtype=np.float32)
    chunk = max(1, 65536 // max(f, 1))
    for start in range(0, t, chunk):
        stop = min(t, start + chunk)
        block = padded[start : stop + 2 * ph]
        # (T', F, Cin, kh, kw) view -> rows of (kh, kw, Cin) patches.
        patches = np.lib.stride_tricks.sliding_window_view(block, (kh, kw), axis=(0, 1))
        patches = patches.transpose(0, 1, 3, 4, 2).reshape(-1, kh * kw * cin)
        out[start:stop] = (patches @ w + bias).reshape(stop - start, f, cout)
    return out


@dataclass(frozen=True)
class KeyNet:
    """One trained network: folded conv weights as (kh, kw, Cin, Cout) and biases."""

    convs: tuple[tuple[Float32Array, Float32Array], ...]
    dense: tuple[Float32Array, Float32Array]  # whole-frequency conv: (F, Cin, H), (H,)
    head: tuple[Float32Array, Float32Array]  # 1x1 conv to the keys: (H, 24), (24,)

    @property
    def n_bins(self) -> int:
        return int(self.dense[0].shape[0])

    @classmethod
    def from_arrays(cls, arrays: dict[str, npt.NDArray[np.floating]], prefix: str = "") -> KeyNet:
        n = sum(1 for name in arrays if name.startswith(f"{prefix}conv") and name.endswith("_w"))

        def pair(name: str) -> tuple[Float32Array, Float32Array]:
            w = np.asarray(arrays[f"{prefix}{name}_w"], dtype=np.float32)
            b = np.asarray(arrays[f"{prefix}{name}_b"], dtype=np.float32)
            return w, b

        return cls(tuple(pair(f"conv{i}") for i in range(n)), pair("dense"), pair("head"))

    def frame_logits(self, spectrogram: Float32Array) -> Float32Array:
        x = spectrogram[:, :, None].astype(np.float32)
        for w, b in self.convs:
            x = _elu(_conv_same(x, w, b))
        dense_w, dense_b = self.dense
        h = _elu(np.einsum("tfc,fch->th", x, dense_w).astype(np.float32) + dense_b)
        head_w, head_b = self.head
        out: Float32Array = (h @ head_w + head_b).astype(np.float32)
        return out


@dataclass(frozen=True)
class KeyCnn:
    """The shipped model: one or more networks trained with different seeds, averaged."""

    nets: tuple[KeyNet, ...]
    low_midi: int = LOW_MIDI  # lowest note of the input, saved with the weights
    harmonic: bool = True  # input from the harmonic part (HPSS) or the whole spectrum

    @property
    def n_bins(self) -> int:
        """Half-semitone bins of the input (from ``low_midi`` up)."""
        return self.nets[0].n_bins

    def spectrogram(self, spec: FloatArray, freqs: FloatArray, a4: float) -> Float32Array:
        """This model's input for a magnitude spectrogram."""
        return log_spectrogram(spec, freqs, a4, self.low_midi, self.n_bins)

    @classmethod
    def from_arrays(cls, arrays: dict[str, npt.NDArray[np.floating]]) -> KeyCnn:
        """Weights as ``export_arrays`` writes them: ``m0_conv0_w``… (or unprefixed, one net)."""
        low = int(np.asarray(arrays["low_midi"])) if "low_midi" in arrays else LOW_MIDI
        harmonic = bool(np.asarray(arrays["harmonic"])) if "harmonic" in arrays else True
        if "members" not in arrays:
            return cls((KeyNet.from_arrays(arrays),), low, harmonic)
        n = int(np.asarray(arrays["members"]))
        nets = tuple(KeyNet.from_arrays(arrays, f"m{j}_") for j in range(n))
        return cls(nets, low, harmonic)

    @classmethod
    def load(cls) -> KeyCnn | None:
        path = resources.files(__package__).joinpath("key_cnn.npz")
        if not path.is_file():
            return None
        with path.open("rb") as f, np.load(f) as data:
            return cls.from_arrays({name: data[name] for name in data.files})

    def frame_logits(self, spectrogram: Float32Array) -> Float32Array:
        """Per-frame scores of the 24 keys for a (frames, n_bins) input: (frames, 24).

        The model's decision is their mean over the track; the mean over a window
        gives that window's (for key changes)."""
        out: Float32Array = np.mean(
            [net.frame_logits(spectrogram) for net in self.nets], axis=0
        ).astype(np.float32)
        return out

    def logits(self, spectrogram: Float32Array) -> Float32Array:
        """Scores of the 24 keys (ALL_KEYS order) for a (frames, n_bins) input."""
        out: Float32Array = self.frame_logits(spectrogram).mean(axis=0)
        return out

    def probabilities(self, spectrogram: Float32Array) -> FloatArray:
        return softmax(self.logits(spectrogram))


def softmax(logits: npt.NDArray[np.floating]) -> FloatArray:
    z = np.asarray(logits, dtype=np.float64)
    z = z - z.max(axis=-1, keepdims=True)
    e = np.exp(z)
    out: FloatArray = e / e.sum(axis=-1, keepdims=True)
    return out


def combine(first: FloatArray, second: FloatArray, weight: float) -> FloatArray:
    """Weighted product of two key distributions (``weight`` for ``second``), normalized.

    Both have to agree for the result to be confident: a key one of them rules out
    stays unlikely."""
    eps = 1e-6
    z = (1.0 - weight) * np.log(first + eps) + weight * np.log(second + eps)
    return softmax(z)
