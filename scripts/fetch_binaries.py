#!/usr/bin/env python3
"""Download pinned FFmpeg and Rubber Band executables for a target triple.

Every archive is verified against the SHA-256 in ``binaries.lock.json`` before
anything is extracted. Sidecars are written as ``<name>-<triple>[.exe]`` into
``app/src-tauri/binaries/`` (the Tauri ``externalBin`` convention); other files keep
their name. Downloads are cached in ``.cache/binaries`` at the repo root.

Usage: python3 scripts/fetch_binaries.py [--target TRIPLE] [--out DIR]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import platform
import shutil
import stat
import subprocess
import sys
import tarfile
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOCK = Path(__file__).resolve().parent / "binaries.lock.json"
DEFAULT_OUT = ROOT / "app" / "src-tauri" / "binaries"
CACHE = ROOT / ".cache" / "binaries"


class ChecksumError(RuntimeError):
    pass


def host_triple() -> str:
    try:
        out = subprocess.run(["rustc", "-vV"], capture_output=True, text=True, check=True).stdout
        for line in out.splitlines():
            if line.startswith("host:"):
                return line.split(":", 1)[1].strip()
    except (OSError, subprocess.CalledProcessError):
        pass
    machine = platform.machine().lower()
    arch = "aarch64" if machine in ("arm64", "aarch64") else "x86_64"
    if sys.platform == "darwin":
        return f"{arch}-apple-darwin"
    if sys.platform == "win32":
        return f"{arch}-pc-windows-msvc"
    return f"{arch}-unknown-linux-gnu"


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def download(url: str, sha256: str, cache: Path) -> Path:
    cache.mkdir(parents=True, exist_ok=True)
    dest = cache / f"{sha256[:16]}-{url.rsplit('/', 1)[-1]}"
    if dest.exists() and sha256_of(dest) == sha256:
        return dest
    print(f"  downloading {url}")
    tmp = dest.with_suffix(dest.suffix + ".part")
    req = urllib.request.Request(url, headers={"User-Agent": "tonalia-fetch-binaries/1.0"})
    with urllib.request.urlopen(req, timeout=120) as resp, tmp.open("wb") as f:
        shutil.copyfileobj(resp, f)
    actual = sha256_of(tmp)
    if actual != sha256:
        tmp.unlink()
        raise ChecksumError(f"checksum mismatch for {url}: expected {sha256}, got {actual}")
    tmp.replace(dest)
    return dest


def extract_member(archive: Path, member: str, dest: Path, executable: bool = True) -> None:
    """Extract a single archive member to ``dest`` (no path traversal possible)."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_name(dest.name + ".part")
    if zipfile.is_zipfile(archive):
        with zipfile.ZipFile(archive) as zf, zf.open(member) as src, tmp.open("wb") as out:
            shutil.copyfileobj(src, out)
    else:
        with tarfile.open(archive) as tf:
            fileobj = tf.extractfile(member)
            if fileobj is None:
                raise FileNotFoundError(f"{member} is not a regular file in {archive}")
            with fileobj, tmp.open("wb") as out:
                shutil.copyfileobj(fileobj, out)
    if executable:
        tmp.chmod(tmp.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    tmp.replace(dest)


def output_name(entry: dict[str, object], triple: str) -> str:
    name = str(entry["name"])
    if not entry.get("sidecar"):
        return name
    ext = ".exe" if "windows" in triple else ""
    return f"{name}-{triple}{ext}"


def fetch(triple: str, out: Path, cache: Path = CACHE, lock: Path = LOCK) -> list[Path]:
    table = json.loads(lock.read_text(encoding="utf-8"))
    if triple not in table:
        supported = ", ".join(k for k in table if not k.startswith("_"))
        raise SystemExit(f"unsupported target {triple!r} (supported: {supported})")
    written: list[Path] = []
    for entry in table[triple]:
        archive = download(str(entry["url"]), str(entry["sha256"]), cache)
        dest = out / output_name(entry, triple)
        extract_member(archive, str(entry["member"]), dest)
        written.append(dest)
        if "license" in entry:
            extract_member(
                archive,
                str(entry["license"]),
                out / "licenses" / f"{entry['name']}.txt",
                executable=False,
            )
        print(f"  {dest.relative_to(out)}")
    return written


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--target", default=None, help="Rust target triple (default: host)")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args()
    triple = args.target or host_triple()
    print(f"Fetching binaries for {triple} → {args.out}")
    fetch(triple, args.out)


if __name__ == "__main__":
    main()
