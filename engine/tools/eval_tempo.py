"""Evaluate tempo detection: Accuracy1 and Accuracy2 (SPEC 2.4).

uv run python -m tools.eval_tempo --giantsteps            # original annotations
uv run python -m tools.eval_tempo --giantsteps --v2       # Schreiber's corrected ones
uv run python -m tools.eval_tempo --giantsteps --no-genre  # rhythm only, no genre prior
uv run python -m tools.eval_tempo --csv refs.csv
uv run python -m tools.eval_tempo --tags ~/Music
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Any

from tonalia_engine import __version__
from tonalia_engine.analysis.pipeline import ANALYSIS_VERSION
from tonalia_engine.analysis.tempo import TempoSettings, detect_tempo
from tonalia_engine.audio_io import ANALYSIS_SAMPLE_RATE, DecodeError, decode

from .evaluation import (
    ROOT,
    Reference,
    check_regression,
    dataset_pairs,
    from_tags,
    read_csv,
    record_baseline,
    run_parallel,
    tempo_accuracy,
)

GIANTSTEPS = ROOT / "datasets" / "giantsteps-tempo"


def _detect(job: tuple[Path, float, float, str | None]) -> tuple[float | None, str | None]:
    path, lo, hi, genre = job
    try:
        result = detect_tempo(decode(path), ANALYSIS_SAMPLE_RATE, TempoSettings(lo, hi), genre)
    except DecodeError as exc:
        return None, str(exc)
    return (result.bpm if result else None), None


def _parse_bpm(text: str) -> float | None:
    try:
        return float(text.split()[0].replace(",", "."))
    except (ValueError, IndexError):
        return None


def evaluate(
    refs: list[Reference], lo: float, hi: float, workers: int | None, use_genre: bool = True
) -> dict[str, Any]:
    usable = [(r, b) for r in refs if (b := _parse_bpm(r.value)) is not None]
    start = time.monotonic()
    jobs = [(r.path, lo, hi, r.genre if use_genre else None) for r, _ in usable]
    results = run_parallel(_detect, jobs, workers)
    elapsed = time.monotonic() - start
    acc1 = acc2 = errors = 0
    misses: list[dict[str, Any]] = []
    for (ref, bpm), (estimate, error) in zip(usable, results, strict=True):
        errors += error is not None
        ok1, ok2 = tempo_accuracy(estimate, bpm)
        acc1 += ok1
        acc2 += ok2
        if not ok1 and len(misses) < 15:
            misses.append({"file": ref.path.name, "reference": bpm, "estimate": estimate})
    n = len(usable)
    return {
        "tracks": n,
        "skipped_references": len(refs) - n,
        "decode_errors": errors,
        "accuracy1": acc1 / max(n, 1),
        "accuracy2": acc2 / max(n, 1),
        "range": [lo, hi],
        "genre_prior": use_genre,
        "sample_misses": misses,
        "seconds": round(elapsed, 1),
        "seconds_per_track": round(elapsed / max(n, 1), 3),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    src = parser.add_mutually_exclusive_group(required=True)
    src.add_argument("--csv", type=Path)
    src.add_argument("--tags", type=Path)
    src.add_argument("--giantsteps", action="store_true")
    parser.add_argument("--v2", action="store_true", help="use annotations_v2 (GiantSteps)")
    parser.add_argument("--no-genre", action="store_true", help="ignore genre (no prior)")
    parser.add_argument("--range", nargs=2, type=float, default=[70.0, 180.0])
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--workers", type=int, default=0)
    parser.add_argument("--json", type=Path)
    parser.add_argument("--record", action="store_true")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()

    if args.csv:
        refs, dataset = read_csv(args.csv), f"csv:{args.csv.name}"
    elif args.tags:
        refs, dataset = from_tags(args.tags, "bpm_tag"), "user tags"
    else:
        ann = GIANTSTEPS / ("annotations_v2" if args.v2 else "annotations")
        refs = dataset_pairs(GIANTSTEPS / "audio", ann, ".bpm", GIANTSTEPS / "genre")
        dataset = "GiantSteps Tempo" + (" v2" if args.v2 else "")
        if not refs:
            sys.exit(
                "GiantSteps Tempo not found: run `uv run python -m tools.fetch_datasets tempo`"
            )
    if args.limit:
        refs = refs[: args.limit]

    lo, hi = args.range
    report = evaluate(refs, lo, hi, args.workers or None, use_genre=not args.no_genre)
    if args.no_genre:
        dataset += " (no genre)"
    report.update(dataset=dataset, engine=__version__, analysis_version=ANALYSIS_VERSION)
    print(json.dumps(report, indent=2))
    print(
        f"\n{dataset}: {report['tracks']} tracks · Acc1 {report['accuracy1']:.3f} · "
        f"Acc2 {report['accuracy2']:.3f} · {report['seconds_per_track']} s/track"
    )
    if args.json:
        args.json.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    metric = f"tempo_acc1:{dataset}"
    if args.check and not check_regression(metric, report["accuracy1"]):
        sys.exit(f"tempo accuracy regressed more than 2 points on {dataset}")
    if args.record:
        record_baseline(metric, report["accuracy1"], accuracy2=round(report["accuracy2"], 4),
                        tracks=report["tracks"], analysis_version=ANALYSIS_VERSION)  # fmt: skip


if __name__ == "__main__":
    main()
