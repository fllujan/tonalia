"""Evaluate key detection: exact accuracy and the MIREX weighted score (SPEC 2.2).

References come from a CSV (``path,key``), from the user's own key tags (``--tags``), or
from GiantSteps Key (``--giantsteps``, after ``tools.fetch_datasets key``).

    uv run python -m tools.eval_key --giantsteps
    uv run python -m tools.eval_key --csv refs.csv
    uv run python -m tools.eval_key --tags ~/Music
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from collections import Counter
from pathlib import Path
from typing import Any

import numpy as np

from tonalia_engine import __version__
from tonalia_engine.analysis.key import (
    PROFILES,
    KeyWeights,
    detect_key,
    key_from_chroma,
    tonal_frames,
)
from tonalia_engine.analysis.pipeline import ANALYSIS_VERSION
from tonalia_engine.audio_io import ANALYSIS_SAMPLE_RATE, DecodeError, decode
from tonalia_engine.keys import Key, format_key

from .evaluation import (
    MIREX_WEIGHTS,
    ROOT,
    Reference,
    check_regression,
    dataset_pairs,
    from_tags,
    mirex_category,
    parse_reference_key,
    read_csv,
    record_baseline,
    run_parallel,
)

GIANTSTEPS = ROOT / "datasets" / "giantsteps-key"


def _detect(path: Path) -> tuple[str, Key | None, str | None]:
    try:
        result = detect_key(decode(path), ANALYSIS_SAMPLE_RATE, KeyWeights.load())
    except DecodeError as exc:
        return str(path), None, str(exc)
    return str(path), (result.key if result else None), None


def _chroma(path: Path) -> list[float] | None:
    try:
        features = tonal_frames(
            decode(path), ANALYSIS_SAMPLE_RATE, KeyWeights.load().min_harmonic_ratio
        )
    except DecodeError:
        return None
    return features.mean_chroma.tolist() if features else None


def _simplex(n: int, step: float) -> list[tuple[float, ...]]:
    """All weight vectors of length n with components multiple of step summing to 1."""
    units = round(1 / step)

    def rec(k: int, left: int) -> list[tuple[int, ...]]:
        if k == 1:
            return [(left,)]
        return [(i, *rest) for i in range(left + 1) for rest in rec(k - 1, left - i)]

    return [tuple(u / units for u in combo) for combo in rec(n, units)]


def tune(refs: list[Reference], workers: int | None, step: float) -> dict[str, Any]:
    """Grid-search the profile weights on cached mean chromas (global decision only)."""
    usable = [(r, k) for r in refs if (k := parse_reference_key(r.value)) is not None]
    chromas = run_parallel(_chroma, [r.path for r, _ in usable], workers)
    data = [(np.asarray(c), k) for c, (_, k) in zip(chromas, usable, strict=True) if c]
    base = KeyWeights.load()
    names = list(PROFILES)
    results = []
    for combo in _simplex(len(names), step):
        weights = KeyWeights({n: w for n, w in zip(names, combo, strict=True) if w > 0},
                             base.min_harmonic_ratio, base.window_seconds,
                             base.secondary_min_share)  # fmt: skip
        if not weights.profiles:
            continue
        score = sum(
            MIREX_WEIGHTS[mirex_category(key_from_chroma(c, weights)[0], ref)] for c, ref in data
        ) / max(len(data), 1)
        results.append((score, dict(zip(names, combo, strict=True))))
    results.sort(key=lambda r: r[0], reverse=True)
    current = sum(
        MIREX_WEIGHTS[mirex_category(key_from_chroma(c, base)[0], ref)] for c, ref in data
    ) / max(len(data), 1)
    return {
        "tracks": len(data),
        "current_weights": base.profiles,
        "current_mirex_global": round(current, 4),
        "best": [{"mirex_global": round(s, 4), "weights": w} for s, w in results[:5]],
    }


def evaluate(refs: list[Reference], workers: int | None) -> dict[str, Any]:
    usable = [(r, k) for r in refs if (k := parse_reference_key(r.value)) is not None]
    skipped = len(refs) - len(usable)
    start = time.monotonic()
    results = run_parallel(_detect, [r.path for r, _ in usable], workers)
    elapsed = time.monotonic() - start
    categories: Counter[str] = Counter()
    errors = []
    confusion: Counter[tuple[str, str]] = Counter()
    for (ref, key), (_, estimate, error) in zip(usable, results, strict=True):
        if error:
            errors.append(f"{ref.path.name}: {error}")
        cat = mirex_category(estimate, key)
        categories[cat] += 1
        if cat != "correct":
            est = format_key(estimate, "alphanumeric") if estimate else "-"
            confusion[(format_key(key, "alphanumeric"), est)] += 1
    n = len(usable)
    mirex = sum(MIREX_WEIGHTS[c] * k for c, k in categories.items()) / max(n, 1)
    return {
        "tracks": n,
        "skipped_references": skipped,
        "decode_errors": len(errors),
        "exact": categories["correct"] / max(n, 1),
        "mirex": mirex,
        "categories": dict(categories),
        "top_confusions": [
            {"reference": r, "estimate": e, "count": c} for (r, e), c in confusion.most_common(10)
        ],
        "seconds": round(elapsed, 1),
        "seconds_per_track": round(elapsed / max(n, 1), 3),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    src = parser.add_mutually_exclusive_group(required=True)
    src.add_argument("--csv", type=Path, help="CSV with path,key rows")
    src.add_argument("--tags", type=Path, help="folder whose key tags are the reference")
    src.add_argument("--giantsteps", action="store_true", help="GiantSteps Key dataset")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--workers", type=int, default=0)
    parser.add_argument("--json", type=Path, help="write the full report here")
    parser.add_argument("--record", action="store_true", help="store result as the baseline")
    parser.add_argument("--check", action="store_true", help="fail on >2 pt regression")
    parser.add_argument("--tune", action="store_true", help="grid-search profile weights")
    parser.add_argument("--step", type=float, default=0.1, help="weight grid step for --tune")
    args = parser.parse_args()

    if args.csv:
        refs, dataset = read_csv(args.csv), f"csv:{args.csv.name}"
    elif args.tags:
        refs, dataset = from_tags(args.tags, "key_tag"), "user tags"
    else:
        refs = dataset_pairs(GIANTSTEPS / "audio", GIANTSTEPS / "annotations", ".key")
        dataset = "GiantSteps Key"
        if not refs:
            sys.exit("GiantSteps Key not found: run `uv run python -m tools.fetch_datasets key`")
    if args.limit:
        refs = refs[: args.limit]

    if args.tune:
        print(json.dumps(tune(refs, args.workers or None, args.step), indent=2))
        return
    report = evaluate(refs, args.workers or None)
    report.update(dataset=dataset, engine=__version__, analysis_version=ANALYSIS_VERSION)
    print(json.dumps(report, indent=2))
    print(
        f"\n{dataset}: {report['tracks']} tracks · exact {report['exact']:.3f} · "
        f"MIREX {report['mirex']:.3f} · {report['seconds_per_track']} s/track"
    )
    if args.json:
        args.json.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    metric = f"key_mirex:{dataset}"
    if args.check and not check_regression(metric, report["mirex"]):
        sys.exit(f"key accuracy regressed more than 2 points on {dataset}")
    if args.record:
        record_baseline(metric, report["mirex"], exact=round(report["exact"], 4),
                        tracks=report["tracks"], analysis_version=ANALYSIS_VERSION)  # fmt: skip


if __name__ == "__main__":
    main()
