"""Calibrate the energy level (SPEC 2.5).

Two steps, both reproducible:

1. Reference ranges (``--ranges FOLDER``): the 5th and 95th percentile of every
   descriptor over the 8-bar blocks of a music collection become the values mapped to
   0 and 1 (``analysis/energy_ref.json``).
2. Weights and sigmoid (``--csv refs.csv`` with ``path,energy`` rows, energy 1-10, e.g.
   the user's own ratings or energy tags): ridge regression with 5-fold cross-validation
   on the logit of the target, using the descriptors of the most energetic half of each
   track's blocks (what the track level averages). Reports the MAE before and after.

    uv run python -m tools.calibrate_energy --ranges ../datasets/giantsteps-tempo/audio --write
    uv run python -m tools.calibrate_energy --csv mis_temas.csv --write
"""

from __future__ import annotations

import argparse
import json
import sys
from importlib import resources
from pathlib import Path

import numpy as np
import numpy.typing as npt

from tonalia_engine.analysis.energy import (
    DESCRIPTORS,
    EnergyModel,
    block_bounds,
    block_descriptors,
)
from tonalia_engine.analysis.energy_calibration import calibrate
from tonalia_engine.analysis.tempo import detect_tempo
from tonalia_engine.audio_io import ANALYSIS_SAMPLE_RATE, DecodeError, decode
from tonalia_engine.library import scan

from .evaluation import read_csv, run_parallel

FloatArray = npt.NDArray[np.float64]


def _config_path(name: str) -> Path:
    return Path(str(resources.files("tonalia_engine.analysis").joinpath(name)))


def track_blocks(path: Path) -> list[list[float]] | None:
    """Raw descriptors of every 8-bar block of one file."""
    try:
        audio = decode(path)
    except DecodeError:
        return None
    sr = ANALYSIS_SAMPLE_RATE
    if len(audio) < sr:
        return None
    tempo = detect_tempo(audio, sr)
    bounds = block_bounds(len(audio) / sr, tempo.grid if tempo else None)
    rows: list[list[float]] = block_descriptors(audio, sr, bounds).tolist()
    return rows


def reference_ranges(
    blocks: FloatArray, low: float = 5.0, high: float = 95.0
) -> dict[str, list[float]]:
    lo = np.percentile(blocks, low, axis=0)
    hi = np.percentile(blocks, high, axis=0)
    return {
        name: [round(float(a), 4), round(float(b), 4)]
        for name, a, b in zip(DESCRIPTORS, lo, hi, strict=True)
    }


def _parse_level(text: str) -> float | None:
    try:
        value = float(text.strip().replace(",", "."))
    except ValueError:
        return None
    return value if 1 <= value <= 10 else None


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    src = parser.add_mutually_exclusive_group(required=True)
    src.add_argument("--ranges", type=Path, help="music folder for the reference ranges")
    src.add_argument("--csv", type=Path, help="CSV with path,energy rows (1-10)")
    parser.add_argument("--write", action="store_true", help="save the result to the engine")
    parser.add_argument("--workers", type=int, default=0)
    args = parser.parse_args()
    workers = args.workers or None

    if args.ranges:
        files = list(scan([args.ranges]))
        results = run_parallel(track_blocks, files, workers)
        blocks = np.asarray([b for r in results if r for b in r], dtype=np.float64)
        if not len(blocks):
            sys.exit("no readable audio found")
        ranges = reference_ranges(blocks)
        print(json.dumps({"tracks": len(files), "blocks": len(blocks), "ranges": ranges}, indent=2))
        if args.write:
            path = _config_path("energy_ref.json")
            data = json.loads(path.read_text(encoding="utf-8"))
            data["ranges"] = ranges
            folder = f"{args.ranges.parent.name}/{args.ranges.name}"
            data["source"] = f"{folder}: {len(files)} tracks, {len(blocks)} blocks"
            path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
            print(f"written {path}")
        return

    refs = [(r.path, lv) for r in read_csv(args.csv) if (lv := _parse_level(r.value)) is not None]
    if len(refs) < 10:
        sys.exit("need at least 10 rated tracks")
    results = run_parallel(track_blocks, [p for p, _ in refs], workers)
    pairs = [(np.asarray(r), lv) for r, (_, lv) in zip(results, refs, strict=True) if r]
    fit = calibrate([b for b, _ in pairs], np.array([lv for _, lv in pairs]), EnergyModel.load())
    print(
        f"{fit.tracks} tracks · MAE now {fit.mae_before:.2f} · "
        f"calibrated (5-fold CV) {fit.mae_after:.2f}"
    )
    if args.write:
        path = _config_path("energy_weights.json")
        data = json.loads(path.read_text(encoding="utf-8"))
        data.update(fit.params())
        data["calibration"] = {"tracks": fit.tracks, "cv_mae": fit.mae_after}
        path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
        print(f"written {path}")


if __name__ == "__main__":
    main()
