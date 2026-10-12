#!/usr/bin/env python3
"""Build the engine with PyInstaller (one-folder) and write the Tauri bundle config.

Outputs, under ``app/src-tauri/binaries/``:
- ``engine/`` — the PyInstaller folder (``tonalia-engine[.exe]`` + ``_internal/``),
  bundled as the ``engine/`` resource and launched by ``engine.rs``;
- ``tauri.bundle.conf.json`` — merged into ``tauri build --config`` with the
  ``externalBin`` sidecars (ffmpeg, rubberband) and resources for this target.

Run ``fetch_binaries.py`` first. Usage: python scripts/build_engine.py [--target TRIPLE]
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fetch_binaries import DEFAULT_OUT, host_triple, output_name

ROOT = Path(__file__).resolve().parent.parent
ENGINE = ROOT / "engine"
LOCK = Path(__file__).resolve().parent / "binaries.lock.json"


def bundle_config(triple: str, bins: Path, macos_minimum: str | None = None) -> dict[str, object]:
    entries = json.loads(LOCK.read_text(encoding="utf-8"))[triple]
    missing = [
        output_name(e, triple) for e in entries if not (bins / output_name(e, triple)).exists()
    ]
    if missing:
        raise SystemExit(f"missing binaries {missing}: run scripts/fetch-binaries first")
    external = [f"binaries/{e['name']}" for e in entries if e.get("sidecar")]
    resources = {"binaries/engine/": "engine/", "binaries/licenses/": "licenses/"}
    for e in entries:
        if not e.get("sidecar"):
            resources[f"binaries/{e['name']}"] = str(e["name"])
    bundle: dict[str, object] = {
        "externalBin": external,
        "resources": resources,
        **release_options(),
    }
    if macos_minimum:
        bundle["macOS"] = {"minimumSystemVersion": macos_minimum}
    return {"bundle": bundle}


# ---- macOS (SPEC 10.3): ad-hoc signature of every binary and the real minimum version ----

MACHO_MAGICS = {
    bytes.fromhex(m)
    for m in ("feedface", "feedfacf", "cefaedfe", "cffaedfe", "cafebabe", "bebafeca")
}


def is_macho(path: Path) -> bool:
    if path.is_symlink() or not path.is_file():
        return False
    with path.open("rb") as f:
        return f.read(4) in MACHO_MAGICS


def macho_files(root: Path) -> list[Path]:
    """Mach-O executables and libraries under ``root`` (symlinks skipped)."""
    return [path for path in sorted(root.rglob("*")) if is_macho(path)]


def parse_minos(otool_output: str) -> tuple[int, ...] | None:
    """The minimum macOS in ``otool -l`` output (LC_BUILD_VERSION or LC_VERSION_MIN_MACOSX)."""
    match = re.search(r"^\s*(?:minos|version)\s+(\d+(?:\.\d+)*)\s*$", otool_output, re.M)
    return tuple(int(x) for x in match.group(1).split(".")) if match else None


def format_version(version: tuple[int, ...]) -> str:
    return ".".join(str(x) for x in (*version, 0)[: max(2, len(version))])


def macos_minimum(files: list[Path]) -> str | None:
    """The highest minimum macOS among ``files``: the app cannot run below it."""
    versions = []
    for path in files:
        out = subprocess.run(["otool", "-l", str(path)], capture_output=True, text=True)
        version = parse_minos(out.stdout)
        if version:
            versions.append(version)
    return format_version(max(versions)) if versions else None


def macho_files_of_sidecars(bins: Path, triple: str) -> list[Path]:
    entries = json.loads(LOCK.read_text(encoding="utf-8"))[triple]
    return [p for e in entries if is_macho(p := bins / output_name(e, triple))]


def adhoc_sign(files: list[Path]) -> None:
    """Ad-hoc signature (no Apple certificate): Apple Silicon refuses unsigned code."""
    for path in files:
        subprocess.run(
            ["codesign", "--force", "--sign", "-", "--timestamp=none", str(path)],
            check=True,
            capture_output=True,
        )


def release_options() -> dict[str, object]:
    """Signed updater bundles (SPEC 10.2) only in the release workflow, which sets the flag
    (and gives the signing key to the ``tauri build`` step alone)."""
    return {"createUpdaterArtifacts": True} if os.environ.get("TONALIA_UPDATER_ARTIFACTS") else {}


def build(triple: str, out: Path) -> Path:
    work = ROOT / ".cache" / "pyinstaller"
    dist = work / "dist"
    cmd = [
        "uv", "run", "--project", str(ENGINE), "--group", "build",
        "pyinstaller", "--noconfirm", "--clean", "--onedir",
        "--name", "tonalia-engine",
        "--distpath", str(dist), "--workpath", str(work / "build"), "--specpath", str(work),
        "--paths", str(ENGINE),
        "--collect-data", "tonalia_engine",  # analysis config (key_weights.json, ...)
        str(ENGINE / "packaging" / "entry.py"),
    ]  # fmt: skip
    subprocess.run(cmd, check=True)
    target = out / "engine"
    if target.exists():
        shutil.rmtree(target)
    shutil.copytree(dist / "tonalia-engine", target, symlinks=True)
    return target


def smoke_test(engine_dir: Path, triple: str) -> None:
    exe = engine_dir / ("tonalia-engine.exe" if "windows" in triple else "tonalia-engine")
    req = '{"jsonrpc":"2.0","id":1,"method":"engine.ping"}\n'
    # Use a throwaway data dir so the smoke test never creates a database in the user's
    # real application data folder.
    with tempfile.TemporaryDirectory() as data:
        env = {**os.environ, "TONALIA_DATA_DIR": data}
        proc = subprocess.run(
            [str(exe)], input=req, capture_output=True, text=True, timeout=60, env=env
        )
    lines = [json.loads(line) for line in proc.stdout.splitlines() if line.strip()]
    if not any(m.get("result") == {"pong": True} for m in lines):
        raise SystemExit(f"engine smoke test failed:\n{proc.stdout}\n{proc.stderr}")
    print(f"  smoke test OK ({exe.name} answered engine.ping)")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--target", default=None)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args()
    triple = args.target or host_triple()
    bundle_config(triple, args.out)  # fail early when the sidecars are missing
    engine_dir = build(triple, args.out)
    minimum = None
    if "apple-darwin" in triple:
        binaries = macho_files(engine_dir) + macho_files_of_sidecars(args.out, triple)
        adhoc_sign(binaries)
        minimum = macos_minimum(binaries)
    smoke_test(engine_dir, triple)
    config = bundle_config(triple, args.out, macos_minimum=minimum)
    conf_path = args.out / "tauri.bundle.conf.json"
    conf_path.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
    print(f"Engine built for {triple}: {engine_dir}\nBundle config: {conf_path}")
    if minimum:
        print(f"macOS minimum (from the bundled binaries): {minimum}")


if __name__ == "__main__":
    main()
