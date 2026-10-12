#!/usr/bin/env python3
"""Set Tonalia's version in every file that carries it (SPEC 10.3).

The release workflow requires the tag ``vX.Y.Z`` to match tauri.conf.json, package.json and
Cargo.toml; the engine reports its own (``engine.version``). Only Tonalia's own entries
change: dependencies that share the number are left alone.

Usage: python scripts/bump_version.py 0.2.0      (set)
       python scripts/bump_version.py --check    (fail if the files disagree)
"""

from __future__ import annotations

import argparse
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SEMVER = r"\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?"

# File → pattern whose group 2 is the version (group 1 and 3 are kept as they are).
PATTERNS: dict[str, re.Pattern[str]] = {
    "app/src-tauri/tauri.conf.json": re.compile(r'(\A\{[^{]*?\n  "version": ")([^"]+)(")'),
    "app/package.json": re.compile(r'(\A\{[^{]*?\n  "version": ")([^"]+)(")'),
    "app/src-tauri/Cargo.toml": re.compile(
        r'(\[package\]\nname = "tonalia"\nversion = ")([^"]+)(")'
    ),
    "app/src-tauri/Cargo.lock": re.compile(r'(\nname = "tonalia"\nversion = ")([^"]+)(")'),
    "engine/pyproject.toml": re.compile(
        r'(\[project\]\nname = "tonalia-engine"\nversion = ")([^"]+)(")'
    ),
    "engine/uv.lock": re.compile(r'(\nname = "tonalia-engine"\nversion = ")([^"]+)(")'),
    "engine/tonalia_engine/__init__.py": re.compile(r'(\n__version__ = ")([^"]+)(")'),
}


def current_versions(root: Path = ROOT) -> dict[str, str]:
    found = {}
    for rel, pattern in PATTERNS.items():
        match = pattern.search((root / rel).read_text(encoding="utf-8"))
        if not match:
            raise SystemExit(f"{rel}: Tonalia's version not found")
        found[rel] = match.group(2)
    return found


def set_version(root: Path, version: str) -> None:
    if not re.fullmatch(SEMVER, version):
        raise SystemExit(f"not a semantic version (X.Y.Z): {version!r}")
    for rel, pattern in PATTERNS.items():
        path = root / rel
        text = path.read_text(encoding="utf-8")
        new, count = pattern.subn(lambda m: f"{m.group(1)}{version}{m.group(3)}", text, count=1)
        if count != 1:
            raise SystemExit(f"{rel}: Tonalia's version not found")
        path.write_text(new, encoding="utf-8")


def check(root: Path = ROOT) -> list[str]:
    """Files whose version differs from tauri.conf.json's."""
    versions = current_versions(root)
    reference = versions["app/src-tauri/tauri.conf.json"]
    return [f"{rel}: {v}" for rel, v in versions.items() if v != reference]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("version", nargs="?")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    if args.check or not args.version:
        drift = check()
        if drift:
            raise SystemExit("versions disagree:\n" + "\n".join(drift))
        print(f"all files at {current_versions()['app/package.json']}")
        return
    set_version(ROOT, args.version)
    print(f"version set to {args.version}; commit, then tag v{args.version}")


if __name__ == "__main__":
    main()
