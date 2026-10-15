"""Train the key network (``analysis/key_cnn.npz``, SPEC 12.1).

Trains on GiantSteps-MTG-Key (manual keys with confidence 2), disjoint from GiantSteps Key,
which stays an untouched test set (``tools.eval_key --giantsteps``). Each example is a
random excerpt of a track, transposed by -6..+6 semitones (the crop moves along the wider
cached spectrogram and the label rotates with it). PyTorch, already in the engine for the
stems, is only needed here: the app runs the exported weights in numpy.

    uv run python -m tools.fetch_datasets mtg-key
    uv run python -m tools.train_key_cnn --cv       # 5-fold CV report on MTG-Key
    uv run python -m tools.train_key_cnn            # train on all of it, write the weights

Features are cached in ``datasets/cache/`` (git-ignored); the audio never enters the repo.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from dataclasses import dataclass
from functools import partial
from importlib import resources
from pathlib import Path
from typing import Any

import numpy as np
import torch
from torch import nn

from tonalia_engine.analysis.chroma import magnitude_spectrogram
from tonalia_engine.analysis.key import ALL_KEYS, KeyModel, KeyWeights, tonal_frames
from tonalia_engine.analysis.key_cnn import (
    BINS_PER_SEMITONE,
    LOW_MIDI,
    MAX_SHIFT,
    OCTAVES,
    KeyCnn,
    combine,
    log_spectrogram,
)
from tonalia_engine.audio_io import ANALYSIS_SAMPLE_RATE, DecodeError, decode
from tonalia_engine.keys import Key

from .evaluation import MIREX_WEIGHTS, ROOT, mirex_category, run_parallel
from .train_key import fit, track_features, training_refs

CACHE = ROOT / "datasets" / "cache"
CHANNELS = 8
CONVS = 5
HIDDEN = 48
CROP = 160  # frames (~30 s)
SEED = 0


# ---- features ----


@dataclass(frozen=True)
class Input:
    """The network's input range: ``octaves`` from ``low_midi`` (two bins per semitone)."""

    low_midi: int = LOW_MIDI
    octaves: int = OCTAVES
    harmonic: bool = True

    @property
    def bins(self) -> int:
        return 12 * self.octaves * BINS_PER_SEMITONE

    @property
    def wide_low(self) -> int:
        return self.low_midi - MAX_SHIFT

    @property
    def wide_bins(self) -> int:
        return self.bins + 2 * MAX_SHIFT * BINS_PER_SEMITONE


DEFAULT_INPUT = Input()


def wide_spectrogram(path: Path, inp: Input = DEFAULT_INPUT) -> np.ndarray | None:
    """The cached input of a track, ±6 semitones wider than the network's, float16."""
    try:
        audio = decode(path)
    except DecodeError:
        return None
    tf = tonal_frames(audio, ANALYSIS_SAMPLE_RATE, KeyWeights.load().min_harmonic_ratio)
    if tf is None:
        return None
    spec = tf.harmonic
    if not inp.harmonic:
        spec, _ = magnitude_spectrogram(audio, ANALYSIS_SAMPLE_RATE)
    x = log_spectrogram(spec, tf.freqs, tf.tuning_hz, inp.wide_low, inp.wide_bins)
    return x.astype(np.float16)


def cached_features(
    name: str, refs: list[tuple[Path, Key]], workers: int | None, inp: Input
) -> tuple[list[np.ndarray], list[Key], list[str]]:
    """Inputs, keys and paths of the tracks that have tonal content (cached)."""
    kind = "" if inp.harmonic else "_full"
    path = CACHE / f"key_cnn_{name}{kind}_{inp.wide_low}_{inp.wide_bins}.npz"
    if path.is_file():
        with np.load(path) as data:
            n = int(data["count"])
            specs = [data[f"x{i}"] for i in range(n)]
            keys = [ALL_KEYS[int(i)] for i in data["labels"]]
            paths = [str(x) for x in data["paths"]]
        return specs, keys, paths
    started = time.time()
    feats = run_parallel(partial(wide_spectrogram, inp=inp), [p for p, _ in refs], workers)
    kept = [(f, k, str(p)) for f, (p, k) in zip(feats, refs, strict=True) if f is not None]
    CACHE.mkdir(parents=True, exist_ok=True)
    np.savez(
        path,
        count=len(kept),
        labels=np.array([ALL_KEYS.index(k) for _, k, _ in kept]),
        paths=np.array([p for _, _, p in kept]),
        **{f"x{i}": f for i, (f, _, _) in enumerate(kept)},  # type: ignore[arg-type]
    )
    print(f"{name}: {len(kept)} tracks cached in {time.time() - started:.0f} s")
    return [f for f, _, _ in kept], [k for _, k, _ in kept], [p for _, _, p in kept]


def cached_profiles(refs: list[tuple[Path, Key]], workers: int | None) -> dict[str, np.ndarray]:
    """Learned-profile features of each track (``tools.train_key``), by path (cached)."""
    path = CACHE / "key_profiles_mtg.npz"
    if path.is_file():
        with np.load(path) as data:
            return dict(zip([str(x) for x in data["paths"]], data["features"], strict=True))
    feats = run_parallel(track_features, [p for p, _ in refs], workers)
    kept = {str(p): np.asarray(f) for (p, _), f in zip(refs, feats, strict=True) if f is not None}
    np.savez(path, paths=np.array(list(kept)), features=np.stack(list(kept.values())))
    return kept


# ---- model ----


class Net(nn.Module):
    """Conv(5x5, 8) x5 -> conv over all frequencies -> 1x1 to 24 -> mean over time."""

    def __init__(self, channels: int = CHANNELS, n_bins: int = 12 * OCTAVES * 2) -> None:
        super().__init__()
        layers: list[nn.Module] = []
        cin = 1
        for _ in range(CONVS):
            layers += [nn.Conv2d(cin, channels, 5, padding=2), nn.BatchNorm2d(channels), nn.ELU()]
            cin = channels
        self.convs = nn.Sequential(*layers)
        self.dense = nn.Sequential(
            nn.Dropout(0.3),
            nn.Conv2d(channels, HIDDEN, (1, n_bins)),
            nn.BatchNorm2d(HIDDEN),
            nn.ELU(),
            nn.Dropout(0.3),
        )
        self.head = nn.Conv2d(HIDDEN, 24, 1)

    def forward(self, x: torch.Tensor) -> torch.Tensor:  # (B, T, F) -> (B, 24)
        z: torch.Tensor = self.head(self.dense(self.convs(x[:, None])))  # (B, 24, T, 1)
        return z.mean(dim=(2, 3))


def _fold(conv: nn.Conv2d, bn: nn.BatchNorm2d) -> tuple[np.ndarray, np.ndarray]:
    assert conv.bias is not None and bn.running_var is not None and bn.running_mean is not None
    scale = (bn.weight / torch.sqrt(bn.running_var + bn.eps)).detach()
    w = conv.weight.detach() * scale[:, None, None, None]
    b = (conv.bias.detach() - bn.running_mean) * scale + bn.bias.detach()
    return w.cpu().numpy(), b.cpu().numpy()


def export_arrays(
    nets: Net | list[Net], low_midi: int = LOW_MIDI, harmonic: bool = True
) -> dict[str, np.ndarray]:
    """Folded weights in the layout ``KeyCnn`` reads: ``m{j}_`` per network."""
    members = [nets] if isinstance(nets, Net) else nets
    out: dict[str, np.ndarray] = {
        "low_midi": np.asarray(low_midi),
        "harmonic": np.asarray(harmonic),
        "members": np.asarray(len(members)),
    }
    for j, net in enumerate(members):
        out.update({f"m{j}_{k}": v for k, v in _net_arrays(net).items()})
    return out


def _net_arrays(net: Net) -> dict[str, np.ndarray]:
    """One network's folded weights (conv as (kh, kw, Cin, Cout))."""
    net = net.cpu().eval()
    out: dict[str, np.ndarray] = {}
    mods = list(net.convs)
    for i in range(CONVS):
        conv, bn = mods[3 * i], mods[3 * i + 1]
        assert isinstance(conv, nn.Conv2d) and isinstance(bn, nn.BatchNorm2d)
        w, b = _fold(conv, bn)
        out[f"conv{i}_w"] = w.transpose(2, 3, 1, 0).astype(np.float32)
        out[f"conv{i}_b"] = b.astype(np.float32)
    dconv, dbn = net.dense[1], net.dense[2]
    assert isinstance(dconv, nn.Conv2d) and isinstance(dbn, nn.BatchNorm2d)
    w, b = _fold(dconv, dbn)  # (H, Cin, 1, F)
    out["dense_w"] = w[:, :, 0, :].transpose(2, 1, 0).astype(np.float32)  # (F, Cin, H)
    out["dense_b"] = b.astype(np.float32)
    head = net.head
    out["head_w"] = head.weight.detach().numpy()[:, :, 0, 0].T.astype(np.float32)  # (H, 24)
    assert head.bias is not None
    out["head_b"] = head.bias.detach().numpy().astype(np.float32)
    return out


# ---- training ----


def _window(spec: np.ndarray, lo: int, n_bins: int) -> np.ndarray:
    """The network's input from a cached wide spectrogram, standardized as at inference.

    ``log_spectrogram`` standardizes over the bins it computes, so a slice of the wider
    cache is standardized again over the whole track (the cache is an affine map of the
    same log spectrum, so this gives exactly what the app computes)."""
    x = spec[:, lo : lo + n_bins].astype(np.float32)
    out: np.ndarray = (x - x.mean()) / (x.std() + 1e-6)
    return out


def _crop(
    spec: np.ndarray, label: int, rng: np.random.Generator, n_bins: int
) -> tuple[np.ndarray, int]:
    shift = int(rng.integers(-MAX_SHIFT, MAX_SHIFT + 1))
    lo = (MAX_SHIFT + shift) * BINS_PER_SEMITONE
    frames = spec.shape[0]
    start = int(rng.integers(0, max(1, frames - CROP + 1)))
    x = _window(spec, lo, n_bins)[start : start + CROP]
    if x.shape[0] < CROP:
        x = np.pad(x, ((0, CROP - x.shape[0]), (0, 0)), mode="wrap")
    mode, root = divmod(label, 12)
    # The crop starts `shift` semitones higher, so the music reads `shift` semitones lower.
    return x, mode * 12 + (root - shift) % 12


def train(
    specs: list[np.ndarray],
    labels: np.ndarray,
    epochs: int,
    device: str,
    seed: int = SEED,
    log: bool = True,
    channels: int = CHANNELS,
) -> Net:
    torch.manual_seed(seed)
    rng = np.random.default_rng(seed)
    n_bins = specs[0].shape[1] - 2 * MAX_SHIFT * BINS_PER_SEMITONE
    net = Net(channels, n_bins).to(device)
    opt = torch.optim.AdamW(net.parameters(), lr=2e-3, weight_decay=1e-3)
    steps_per_epoch = max(1, len(specs) // 16)
    sched = torch.optim.lr_scheduler.OneCycleLR(
        opt, max_lr=2e-3, total_steps=epochs * steps_per_epoch
    )
    loss_fn = nn.CrossEntropyLoss(label_smoothing=0.05)
    for epoch in range(epochs):
        net.train()
        order = rng.permutation(len(specs))
        total = 0.0
        for s in range(steps_per_epoch):
            idx = order[s * 16 : (s + 1) * 16]
            batch = [_crop(specs[i], int(labels[i]), rng, n_bins) for i in idx]
            x = torch.from_numpy(np.stack([b[0] for b in batch])).to(device)
            y = torch.tensor([b[1] for b in batch], device=device)
            opt.zero_grad()
            loss = loss_fn(net(x), y)
            loss.backward()
            opt.step()
            sched.step()
            total += float(loss.detach())
        if log and (epoch + 1) % 10 == 0:
            print(f"  epoch {epoch + 1}/{epochs} loss {total / steps_per_epoch:.3f}", flush=True)
    return net.cpu().eval()


def train_ensemble(
    specs: list[np.ndarray],
    labels: np.ndarray,
    epochs: int,
    device: str,
    seeds: int = 1,
    channels: int = CHANNELS,
    log: bool = False,
) -> list[Net]:
    """``seeds`` networks that differ only in their seed (averaged by ``KeyCnn``)."""
    return [
        train(specs, labels, epochs, device, seed=SEED + j, log=log, channels=channels)
        for j in range(seeds)
    ]


def predict(model: KeyCnn, spec: np.ndarray) -> int:
    x = _window(spec, MAX_SHIFT * BINS_PER_SEMITONE, model.n_bins)
    return int(np.argmax(model.logits(x)))


def mirex(model: KeyCnn, specs: list[np.ndarray], keys: list[Key]) -> float:
    hits = [
        MIREX_WEIGHTS[mirex_category(ALL_KEYS[predict(model, s)], k)]
        for s, k in zip(specs, keys, strict=True)
    ]
    return float(np.mean(hits))


def cross_validate(
    specs: list[np.ndarray],
    keys: list[Key],
    epochs: int,
    device: str,
    folds: int = 5,
    channels: int = CHANNELS,
    seeds: int = 1,
    extra: tuple[list[np.ndarray], list[Key]] = ([], []),
) -> float:
    """Mean MIREX over the folds; ``extra`` tracks only ever join the training folds."""
    labels = np.array([ALL_KEYS.index(k) for k in keys])
    extra_labels = np.array([ALL_KEYS.index(k) for k in extra[1]], dtype=int)
    order = np.random.default_rng(1).permutation(len(keys))
    scores = []
    for f in range(folds):
        val = order[f::folds]
        train_idx = np.setdiff1d(order, val)
        nets = train_ensemble(
            [specs[i] for i in train_idx] + extra[0],
            np.concatenate([labels[train_idx], extra_labels]),
            epochs,
            device,
            seeds,
            channels,
        )
        val_specs, val_keys = [specs[i] for i in val], [keys[i] for i in val]
        score = mirex(KeyCnn.from_arrays(export_arrays(nets)), val_specs, val_keys)
        single = mirex(KeyCnn.from_arrays(export_arrays(nets[0])), val_specs, val_keys)
        print(f"  fold {f + 1}/{folds}: MIREX {score:.3f} (one network {single:.3f})", flush=True)
        scores.append(score)
    return float(np.mean(scores))


def out_of_fold(
    specs: list[np.ndarray],
    profiles: np.ndarray,
    keys: list[Key],
    epochs: int,
    device: str,
    folds: int = 5,
    channels: int = CHANNELS,
    seeds: int = 1,
) -> tuple[np.ndarray, np.ndarray]:
    """Held-out probabilities of both models for every track: (network, learned profiles).

    The same folds for both, so the combination weight is chosen on tracks neither model
    was trained on (GiantSteps Key is never used for that)."""
    labels = np.array([ALL_KEYS.index(k) for k in keys])
    order = np.random.default_rng(1).permutation(len(keys))
    cnn = np.zeros((len(keys), 24))
    prof = np.zeros((len(keys), 24))
    lo = MAX_SHIFT * BINS_PER_SEMITONE
    for f in range(folds):
        val = order[f::folds]
        train_idx = np.setdiff1d(order, val)
        nets = train_ensemble(
            [specs[i] for i in train_idx], labels[train_idx], epochs, device, seeds, channels
        )
        model = KeyCnn.from_arrays(export_arrays(nets))
        profile_model: KeyModel = fit(profiles[train_idx], labels[train_idx])
        for i in val:
            x = _window(specs[i], lo, model.n_bins)
            cnn[i] = model.probabilities(x)
            prof[i] = profile_model.probabilities(profiles[i])
        print(f"  fold {f + 1}/{folds} done", flush=True)
    return cnn, prof


def combination_report(cnn: np.ndarray, prof: np.ndarray, keys: list[Key]) -> dict[str, float]:
    """MIREX of each model and of their combination for every weight (0..1 by 0.05)."""

    def score(p: np.ndarray) -> float:
        pred = p.argmax(axis=1)
        return float(
            np.mean(
                [
                    MIREX_WEIGHTS[mirex_category(ALL_KEYS[i], k)]
                    for i, k in zip(pred, keys, strict=True)
                ]
            )
        )

    report = {f"{w:.2f}": score(combine(prof, cnn, w)) for w in np.arange(0, 1.0001, 0.05)}
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--cv", action="store_true", help="5-fold CV only, write nothing")
    parser.add_argument(
        "--combine",
        action="store_true",
        help="choose the network's weight next to the learned profiles (5-fold CV)",
    )
    parser.add_argument("--epochs", type=int, default=120)
    parser.add_argument("--workers", type=int, default=0)
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--channels", type=int, default=CHANNELS)
    parser.add_argument(
        "--extra", action="store_true", help="also train on the confidence-1 annotations"
    )
    parser.add_argument("--seeds", type=int, default=1, help="networks averaged (one per seed)")
    parser.add_argument("--full", action="store_true", help="whole spectrum, not the harmonic part")
    parser.add_argument("--low", type=int, default=LOW_MIDI, help="lowest MIDI note of the input")
    parser.add_argument("--octaves", type=int, default=OCTAVES)
    args = parser.parse_args()
    refs = training_refs()
    if not refs:
        sys.exit("GiantSteps-MTG-Key not found: run `python -m tools.fetch_datasets mtg-key`")
    inp = Input(args.low, args.octaves, harmonic=not args.full)
    specs, keys, paths = cached_features("mtg", refs, args.workers or None, inp)
    extra: tuple[list[np.ndarray], list[Key]] = ([], [])
    if args.extra:
        e_specs, e_keys, _ = cached_features(
            "mtg_conf1", training_refs("1"), args.workers or None, inp
        )
        extra = (e_specs, e_keys)
    print(f"{len(keys)} tracks (+{len(extra[1])} for training only)")
    if args.cv:
        cv = cross_validate(
            specs,
            keys,
            args.epochs,
            args.device,
            channels=args.channels,
            seeds=args.seeds,
            extra=extra,
        )
        print(f"5-fold CV MIREX {cv:.3f}")
        return
    if args.combine:
        profiles = cached_profiles(refs, args.workers or None)
        both = [j for j, p in enumerate(paths) if p in profiles]
        cnn_p, prof_p = out_of_fold(
            [specs[j] for j in both],
            np.stack([profiles[paths[j]] for j in both]),
            [keys[j] for j in both],
            args.epochs,
            args.device,
            channels=args.channels,
            seeds=args.seeds,
        )
        report = combination_report(cnn_p, prof_p, [keys[j] for j in both])
        for w, v in report.items():
            print(f"  network weight {w}: MIREX {v:.3f}")
        best = max(report, key=report.__getitem__)
        print(f"best network weight {best} · MIREX {report[best]:.3f} on {len(both)} tracks")
        return
    labels = np.array([ALL_KEYS.index(k) for k in keys])
    all_specs = specs + extra[0]
    labels = np.concatenate([labels, [ALL_KEYS.index(k) for k in extra[1]]]).astype(int)
    nets = train_ensemble(
        all_specs, labels, args.epochs, args.device, args.seeds, args.channels, log=True
    )
    arrays = export_arrays(nets, inp.low_midi, inp.harmonic)
    out = Path(str(resources.files("tonalia_engine.analysis").joinpath("key_cnn.npz")))
    np.savez_compressed(out, **arrays)  # type: ignore[arg-type]
    meta: dict[str, Any] = {
        "trained_on": "GiantSteps-MTG-Key (confidence 2" + (" and 1)" if args.extra else ")"),
        "tracks": len(all_specs),
        "epochs": args.epochs,
        "seeds": list(range(SEED, SEED + args.seeds)),
        "channels": args.channels,
        "input": {"low_midi": inp.low_midi, "octaves": inp.octaves, "harmonic": inp.harmonic},
    }
    print(json.dumps(meta))
    print(f"weights written to {out} ({out.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
