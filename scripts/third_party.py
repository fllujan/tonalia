#!/usr/bin/env python3
"""Generate the third-party attributions that ship with Tonalia (SPEC 10.4).

Collects what one build really distributes, for one target:
- engine: the runtime dependency closure of ``tonalia-engine`` in the running Python
  environment (the one PyInstaller bundles), plus CPython and the PyInstaller bootloader;
- app: the production npm packages of ``app/`` (``pnpm licenses list --prod``);
- core: the Rust crates compiled into the app for the target (``cargo metadata``);
- bundled/download: the hand-kept entries of ``licenses/bundled.json`` (FFmpeg, Rubber Band…).

Writes, under ``<out>/licenses/`` (bundled as the ``licenses/`` resource):
- ``third-party.json`` — the list shown in Settings → About;
- ``THIRD-PARTY-NOTICES.txt`` — every license text, each identical text printed once;
- ``LICENSE.txt`` — Tonalia's own AGPL-3.0.

Fails when a distributed package has a license that is unknown or not compatible with
AGPL-3.0, so a new dependency is reviewed (and recorded in docs/third-party.md) before it
ships. Run with the engine environment:
``uv run --project engine python scripts/third_party.py [--target TRIPLE] [--out DIR]``.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.metadata as md
import json
import platform
import re
import shutil
import subprocess
import sys
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from packaging.markers import default_environment
from packaging.requirements import Requirement
from packaging.utils import canonicalize_name

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fetch_binaries import DEFAULT_OUT, host_triple

ROOT = Path(__file__).resolve().parent.parent
LICENSES = ROOT / "licenses"

# ---- SPDX expressions and AGPL-3.0 compatibility ----

# Licenses whose code may be distributed inside an AGPL-3.0 program. Exceptions (`WITH …`)
# only add permissions, so they are accepted on top of an allowed license.
ALLOWED = frozenset(
    {
        "0BSD",
        "AGPL-3.0-only",
        "AGPL-3.0-or-later",
        "Apache-2.0",
        "BSD-2-Clause",
        "BSD-3-Clause",
        "BSL-1.0",
        "CC0-1.0",
        "GPL-2.0-or-later",
        "GPL-3.0-only",
        "GPL-3.0-or-later",
        "ISC",
        "LGPL-2.1-or-later",
        "LGPL-3.0-only",
        "LGPL-3.0-or-later",
        "MIT",
        "MIT-0",
        "MPL-2.0",
        "OFL-1.1",
        "PSF-2.0",
        "Python-2.0",
        "Unicode-3.0",
        "Unicode-DFS-2016",
        "Unlicense",
        "Zlib",
    }
)

_TOKEN = re.compile(r"\s*(\(|\)|[A-Za-z0-9.+:-]+)")


def _tokens(expression: str) -> list[str]:
    # Old Cargo manifests write "MIT/Apache-2.0" for "MIT OR Apache-2.0".
    text = expression.replace("/", " OR ")
    tokens: list[str] = []
    pos = 0
    while pos < len(text):
        match = _TOKEN.match(text, pos)
        if not match:
            if text[pos:].strip():
                raise ValueError(f"bad license expression {expression!r}")
            break
        tokens.append(match.group(1))
        pos = match.end()
    return tokens


def compatible(expression: str) -> bool:
    """True when the SPDX ``expression`` can ship in Tonalia (unclear means no)."""
    try:
        tokens = _tokens(expression)
    except ValueError:
        return False
    pos = 0

    def peek() -> str | None:
        return tokens[pos] if pos < len(tokens) else None

    def take() -> str:
        nonlocal pos
        if pos >= len(tokens):
            raise ValueError("unexpected end")
        pos += 1
        return tokens[pos - 1]

    def primary() -> bool:
        token = take()
        if token == "(":
            value = either()
            if take() != ")":
                raise ValueError("missing )")
            return value
        if token in {")", "AND", "OR", "WITH"}:
            raise ValueError(f"unexpected {token}")
        if peek() == "WITH":
            take()
            take()  # the exception id
        return token in ALLOWED

    def both() -> bool:
        value = primary()
        while peek() == "AND":
            take()
            value = primary() and value
        return value

    def either() -> bool:
        value = both()
        while peek() == "OR":
            take()
            value = both() or value
        return value

    try:
        result = either()
        return result and pos == len(tokens)
    except ValueError:
        return False


# ---- Packages ----


@dataclass
class Package:
    name: str
    version: str
    license: str
    component: str  # app | core | engine | bundled | download
    url: str = ""
    note: str = ""  # i18n key under licenses.notes
    texts: list[tuple[str, str]] = field(default_factory=list)  # (file name, text)


_LICENSE_FILE = re.compile(r"^(un)?licen[cs]e|^copying|^notice|^copyright", re.IGNORECASE)


def license_files(folder: Path) -> list[tuple[str, str]]:
    """The license-like files at the top of a package folder."""
    if not folder.is_dir():
        return []
    return [
        (path.name, path.read_text(encoding="utf-8", errors="replace"))
        for path in sorted(folder.iterdir(), key=lambda p: p.name.lower())
        if path.is_file() and _LICENSE_FILE.match(path.name)
    ]


# ---- Python ----

_CLASSIFIERS = {
    "MIT License": "MIT",
    "Apache Software License": "Apache-2.0",
    "Python Software Foundation License": "PSF-2.0",
    "Mozilla Public License 2.0 (MPL 2.0)": "MPL-2.0",
    "ISC License (ISCL)": "ISC",
    "GNU General Public License v2 or later (GPLv2+)": "GPL-2.0-or-later",
    "GNU General Public License v3 or later (GPLv3+)": "GPL-3.0-or-later",
    "GNU Lesser General Public License v2 or later (LGPLv2+)": "LGPL-2.1-or-later",
    "The Unlicense (Unlicense)": "Unlicense",
}
_ALIASES = {
    "MIT License": "MIT",
    "PSFL": "PSF-2.0",
    "Apache 2.0": "Apache-2.0",
    "BSD-3": "BSD-3-Clause",
}


def python_license(
    name: str,
    expression: str | None,
    text: str | None,
    classifiers: Iterable[str],
    overrides: dict[str, str],
) -> str:
    """One SPDX expression from a distribution's metadata, or ``UNKNOWN``."""
    if canonicalize_name(name) in overrides:
        return overrides[canonicalize_name(name)]
    if expression:
        return expression.strip()
    text = (text or "").strip()
    if text in _ALIASES:
        return _ALIASES[text]
    if text and "\n" not in text and compatible(text):
        return text
    mapped = {_CLASSIFIERS.get(c.split(" :: ")[-1]) for c in classifiers if c.startswith("License")}
    mapped.discard(None)
    if len(mapped) == 1:
        return str(mapped.pop())
    return "UNKNOWN"


def python_closure(root: str, requires: Callable[[str], list[str]]) -> list[str]:
    """Canonical names of the runtime dependencies of ``root`` on this platform."""
    env = {str(k): str(v) for k, v in default_environment().items()} | {"extra": ""}
    seen: set[str] = set()
    stack = [canonicalize_name(root)]
    while stack:
        name = stack.pop()
        if name in seen:
            continue
        seen.add(name)
        for raw in requires(name):
            req = Requirement(raw)
            if req.marker is None or req.marker.evaluate(env):
                stack.append(canonicalize_name(req.name))
    seen.discard(canonicalize_name(root))
    return sorted(seen)


def _dist_texts(dist: md.Distribution) -> list[tuple[str, str]]:
    texts = []
    for file in dist.files or []:
        parts = file.parts
        if parts and parts[0].endswith(".dist-info") and _LICENSE_FILE.match(file.name):
            path = Path(str(dist.locate_file(file)))
            texts.append(("/".join(parts[1:]), path.read_text(encoding="utf-8", errors="replace")))
    return texts


def _field(dist: md.Distribution, name: str) -> str | None:
    values = dist.metadata.get_all(name)
    return str(values[0]) if values else None


def _dist_url(dist: md.Distribution) -> str:
    urls: dict[str, str] = {}
    for entry in dist.metadata.get_all("Project-URL") or []:
        label, _, url = entry.partition(",")
        urls[str(label).strip().lower()] = str(url).strip()
    for label in ("source", "source code", "repository", "homepage", "home"):
        if label in urls:
            return urls[label]
    return _field(dist, "Home-page") or next(iter(urls.values()), "")


def _python_package(dist: md.Distribution, overrides: dict[str, str]) -> Package:
    meta = dist.metadata
    return Package(
        name=str(meta["Name"]),
        version=dist.version,
        license=python_license(
            str(meta["Name"]),
            _field(dist, "License-Expression"),
            _field(dist, "License"),
            meta.get_all("Classifier") or [],
            overrides,
        ),
        component="engine",
        url=_dist_url(dist),
        texts=_dist_texts(dist),
    )


def python_packages(overrides: dict[str, str]) -> list[Package]:
    def requires(name: str) -> list[str]:
        return md.distribution(name).requires or []

    found = [
        _python_package(md.distribution(n), overrides)
        for n in python_closure("tonalia-engine", requires)
    ]
    # The interpreter itself and PyInstaller's bootloader are inside the bundled engine.
    base = Path(sys.base_prefix)
    python_license_file = next(
        (
            p
            for p in (base / "lib" / "python3.11" / "LICENSE.txt", base / "LICENSE.txt")
            if p.is_file()
        ),
        None,
    )
    found.append(
        Package(
            name="Python",
            version=platform.python_version(),
            license="PSF-2.0",
            component="engine",
            url="https://www.python.org/",
            texts=[("LICENSE.txt", python_license_file.read_text(encoding="utf-8"))]
            if python_license_file
            else [],
        )
    )
    try:
        bootloader = md.distribution("pyinstaller")
    except md.PackageNotFoundError:
        pass  # dev environment without the build group: nothing is bundled
    else:
        found.append(
            Package(
                name="PyInstaller bootloader",
                version=bootloader.version,
                license="GPL-2.0-or-later WITH Bootloader-exception",
                component="engine",
                url="https://pyinstaller.org/",
                texts=_dist_texts(bootloader),
            )
        )
    return found


# ---- Node (pnpm) ----


def node_packages(
    listing: dict[str, list[dict[str, Any]]], overrides: dict[str, str]
) -> list[Package]:
    found = []
    for entries in listing.values():
        for entry in entries:
            name = str(entry["name"])
            paths = [Path(p) for p in entry.get("paths", [])]
            for i, version in enumerate(entry.get("versions", [])):
                folder = paths[i] if i < len(paths) else None
                found.append(
                    Package(
                        name=name,
                        version=str(version),
                        license=overrides.get(name, str(entry.get("license") or "UNKNOWN")),
                        component="app",
                        url=str(entry.get("homepage") or ""),
                        texts=license_files(folder) if folder else [],
                    )
                )
    return sorted(found, key=lambda p: (p.name.lower(), p.version))


def pnpm_listing(app: Path) -> dict[str, list[dict[str, Any]]]:
    pnpm = shutil.which("pnpm") or "pnpm"
    out = subprocess.run(
        [pnpm, "licenses", "list", "--prod", "--json"],
        cwd=app,
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
    ).stdout
    data: dict[str, list[dict[str, Any]]] = json.loads(out)
    return data


# ---- Rust (cargo) ----


def rust_packages(metadata: dict[str, Any], overrides: dict[str, str]) -> list[Package]:
    """Crates linked into the app: normal dependencies reachable from the root."""
    packages = {p["id"]: p for p in metadata["packages"]}
    nodes = {n["id"]: n for n in metadata["resolve"]["nodes"]}
    root = metadata["resolve"]["root"]
    seen: set[str] = set()
    stack = [root]
    while stack:
        current = stack.pop()
        if current in seen:
            continue
        seen.add(current)
        for dep in nodes[current]["deps"]:
            if any(kind["kind"] is None for kind in dep["dep_kinds"]):
                stack.append(dep["pkg"])
    seen.discard(root)
    found = []
    for pid in seen:
        p = packages[pid]
        folder = Path(p["manifest_path"]).parent
        texts = license_files(folder)
        if p.get("license_file") and not texts:
            file = folder / p["license_file"]
            if file.is_file():
                texts = [(file.name, file.read_text(encoding="utf-8", errors="replace"))]
        found.append(
            Package(
                name=p["name"],
                version=p["version"],
                license=overrides.get(p["name"], p.get("license") or "UNKNOWN"),
                component="core",
                url=p.get("repository") or p.get("homepage") or "",
                texts=texts,
            )
        )
    return sorted(found, key=lambda p: (p.name.lower(), p.version))


def cargo_metadata(manifest: Path, triple: str) -> dict[str, Any]:
    out = subprocess.run(
        [
            "cargo",
            "metadata",
            "--format-version",
            "1",
            "--locked",
            "--filter-platform",
            triple,
            "--manifest-path",
            str(manifest),
        ],
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
    ).stdout
    data: dict[str, Any] = json.loads(out)
    return data


# ---- Hand-kept entries ----


def bundled_packages(manual: dict[str, Any], triple: str, root: Path, bins: Path) -> list[Package]:
    found = []
    for entry in manual["packages"]:
        if "targets" in entry and triple not in entry["targets"]:
            continue
        texts = []
        for text in entry.get("texts", []):
            path = (
                Path(text.replace("{binaries}", str(bins)))
                if text.startswith("{binaries}")
                else root / text
            )
            texts.append((path.name, path.read_text(encoding="utf-8", errors="replace")))
        found.append(
            Package(
                name=entry["name"],
                version=entry.get("version", ""),
                license=entry["license"],
                component=entry["component"],
                url=entry.get("url", ""),
                note=entry.get("noteKey", ""),
                texts=texts,
            )
        )
    return found


def add_standard_texts(packages: Iterable[Package], spdx: Path) -> None:
    """Give packages that ship no license file the standard SPDX text of their licenses."""
    for p in packages:
        if p.texts or p.component == "download":
            continue
        try:
            ids = [t for t in _tokens(p.license) if t not in {"(", ")", "AND", "OR", "WITH"}]
        except ValueError:
            continue
        for license_id in dict.fromkeys(ids):
            path = spdx / f"{license_id}.txt"
            if path.is_file():
                p.texts.append((f"{license_id} (standard text)", path.read_text(encoding="utf-8")))


# ---- Output ----


def check(packages: Iterable[Package]) -> None:
    bad = [p for p in packages if not compatible(p.license)]
    if bad:
        lines = "\n".join(f"  [{p.component}] {p.name} {p.version} ({p.license})" for p in bad)
        raise SystemExit(
            "these packages need a license review before they ship:\n"
            f"{lines}\n"
            "If the license is AGPL-3.0 compatible but the metadata is unclear, add it to "
            "licenses/overrides.json and docs/third-party.md."
        )


def _normal(text: str) -> str:
    return text.replace("\r\n", "\n").replace("\r", "\n").strip() + "\n"


def notices_text(packages: list[Package], target: str) -> str:
    ids: dict[str, int] = {}
    bodies: list[tuple[str, list[str]]] = []  # (text, used by)
    index = []
    for p in packages:
        refs = []
        for file_name, raw in p.texts:
            text = _normal(raw)
            digest = hashlib.sha256(text.encode()).hexdigest()
            if digest not in ids:
                ids[digest] = len(bodies) + 1
                bodies.append((text, []))
            number = ids[digest]
            bodies[number - 1][1].append(f"{p.name} {p.version} ({file_name})")
            if number not in refs:
                refs.append(number)
        label = f"text {', '.join(map(str, refs))}" if refs else "no license file in the package"
        version = f" {p.version}" if p.version else ""
        index.append(f"[{p.component}] {p.name}{version} — {p.license} — {label}")
    parts = [
        "Tonalia — third-party software notices",
        f"Target: {target}. Generated by scripts/third_party.py.",
        "",
        "Tonalia is free software under the GNU Affero General Public License v3.0 (LICENSE.txt).",
        "It includes the third-party components below, each under its own license.",
        "Source code: https://github.com/fllujan/tonalia",
        "",
        "=" * 78,
        "Components",
        "=" * 78,
        *index,
    ]
    for number, (text, users) in enumerate(bodies, start=1):
        parts += [
            "",
            "=" * 78,
            f"Text {number} — used by: {'; '.join(users)}",
            "=" * 78,
            text.rstrip(),
        ]
    return "\n".join(parts) + "\n"


def listing(
    packages: list[Package], target: str, acknowledgements: list[dict[str, str]]
) -> dict[str, Any]:
    ordered = sorted(packages, key=lambda p: (p.name.lower(), p.version))
    return {
        "version": 1,
        "target": target,
        "packages": [
            {
                "name": p.name,
                "version": p.version,
                "license": p.license,
                "component": p.component,
                "url": p.url,
                "note": p.note,
            }
            for p in ordered
        ],
        "acknowledgements": acknowledgements,
    }


def generate(triple: str, out: Path) -> Path:
    manual = json.loads((LICENSES / "bundled.json").read_text(encoding="utf-8"))
    overrides = json.loads((LICENSES / "overrides.json").read_text(encoding="utf-8"))
    packages = [
        *bundled_packages(manual, triple, ROOT, out),
        *python_packages({canonicalize_name(k): v for k, v in overrides["python"].items()}),
        *rust_packages(
            cargo_metadata(ROOT / "app" / "src-tauri" / "Cargo.toml", triple), overrides["rust"]
        ),
        *node_packages(pnpm_listing(ROOT / "app"), overrides["node"]),
    ]
    check(packages)
    add_standard_texts(packages, LICENSES / "spdx")
    folder = out / "licenses"
    folder.mkdir(parents=True, exist_ok=True)
    data = listing(packages, triple, manual.get("acknowledgements", []))
    (folder / "third-party.json").write_text(
        json.dumps(data, indent=1, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    (folder / "THIRD-PARTY-NOTICES.txt").write_text(
        notices_text(packages, triple), encoding="utf-8"
    )
    shutil.copyfile(ROOT / "LICENSE", folder / "LICENSE.txt")
    return folder


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--target", default=None, help="Rust target triple (default: host)")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args()
    triple = args.target or host_triple()
    folder = generate(triple, args.out)
    count = len(json.loads((folder / "third-party.json").read_text(encoding="utf-8"))["packages"])
    # ASCII only: Windows consoles default to cp1252.
    print(f"{count} third-party components for {triple} -> {folder}")


if __name__ == "__main__":
    main()
