"""Train the vocal presence model (``analysis/vocals_model.npz``, SPEC 12.3).

Labels come for free from stem separation: Demucs (``htdemucs``, the default model) splits
local tracks and the share of each frame's power that is voice is the target. Each
separated track gives three examples: the mix, its vocal stem alone (an acapella) and the
rest (an instrumental), so the model also learns to tell those apart.

    uv run python -m tools.train_vocals separate        # Demucs on the local sets (hours)
    uv run python -m tools.train_vocals cv              # cross-validated MAE on the previews
    uv run python -m tools.train_vocals cv-full         # ... on whole tracks, trained with the rest
    uv run python -m tools.train_vocals evaluate        # model vs heuristic on held-out sets
    uv run python -m tools.train_vocals train           # write the weights

Sets: ``train`` = 900 GiantSteps-MTG-Key previews, ``val`` = GiantSteps Key (never trained
on), ``full`` = whole tracks of a local folder (``--full``), like the 22 tracks the first
estimate was calibrated on. To keep separation affordable, the previews contribute their
middle 40 s. Trained on excerpts alone the model underestimates whole tracks (they are
mostly songs, the previews mostly club music), so the whole tracks also train it, repeated
``--full-repeat`` times; ``cv-full`` measures them by folds, never on a track it saw.
The separated audio (mono, 11 025 Hz) is cached in ``datasets/cache/vocals``
(git-ignored); no audio ever enters the repository.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
from dataclasses import dataclass
from importlib import resources
from pathlib import Path
from typing import Any

import numpy as np
from scipy.signal import resample_poly

from tonalia_engine.analysis.vocals import (
    DEFAULT_THRESHOLDS,
    HOP,
    N_FEATURES,
    VOCAL_SR,
    VocalModel,
    _mask,
    frame_features,
    frame_voice_share,
    heuristic_presence,
    main_sections,
    measured_presence,
    pooled_presence,
)
from tonalia_engine.audio_io import ANALYSIS_SAMPLE_RATE, DecodeError, decode

from .evaluation import ROOT

CACHE = ROOT / "datasets" / "cache" / "vocals"
MTG = ROOT / "datasets" / "giantsteps-mtg-key" / "audio"
GIANTSTEPS = ROOT / "datasets" / "giantsteps-key" / "audio"
TRAIN_TRACKS = 900
EXCERPT = (40.0, 80.0)  # seconds of each preview that are separated
MODELS_DIR = Path.home() / "Library" / "Application Support" / "org.tonalia.app"


def set_files(name: str, full: Path | None) -> list[Path]:
    if name == "train":
        files = sorted(MTG.glob("*.mp3"))
        order = np.random.default_rng(0).permutation(len(files))
        return [files[i] for i in order[:TRAIN_TRACKS]]
    if name == "val":
        return sorted(GIANTSTEPS.glob("*.mp3"))
    if full is None or not full.is_dir():
        return []
    return sorted(
        p for p in full.iterdir() if p.suffix.lower() in {".mp3", ".flac", ".wav", ".m4a"}
    )


def cache_path(name: str, path: Path) -> Path:
    digest = hashlib.sha1(str(path).encode("utf-8")).hexdigest()[:16]
    return CACHE / name / f"{digest}.npz"


def _to_vocal_sr(x: np.ndarray) -> np.ndarray:
    return resample_poly(x, VOCAL_SR, ANALYSIS_SAMPLE_RATE).astype(np.float16)


def separate(names: list[str], full: Path | None, device: str, data_dir: Path) -> None:
    from tonalia_engine import stems

    separator = stems.make_separator(stems.models_dir(data_dir), "htdemucs", device)
    for name in names:
        files = set_files(name, full)
        (CACHE / name).mkdir(parents=True, exist_ok=True)
        started, done = time.time(), 0
        for i, path in enumerate(files, 1):
            out = cache_path(name, path)
            if out.is_file():
                continue
            try:
                audio = decode(path, channels=2)
            except DecodeError:
                continue
            if name != "full":
                a, b = (int(t * ANALYSIS_SAMPLE_RATE) for t in EXCERPT)
                audio = audio[a:b] if len(audio) > b else audio
            parts = separator(audio, lambda _: None, lambda: None)
            np.savez_compressed(
                out,
                mix=_to_vocal_sr(audio.mean(axis=1)),
                vocals=_to_vocal_sr(parts["vocals"].mean(axis=1)),
            )
            done += 1
            if done % 25 == 0:
                rate = (time.time() - started) / done
                print(f"{name}: {i}/{len(files)} · {rate:.1f} s/track", flush=True)
        print(f"{name}: {len(files)} tracks separated", flush=True)


def load_set(name: str) -> list[tuple[np.ndarray, np.ndarray]]:
    """(mix, vocals) mono at 11 025 Hz for every cached track of a set."""
    out = []
    for path in sorted((CACHE / name).glob("*.npz")):
        with np.load(path) as data:
            out.append((data["mix"].astype(np.float32), data["vocals"].astype(np.float32)))
    return out


# ---- examples ----

KINDS = ("instrumental", "vocal", "acapella")


@dataclass
class Example:
    """One input (a mix, its vocals alone or the rest) with its per-frame targets."""

    kind: str  # "mix" | "acapella" | "instrumental": how it was made
    features: np.ndarray  # (frames, N_FEATURES) float32
    share: np.ndarray  # voice share per frame (target)
    power: np.ndarray  # mix power per frame (pooling weights)
    measured: float  # presence measured with the stems over its sections
    sections: list[tuple[float, float]]
    audio: np.ndarray  # mono at VOCAL_SR (for the heuristic)


def _sections(name: str, duration: float) -> list[tuple[float, float]]:
    # Previews are 40 s excerpts: all of it. Whole tracks: the analysis fallback (the
    # track minus its first and last 10 %), the same for measurement and estimate.
    return [(0.0, duration)] if name != "full" else main_sections([], duration)


def examples(name: str) -> list[Example]:
    out = []
    for mix, vocals in load_set(name):
        sections = _sections(name, mix.size / VOCAL_SR)
        rest = mix - vocals
        for kind, audio, voice in (("mix", mix, vocals), ("acapella", vocals, vocals),
                                   ("instrumental", rest, np.zeros_like(rest))):  # fmt: skip
            features, power = frame_features(audio, VOCAL_SR)
            share = frame_voice_share(voice, audio, VOCAL_SR)[: len(power)]
            if kind == "acapella":
                share = np.ones_like(share)
            out.append(
                Example(
                    kind,
                    features.astype(np.float32),
                    share.astype(np.float32),
                    power.astype(np.float32),
                    measured_presence(voice, audio, VOCAL_SR, sections),
                    sections,
                    audio,
                )
            )
    return out


def true_kind(ex: Example) -> str:
    """The class an example belongs to: made that way, or by its measured presence."""
    if ex.kind != "mix":
        return ex.kind
    instrumental, acapella = DEFAULT_THRESHOLDS
    if ex.measured < instrumental:
        return "instrumental"
    return "acapella" if ex.measured > acapella else "vocal"


# ---- model ----


@dataclass(frozen=True)
class Config:
    channels: int = 32  # 0.075 cross-validated MAE vs 0.083 with 16
    crop: int = 256  # frames per training excerpt (~12 s)
    epochs: int = 60
    pool_weight: float = 5.0  # pooled-presence error next to the per-frame loss
    # Times each whole track joins the excerpts (cv-full MAE: 5 → 0.061, 15 → 0.055, 30 → 0.054).
    full_repeat: int = 15


DEFAULT = Config()


def _net(channels: int = DEFAULT.channels) -> Any:
    from torch import nn

    def block(cin: int, kernel: tuple[int, int], pool: bool) -> list[nn.Module]:
        pad = (kernel[0] // 2, kernel[1] // 2)
        layers: list[nn.Module] = [
            nn.Conv2d(cin, channels, kernel, padding=pad),
            nn.BatchNorm2d(channels),
            nn.ReLU(),
        ]
        return [*layers, nn.MaxPool2d((1, 2))] if pool else layers

    body = [
        *block(1, (3, 3), True),
        *block(channels, (3, 3), True),
        *block(channels, (3, 3), True),
        *block(channels, (9, 1), False),
    ]
    return nn.Sequential(*body, nn.Conv2d(channels, 1, (1, N_FEATURES // 8)))


def _export(net: Any) -> dict[str, np.ndarray]:
    """Fold the batch norms; layout ``VocalModel`` reads."""
    from torch import nn

    net = net.cpu().eval()
    mods = list(net)
    out: dict[str, np.ndarray] = {}
    i = n = 0
    while i < len(mods) - 1:
        conv, bn = mods[i], mods[i + 1]
        assert isinstance(conv, nn.Conv2d) and isinstance(bn, nn.BatchNorm2d)
        assert bn.running_var is not None and bn.running_mean is not None and conv.bias is not None
        scale = (bn.weight / (bn.running_var + bn.eps).sqrt()).detach()
        w = (conv.weight.detach() * scale[:, None, None, None]).numpy()
        b = ((conv.bias.detach() - bn.running_mean) * scale + bn.bias.detach()).numpy()
        pool = i + 3 < len(mods) and isinstance(mods[i + 3], nn.MaxPool2d)
        out[f"conv{n}_w"] = w.transpose(2, 3, 1, 0).astype(np.float32)  # (kh, kw, Cin, Cout)
        out[f"conv{n}_b"] = b.astype(np.float32)
        out[f"conv{n}_pool"] = np.asarray(pool)
        i += 4 if pool else 3
        n += 1
    head = mods[-1]
    assert isinstance(head, nn.Conv2d) and head.bias is not None
    out["head_w"] = head.weight.detach().numpy()[0, :, 0, :].T.astype(np.float32)  # (F', C)
    out["head_b"] = np.asarray(float(head.bias.detach()[0]), dtype=np.float32)
    out["instrumental"] = np.asarray(DEFAULT_THRESHOLDS[0], dtype=np.float32)
    out["acapella"] = np.asarray(DEFAULT_THRESHOLDS[1], dtype=np.float32)
    return out


def train_model(
    train: list[Example], cfg: Config = DEFAULT, seed: int = 0, device: str = "mps"
) -> dict[str, np.ndarray]:
    """The network on random excerpts: per-frame loss weighted by power, plus the error
    of the presence pooled over the excerpt (the number that is evaluated)."""
    import torch
    from torch import nn

    torch.manual_seed(seed)
    rng = np.random.default_rng(seed)
    net = _net(cfg.channels).to(device)
    opt = torch.optim.Adam(net.parameters(), lr=1e-3)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, cfg.epochs)
    crop = cfg.crop
    usable = [ex for ex in train if len(ex.power) >= crop]
    bce = nn.functional.binary_cross_entropy_with_logits
    for _ in range(cfg.epochs):
        net.train()
        order = rng.permutation(len(usable))
        for i in range(0, len(order), 32):
            xs, ys, ws = [], [], []
            for j in order[i : i + 32]:
                ex = usable[j]
                s = int(rng.integers(0, len(ex.power) - crop + 1))
                p = ex.power[s : s + crop]
                xs.append(ex.features[s : s + crop])
                ys.append(ex.share[s : s + crop])
                ws.append(np.clip(p / max(float(ex.power.mean()), 1e-12), 0.05, 10.0))
            x, y, w = (
                torch.tensor(np.stack(a), dtype=torch.float32, device=device) for a in (xs, ys, ws)
            )
            z = net(x[:, None])[:, 0, :, 0]
            share = torch.sigmoid(z)
            pooled = torch.sqrt((share * w).sum(1) / w.sum(1) + 1e-6)
            target = torch.sqrt((y * w).sum(1) / w.sum(1) + 1e-6)
            frame_loss = (bce(z, y, reduction="none") * w).mean()
            loss = frame_loss + cfg.pool_weight * (pooled - target).abs().mean()
            opt.zero_grad()
            loss.backward()  # type: ignore[no-untyped-call]
            opt.step()
        sched.step()
    return _export(net)


def predicted(model: VocalModel, ex: Example) -> float:
    keep = _mask(len(ex.power), VOCAL_SR / HOP, ex.sections)
    return pooled_presence(model.frame_shares(ex.features.astype(np.float64)), ex.power, keep)


def tune_thresholds(model: VocalModel, train: list[Example]) -> tuple[float, float]:
    """Presence thresholds with the best balanced accuracy over the three kinds."""
    values = np.array([predicted(model, ex) for ex in train])
    truth = [true_kind(ex) for ex in train]
    best, best_score = DEFAULT_THRESHOLDS, -1.0
    for lo in np.arange(0.02, 0.41, 0.01):
        for hi in np.arange(0.5, 0.99, 0.01):
            pred = np.where(values < lo, "instrumental", np.where(values > hi, "acapella", "vocal"))
            score = np.mean(
                [np.mean(pred[[t == k for t in truth]] == k) for k in KINDS if k in truth]
            )
            if score > best_score:
                best, best_score = (round(float(lo), 2), round(float(hi), 2)), float(score)
    return best


def report(model: VocalModel | None, sets: dict[str, list[Example]]) -> dict[str, Any]:
    """MAE of the presence on the mixes (model and heuristic) and the kind accuracy."""
    out: dict[str, Any] = {}
    for name, exs in sets.items():
        mixes = [ex for ex in exs if ex.kind == "mix"]
        if not mixes:
            continue
        measured = np.array([ex.measured for ex in mixes])
        heur = np.array([heuristic_presence(ex.audio, VOCAL_SR, ex.sections) for ex in mixes])
        row: dict[str, Any] = {
            "tracks": len(mixes),
            "mae_heuristic": round(float(np.mean(np.abs(heur - measured))), 4),
            "mae_constant": round(float(np.mean(np.abs(np.median(measured) - measured))), 4),
            "measured_mean": round(float(measured.mean()), 3),
        }
        if model is not None:
            est = np.array([predicted(model, ex) for ex in mixes])
            row["mae_model"] = round(float(np.mean(np.abs(est - measured))), 4)
            truth = [true_kind(ex) for ex in exs]
            kinds = [model.kind(predicted(model, ex)) for ex in exs]
            row["kind_accuracy"] = round(
                float(np.mean([a == b for a, b in zip(truth, kinds, strict=True)])), 4
            )
            row["kind_by_class"] = {
                k: round(
                    float(np.mean([b == k for a, b in zip(truth, kinds, strict=True) if a == k])), 4
                )
                for k in KINDS
                if k in truth
            }
            row["kind_counts"] = {k: truth.count(k) for k in KINDS}
        out[name] = row
    return out


def cross_validate(train: list[Example], cfg: Config = DEFAULT, folds: int = 5) -> dict[str, Any]:
    """Held-out MAE and kind accuracy on the training set, folds by track (the three
    examples of a track always fall in the same fold)."""
    tracks = len(train) // 3
    order = np.random.default_rng(1).permutation(tracks)
    held: list[Example] = []
    est: list[float] = []
    for f in range(folds):
        val = set(order[f::folds].tolist())
        fit_on = [ex for i, ex in enumerate(train) if i // 3 not in val]
        model = VocalModel.from_arrays(fit(fit_on, cfg))
        for i, ex in enumerate(train):
            if i // 3 in val:
                held.append(ex)
                est.append(predicted(model, ex))
        print(f"  fold {f + 1}/{folds} done", flush=True)
    mixes = [(ex, e) for ex, e in zip(held, est, strict=True) if ex.kind == "mix"]
    measured = np.array([ex.measured for ex, _ in mixes])
    values = np.array([e for _, e in mixes])
    heur = np.array([heuristic_presence(ex.audio, VOCAL_SR, ex.sections) for ex, _ in mixes])
    return {
        "tracks": tracks,
        "cv_mae_model": round(float(np.mean(np.abs(values - measured))), 4),
        "mae_heuristic": round(float(np.mean(np.abs(heur - measured))), 4),
        "mae_constant": round(float(np.mean(np.abs(np.median(measured) - measured))), 4),
        "corr": round(float(np.corrcoef(values, measured)[0, 1]), 3),
    }


def cross_validate_full(
    train: list[Example], full: list[Example], cfg: Config = DEFAULT, folds: int = 3
) -> dict[str, Any]:
    """Held-out MAE on whole tracks: each fold trains on the previews and the other whole
    tracks (repeated ``cfg.full_repeat`` times) and measures the tracks left out."""
    tracks = len(full) // 3
    order = np.random.default_rng(1).permutation(tracks)
    est: list[float] = []
    measured: list[float] = []
    for f in range(folds):
        held = set(order[f::folds].tolist())
        rest = [ex for i, ex in enumerate(full) if i // 3 not in held]
        model = VocalModel.from_arrays(fit(train + rest * cfg.full_repeat, cfg))
        for i, ex in enumerate(full):
            if i // 3 in held and ex.kind == "mix":
                est.append(predicted(model, ex))
                measured.append(ex.measured)
        print(f"  fold {f + 1}/{folds} done", flush=True)
    error = np.array(est) - np.array(measured)
    return {
        "tracks": tracks,
        "cv_mae_model": round(float(np.mean(np.abs(error))), 4),
        "bias": round(float(np.mean(error)), 4),
        "corr": round(float(np.corrcoef(est, measured)[0, 1]), 3),
    }


def fit(train: list[Example], cfg: Config = DEFAULT) -> dict[str, np.ndarray]:
    arrays = train_model(train, cfg)
    lo, hi = tune_thresholds(VocalModel.from_arrays(arrays), train)
    arrays["instrumental"] = np.asarray(lo, dtype=np.float32)
    arrays["acapella"] = np.asarray(hi, dtype=np.float32)
    return arrays


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("stage", choices=["separate", "cv", "cv-full", "evaluate", "train"])
    parser.add_argument("--sets", default="train,val,full")
    parser.add_argument("--full", type=Path, default=ROOT / "cheklist")
    parser.add_argument("--device", default="mps")
    parser.add_argument("--data-dir", type=Path, default=MODELS_DIR)
    parser.add_argument("--channels", type=int, default=DEFAULT.channels)
    parser.add_argument("--epochs", type=int, default=DEFAULT.epochs)
    parser.add_argument("--pool-weight", type=float, default=DEFAULT.pool_weight)
    parser.add_argument("--crop", type=int, default=DEFAULT.crop)
    parser.add_argument("--full-repeat", type=int, default=DEFAULT.full_repeat)
    args = parser.parse_args()
    cfg = Config(args.channels, args.crop, args.epochs, args.pool_weight, args.full_repeat)
    names = [s for s in args.sets.split(",") if s]
    if args.stage == "separate":
        if not MTG.is_dir():
            sys.exit("GiantSteps-MTG-Key not found: run `python -m tools.fetch_datasets mtg-key`")
        separate(names, args.full, args.device, args.data_dir)
        return
    started = time.time()
    sets = {name: examples(name) for name in names}
    print(f"examples ready in {time.time() - started:.0f} s: "
          + ", ".join(f"{k} {len(v)}" for k, v in sets.items()), flush=True)  # fmt: skip
    train = sets.get("train", [])
    if not train:
        sys.exit("no separated training tracks: run the separate stage first")
    if args.stage == "cv":
        print(json.dumps(cross_validate(train, cfg), indent=2))
        return
    full = sets.get("full", [])
    if args.stage == "cv-full":
        print(json.dumps(cross_validate_full(train, full, cfg), indent=2))
        return
    arrays = fit(train + full * cfg.full_repeat, cfg)
    model = VocalModel.from_arrays(arrays)
    # The whole tracks trained the model: their held-out figure comes from cv-full.
    result = report(model, {k: v for k, v in sets.items() if k not in ("train", "full")})
    result["thresholds"] = [float(arrays["instrumental"]), float(arrays["acapella"])]
    print(json.dumps(result, indent=2))
    if args.stage == "train":
        out = Path(str(resources.files("tonalia_engine.analysis").joinpath("vocals_model.npz")))
        np.savez_compressed(out, **arrays)  # type: ignore[arg-type]
        print(f"weights written to {out} ({out.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
