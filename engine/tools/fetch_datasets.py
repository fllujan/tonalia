"""Download the public evaluation datasets into ``datasets/`` (ignored by git).

- GiantSteps Key: annotations from the GiantSteps GitHub repository, audio (604 Beatport
  previews) from the GiantSteps+ Zenodo record (MD5 verified).
- GiantSteps-MTG-Key: 1486 training previews (disjoint from GiantSteps Key) with manual
  keys and a confidence column; audio from the JKU mirror (MD5 per file). Used only to
  fit key profiles so GiantSteps Key stays an untouched test set.
- GiantSteps Tempo: annotations (original and Schreiber's v2) from GitHub, audio (664
  previews) from the JKU mirror used by the dataset's own script (MD5 per file).

The audio is copyrighted and only used locally for evaluation (SPEC §5). Downloads are
resumable: files with a correct checksum are skipped.

    uv run python -m tools.fetch_datasets key tempo mtg-key
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import shutil
import sys
import urllib.request
import zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATASETS = ROOT / "datasets"
UA = {"User-Agent": "tonalia-eval/1.0 (+https://github.com/fllujan/tonalia)"}

KEY_REPO_ZIP = "https://github.com/GiantSteps/giantsteps-key-dataset/archive/refs/heads/master.zip"
KEY_ZENODO = "https://zenodo.org/api/records/1095691"
TEMPO_REPO_ZIP = (
    "https://github.com/GiantSteps/giantsteps-tempo-dataset/archive/refs/heads/master.zip"
)
MTG_KEY_REPO_ZIP = (
    "https://github.com/GiantSteps/giantsteps-mtg-key-dataset/archive/refs/heads/master.zip"
)
MTG_KEY_AUDIO_BASE = "https://www.cp.jku.at/datasets/giantsteps/mtg_key_backup/"
TEMPO_AUDIO_BASE = "https://www.cp.jku.at/datasets/giantsteps/backup/"


def _get(url: str, timeout: int = 120) -> bytes:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        data: bytes = resp.read()
        return data


def _download(url: str, dest: Path, md5: str | None = None) -> bool:
    """Download to ``dest`` unless it already exists with the right MD5."""
    if dest.exists() and (md5 is None or _md5(dest) == md5):
        return False
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_name(dest.name + ".part")
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=600) as resp, tmp.open("wb") as out:
        shutil.copyfileobj(resp, out, length=1 << 20)
    if md5 is not None and _md5(tmp) != md5:
        tmp.unlink()
        raise ValueError(f"checksum mismatch for {url}")
    tmp.replace(dest)
    return True


def _md5(path: Path) -> str:
    h = hashlib.md5(usedforsecurity=False)
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _extract_dir(archive: bytes, inner: str, dest: Path) -> int:
    """Extract every file under ``<top>/<inner>/`` of a GitHub archive into ``dest``."""
    count = 0
    with zipfile.ZipFile(io.BytesIO(archive)) as zf:
        for name in zf.namelist():
            parts = name.split("/", 1)
            if len(parts) < 2 or not parts[1].startswith(inner + "/") or name.endswith("/"):
                continue
            target = dest / parts[1][len(inner) + 1 :]
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(zf.read(name))
            count += 1
    return count


def fetch_key() -> Path:
    base = DATASETS / "giantsteps-key"
    repo = _get(KEY_REPO_ZIP)
    n = _extract_dir(repo, "annotations/key", base / "annotations")
    print(f"key: {n} annotations")
    record = json.loads(_get(KEY_ZENODO))
    audio = next(f for f in record["files"] if f["key"] == "audio.zip")
    md5 = audio["checksum"].split(":", 1)[1]
    archive = base / "audio.zip"
    print(f"key: downloading audio.zip ({audio['size'] // 1048576} MB)…")
    _download(audio["links"]["self"], archive, md5)
    with zipfile.ZipFile(archive) as zf:
        members = [m for m in zf.namelist() if m.lower().endswith(".mp3")]
        for m in members:
            target = base / "audio" / Path(m).name
            if not target.exists():
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(zf.read(m))
    print(f"key: {len(members)} audio files in {base / 'audio'}")
    return base


def _fetch_audio(base: Path, url_base: str, label: str, workers: int) -> None:
    """Download ``<stem>.mp3`` for every ``md5/<stem>.md5``, verifying each checksum."""
    jobs = []
    for md5_file in sorted((base / "md5").glob("*.md5")):
        stem = md5_file.name.removesuffix(".md5")
        expected = md5_file.read_text().split()[0].strip()
        jobs.append((url_base + stem + ".mp3", base / "audio" / f"{stem}.mp3", expected))

    failed: list[str] = []

    def one(job: tuple[str, Path, str]) -> None:
        url, dest, md5 = job
        try:
            _download(url, dest, md5)
        except Exception as exc:
            failed.append(f"{dest.name}: {exc}")

    with ThreadPoolExecutor(workers) as pool:
        for i, _ in enumerate(pool.map(one, jobs), 1):
            if i % 50 == 0:
                print(f"{label}: {i}/{len(jobs)}")
    print(f"{label}: {len(jobs) - len(failed)}/{len(jobs)} audio files ({len(failed)} failed)")
    for line in failed[:10]:
        print("  ", line, file=sys.stderr)


def fetch_tempo(workers: int = 8) -> Path:
    base = DATASETS / "giantsteps-tempo"
    repo = _get(TEMPO_REPO_ZIP)
    n1 = _extract_dir(repo, "annotations/tempo", base / "annotations")
    n2 = _extract_dir(repo, "annotations_v2/tempo", base / "annotations_v2")
    _extract_dir(repo, "annotations/genre", base / "genre")
    _extract_dir(repo, "md5", base / "md5")
    print(f"tempo: {n1} annotations, {n2} v2 annotations")
    _fetch_audio(base, TEMPO_AUDIO_BASE, "tempo", workers)
    return base


def fetch_mtg_key(workers: int = 8) -> Path:
    base = DATASETS / "giantsteps-mtg-key"
    repo = _get(MTG_KEY_REPO_ZIP)
    _extract_dir(repo, "annotations", base / "annotations")
    _extract_dir(repo, "md5", base / "md5")
    _fetch_audio(base, MTG_KEY_AUDIO_BASE, "mtg-key", workers)
    return base


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("datasets", nargs="+", choices=["key", "tempo", "mtg-key"])
    args = parser.parse_args()
    if "key" in args.datasets:
        fetch_key()
    if "tempo" in args.datasets:
        fetch_tempo()
    if "mtg-key" in args.datasets:
        fetch_mtg_key()


if __name__ == "__main__":
    main()
