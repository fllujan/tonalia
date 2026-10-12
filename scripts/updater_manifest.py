#!/usr/bin/env python3
"""Write ``latest.json`` for the Tauri updater from the signed release bundles (SPEC 10.2).

Each ``--artifact PLATFORM=PATH`` is an updater bundle with its ``PATH.sig`` next to it
(``tauri build`` with ``createUpdaterArtifacts`` and ``TAURI_SIGNING_PRIVATE_KEY``):
``Tonalia.app.tar.gz`` on macOS, the NSIS ``…-setup.exe`` on Windows. They are copied to
``--out`` with names unique per platform (both macOS bundles are called
``Tonalia.app.tar.gz``) and listed in ``--out/latest.json``, which the app downloads from
``releases/latest/download/latest.json``.

Usage: python scripts/updater_manifest.py --version v0.2.0 --base-url URL --out DIR \\
           [--notes-file NOTES.md] --artifact darwin-aarch64=PATH [--artifact …]
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path

PLATFORMS = {
    "darwin-aarch64": "aarch64",
    "darwin-x86_64": "x64",
    "windows-x86_64": "x64",
}
VERSION = re.compile(r"^v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$")


def parse_artifact(value: str) -> tuple[str, Path]:
    platform, sep, path = value.partition("=")
    if not sep or not platform or not path:
        raise SystemExit(f"--artifact expects PLATFORM=PATH, got {value!r}")
    return platform, Path(path)


def _published_name(platform: str, path: Path, version: str) -> str:
    if platform.startswith("darwin"):
        return f"Tonalia_{version}_{PLATFORMS[platform]}.app.tar.gz"
    return path.name


def _now() -> str:
    # timezone.utc rather than datetime.UTC: the release job runs any python3.
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")  # noqa: UP017


def build_manifest(
    version: str,
    notes: str,
    base_url: str,
    artifacts: dict[str, Path],
    out: Path,
    pub_date: str | None = None,
) -> dict[str, object]:
    match = VERSION.match(version)
    if not match:
        raise SystemExit(f"not a semantic version: {version!r}")
    plain = match.group(1)
    platforms: dict[str, dict[str, str]] = {}
    out.mkdir(parents=True, exist_ok=True)
    for platform, path in artifacts.items():
        if platform not in PLATFORMS:
            raise SystemExit(f"unknown platform {platform!r} (expected one of {sorted(PLATFORMS)})")
        sig = path.with_name(path.name + ".sig")
        if not sig.is_file():
            raise SystemExit(
                f"{path.name} has no signature ({sig.name}); set TAURI_SIGNING_PRIVATE_KEY"
            )
        name = _published_name(platform, path, plain)
        shutil.copyfile(path, out / name)
        platforms[platform] = {
            "signature": sig.read_text(encoding="utf-8").strip(),
            "url": f"{base_url.rstrip('/')}/{name}",
        }
    data: dict[str, object] = {
        "version": plain,
        "notes": notes.strip(),
        "pub_date": pub_date or _now(),
        "platforms": platforms,
    }
    text = json.dumps(data, indent=2, ensure_ascii=False) + "\n"
    (out / "latest.json").write_text(text, encoding="utf-8")
    return data


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--version", required=True)
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--notes-file", type=Path, default=None)
    parser.add_argument("--artifact", action="append", type=parse_artifact, required=True)
    args = parser.parse_args()
    notes = args.notes_file.read_text(encoding="utf-8") if args.notes_file else ""
    data = build_manifest(args.version, notes, args.base_url, dict(args.artifact), args.out)
    print(f"latest.json for {data['version']}: {', '.join(data['platforms'])}")  # type: ignore[arg-type]


if __name__ == "__main__":
    main()
