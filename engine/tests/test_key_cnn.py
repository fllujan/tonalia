"""The key network (SPEC 12.1): its input, and numpy inference equal to PyTorch's."""

from importlib import resources

import numpy as np
import pytest
import torch

from tonalia_engine.analysis.chroma import ANALYSIS_SR, magnitude_spectrogram
from tonalia_engine.analysis.key_cnn import (
    INPUT_BINS,
    LOW_MIDI,
    KeyCnn,
    filterbank,
    log_spectrogram,
)
from tools.train_key_cnn import Net, export_arrays


def test_filterbank_covers_every_bin() -> None:
    freqs = np.fft.rfftfreq(8192, 1 / ANALYSIS_SR)
    bank = filterbank(freqs, 440.0, LOW_MIDI, INPUT_BINS)
    assert bank.shape == (len(freqs), INPUT_BINS)
    np.testing.assert_allclose(bank.sum(axis=0), 1.0)
    assert (bank > 0).any(axis=0).all()  # even C2, where the STFT is coarse


@pytest.mark.parametrize("a4", [440.0, 432.0])
def test_a_tone_lands_on_its_note(a4: float) -> None:
    t = np.arange(ANALYSIS_SR * 4) / ANALYSIS_SR
    a3 = a4 / 2  # MIDI 57
    spec, freqs = magnitude_spectrogram(np.sin(2 * np.pi * a3 * t), ANALYSIS_SR)
    x = log_spectrogram(spec, freqs, a4)
    assert x.shape[1] == INPUT_BINS and x.dtype == np.float32
    assert int(x.mean(axis=0).argmax()) == (57 - LOW_MIDI) * 2


def test_numpy_inference_matches_pytorch() -> None:
    torch.manual_seed(3)
    net = Net()
    for m in net.modules():  # non-trivial batch-norm statistics to fold
        if isinstance(m, torch.nn.BatchNorm2d):
            m.running_mean.uniform_(-0.5, 0.5)
            m.running_var.uniform_(0.5, 2.0)
            m.weight.data.uniform_(0.5, 1.5)
            m.bias.data.uniform_(-0.2, 0.2)
    net.eval()
    x = np.random.default_rng(0).normal(size=(57, INPUT_BINS)).astype(np.float32)
    with torch.no_grad():
        expected = net(torch.from_numpy(x)[None])[0].numpy()
    model = KeyCnn.from_arrays(export_arrays(net))
    np.testing.assert_allclose(model.logits(x), expected, rtol=1e-4, atol=1e-4)
    p = model.probabilities(x)
    assert p.shape == (24,) and p.sum() == pytest.approx(1.0)


def test_shipped_weights_are_small_and_load() -> None:
    path = resources.files("tonalia_engine.analysis").joinpath("key_cnn.npz")
    if not path.is_file():
        pytest.skip("weights not trained yet")
    assert len(path.read_bytes()) < 5 * 1024 * 1024
    model = KeyCnn.load()
    assert model is not None and all(len(n.convs) == 5 for n in model.nets)


def test_an_ensemble_averages_its_networks() -> None:
    nets = []
    for seed in (1, 2):
        torch.manual_seed(seed)
        nets.append(Net().eval())
    x = np.random.default_rng(1).normal(size=(40, INPUT_BINS)).astype(np.float32)
    both = KeyCnn.from_arrays(export_arrays(nets, low_midi=40, harmonic=False))
    assert len(both.nets) == 2 and both.low_midi == 40 and not both.harmonic
    singles = [KeyCnn.from_arrays(export_arrays(n)).frame_logits(x) for n in nets]
    np.testing.assert_allclose(both.frame_logits(x), np.mean(singles, axis=0), rtol=1e-5, atol=1e-5)
