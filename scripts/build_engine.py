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
import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fetch_binaries import DEFAULT_OUT, host_triple, output_name

ROOT = Path(__file__).resolve().parent.parent
ENGINE = ROOT / "engine"
LOCK = Path(__file__).resolve().parent / "binaries.lock.json"


def bundle_config(triple: str, bins: Path) -> dict[str, object]:
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
    return {"bundle": {"externalBin": external, "resources": resources}}


def build(triple: str, out: Path) -> Path:
    work = ROOT / ".cache" / "pyinstaller"
    dist = work / "dist"
    cmd = [
        "uv", "run", "--project", str(ENGINE), "--group", "build",
        "pyinstaller", "--noconfirm", "--clean", "--onedir",
        "--name", "tonalia-engine",
        "--distpath", str(dist), "--workpath", str(work / "build"), "--specpath", str(work),
        "--paths", str(ENGINE),
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
    proc = subprocess.run([str(exe)], input=req, capture_output=True, text=True, timeout=60)
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
    config = bundle_config(triple, args.out)
    engine_dir = build(triple, args.out)
    smoke_test(engine_dir, triple)
    conf_path = args.out / "tauri.bundle.conf.json"
    conf_path.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
    print(f"Engine built for {triple}: {engine_dir}\nBundle config: {conf_path}")


if __name__ == "__main__":
    main()
