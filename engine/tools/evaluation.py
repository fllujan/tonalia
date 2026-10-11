"""Shared helpers for the accuracy tools (SPEC 2.2, 2.4, §5)."""

from __future__ import annotations

import csv
import json
import os
import sys
from collections.abc import Callable, Iterable
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import Any, TypeVar

from tonalia_engine.keys import Key, compatibility, parse_key
from tonalia_engine.library import scan
from tonalia_engine.metadata import MetadataError, read_metadata

ROOT = Path(__file__).resolve().parents[2]
BASELINE = ROOT / "docs" / "accuracy.json"
T = TypeVar("T")
R = TypeVar("R")

# MIREX key-detection weighting.
MIREX_FIFTH = 0.5
MIREX_RELATIVE = 0.3
MIREX_PARALLEL = 0.2


def mirex_category(estimate: Key | None, reference: Key) -> str:
    if estimate is None:
        return "none"
    if estimate == reference:
        return "correct"
    relation = compatibility(reference, estimate).relation
    if relation == "adjacent":  # a fifth up or down, same mode
        return "fifth"
    if relation == "relative":
        return "relative"
    if estimate.root == reference.root:
        return "parallel"
    return "other"


MIREX_WEIGHTS = {
    "correct": 1.0,
    "fifth": MIREX_FIFTH,
    "relative": MIREX_RELATIVE,
    "parallel": MIREX_PARALLEL,
    "other": 0.0,
    "none": 0.0,
}


def tempo_accuracy(estimate: float | None, reference: float) -> tuple[bool, bool]:
    """(Accuracy1, Accuracy2): within 4 %, and within 4 % of x1, x2, x1/2, x3 or x1/3."""
    if estimate is None or reference <= 0:
        return False, False
    ok1 = abs(estimate - reference) <= 0.04 * reference
    ok2 = any(abs(estimate - reference * f) <= 0.04 * reference * f for f in (1, 2, 0.5, 3, 1 / 3))
    return ok1, ok2


@dataclass(frozen=True)
class Reference:
    path: Path
    value: str
    genre: str | None = None


def read_csv(path: Path) -> list[Reference]:
    """``path,value`` rows (header optional; relative paths resolve next to the CSV)."""
    rows: list[Reference] = []
    with path.open(newline="", encoding="utf-8") as f:
        for row in csv.reader(f):
            if len(row) < 2 or row[0].strip().lower() in ("path", "ruta"):
                continue
            p = Path(row[0].strip())
            rows.append(Reference(p if p.is_absolute() else path.parent / p, row[1].strip()))
    return rows


def from_tags(folder: Path, field: str) -> list[Reference]:
    """References from the user's own tags (``key_tag`` or ``bpm_tag``)."""
    rows = []
    for audio in scan([folder]):
        try:
            meta = read_metadata(audio)
        except MetadataError:
            continue
        value = getattr(meta, field)
        if value:
            rows.append(Reference(audio, str(value), meta.genre))
    return rows


def dataset_pairs(
    audio_dir: Path, annotation_dir: Path, suffix: str, genre_dir: Path | None = None
) -> list[Reference]:
    """Pair ``<id>.mp3`` with ``<id><suffix>`` annotation files (GiantSteps layout).

    The Zenodo copy of GiantSteps Key names files ``<id> Artist - Title.mp3``, so audio is
    also matched by its leading numeric id. ``genre_dir`` holds optional ``<id>.genre``
    files (GiantSteps Tempo ships the Beatport genre of every excerpt).
    """
    by_id = {a.name.split(" ", 1)[0].split(".", 1)[0]: a for a in audio_dir.glob("*.mp3")}
    rows = []
    for ann in sorted(annotation_dir.glob(f"*{suffix}")):
        stem = ann.name.removesuffix(suffix)
        audio = audio_dir / f"{stem}.mp3"
        if not audio.exists():
            audio = by_id.get(stem.split(".", 1)[0], audio)
        if audio.exists():
            genre_file = genre_dir / f"{stem}.genre" if genre_dir else None
            genre = (
                genre_file.read_text(encoding="utf-8").strip()
                if genre_file and genre_file.exists()
                else None
            )
            value = ann.read_text(encoding="utf-8", errors="replace").strip()
            rows.append(Reference(audio, value, genre))
    return rows


def parse_reference_key(text: str) -> Key | None:
    # GiantSteps annotations look like "A minor" / "Eb major"; tags may use any notation.
    first = text.splitlines()[0].split("\t")[0].strip() if text else ""
    return parse_key(first)


def run_parallel(fn: Callable[[T], R], items: Iterable[T], workers: int | None) -> list[R]:
    items = list(items)
    workers = workers or max(1, (os.cpu_count() or 2) - 1)
    out: list[R] = []
    with ProcessPoolExecutor(workers) as pool:
        for i, result in enumerate(pool.map(fn, items, chunksize=4), 1):
            out.append(result)
            if i % 25 == 0 or i == len(items):
                print(f"  {i}/{len(items)}", file=sys.stderr, flush=True)
    return out


def load_baseline() -> dict[str, Any]:
    if BASELINE.exists():
        data: dict[str, Any] = json.loads(BASELINE.read_text(encoding="utf-8"))
        return data
    return {}


def check_regression(metric: str, value: float, tolerance: float = 0.02) -> bool:
    """False if ``value`` dropped more than ``tolerance`` below the recorded baseline."""
    baseline = load_baseline().get(metric)
    if baseline is None:
        return True
    return value >= float(baseline["value"]) - tolerance


def record_baseline(metric: str, value: float, **info: Any) -> None:
    data = load_baseline()
    data[metric] = {"value": round(value, 4), **info}
    BASELINE.parent.mkdir(parents=True, exist_ok=True)
    BASELINE.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
