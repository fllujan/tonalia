"""Third-party attributions (SPEC 10.4): what ships, under which license, and the notices."""

import importlib.util
import json
import sys
from pathlib import Path
from types import ModuleType

import pytest

SCRIPTS = Path(__file__).resolve().parents[2] / "scripts"


def _load(name: str) -> ModuleType:
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / f"{name}.py")
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


tp = _load("third_party")


# ---- SPDX expressions and AGPL-3.0 compatibility ----


@pytest.mark.parametrize(
    "expression",
    [
        "MIT",
        "MIT OR Apache-2.0",
        "MIT/Apache-2.0",
        "Apache-2.0 / MIT",
        "(MIT OR Apache-2.0) AND Unicode-3.0",
        "Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT",
        "GPL-2.0-or-later WITH Bootloader-exception",
        "GPL-2.0-only OR MIT",
        "BSD-3-Clause AND 0BSD AND MIT AND Zlib AND CC0-1.0",
        "MPL-2.0",
        "OFL-1.1",
        "PSF-2.0",
        "LGPL-2.1-or-later",
    ],
)
def test_compatible_licenses(expression: str) -> None:
    assert tp.compatible(expression), expression


@pytest.mark.parametrize(
    "expression",
    [
        "GPL-2.0-only",
        "CC-BY-NC-4.0",
        "MIT AND GPL-2.0-only",
        "UNKNOWN",
        "",
        "MIT OR",
        "(MIT",
        "Proprietary",
    ],
)
def test_incompatible_or_unclear_licenses(expression: str) -> None:
    assert not tp.compatible(expression), expression


# ---- Python: license metadata and the runtime closure ----


def test_python_license_prefers_overrides_then_expression_then_classifiers() -> None:
    overrides = {"scipy": "BSD-3-Clause"}
    assert tp.python_license("scipy", None, "Copyright (c) 2001 Enthought", [], overrides) == (
        "BSD-3-Clause"
    )
    assert tp.python_license("numpy", "BSD-3-Clause AND MIT", "", [], {}) == "BSD-3-Clause AND MIT"
    assert tp.python_license("x", None, "MIT", [], {}) == "MIT"
    assert tp.python_license("x", None, "MIT License", [], {}) == "MIT"
    assert tp.python_license("x", None, "", ["License :: OSI Approved :: MIT License"], {}) == "MIT"
    pathspec = ["License :: OSI Approved :: Mozilla Public License 2.0 (MPL 2.0)"]
    assert tp.python_license("x", None, "", pathspec, {}) == "MPL-2.0"
    # "BSD" alone does not say which BSD: it must be reviewed (override), never guessed.
    assert tp.python_license("x", None, "BSD", ["License :: OSI Approved :: BSD License"], {}) == (
        "UNKNOWN"
    )


def test_python_closure_follows_runtime_requirements_only() -> None:
    requires = {
        "tonalia-engine": [
            "numpy>=2",
            "torch>=2.9; sys_platform == 'nowhere'",
            "pydantic>=2",
            "pytest; extra == 'dev'",
        ],
        "numpy": [],
        "pydantic": [
            "annotated-types>=0.6",
            "typing_extensions>=4",
            "email-validator; extra == 'email'",
        ],
        "annotated-types": [],
        "typing-extensions": [],
    }
    found = tp.python_closure("tonalia-engine", lambda name: requires[name])
    assert found == ["annotated-types", "numpy", "pydantic", "typing-extensions"]


# ---- Rust: shipped crates of one target ----


def test_rust_packages_skip_the_app_dev_and_build_dependencies() -> None:
    def pkg(name: str, license: str | None, folder: str = "") -> dict[str, object]:
        return {
            "id": f"{name}-id",
            "name": name,
            "version": "1.0.0",
            "license": license,
            "license_file": None,
            "repository": f"https://example.org/{name}",
            "homepage": None,
            "manifest_path": f"{folder or '/nowhere/' + name}/Cargo.toml",
        }

    def dep(name: str, kind: str | None) -> dict[str, object]:
        return {"pkg": f"{name}-id", "dep_kinds": [{"kind": kind, "target": None}]}

    metadata = {
        "packages": [
            pkg("tonalia", "AGPL-3.0-only"),
            pkg("tauri", "Apache-2.0 OR MIT"),
            pkg("serde", "MIT OR Apache-2.0"),
            pkg("tauri-build", "Apache-2.0 OR MIT"),
            pkg("tempfile", "MIT OR Apache-2.0"),
        ],
        "resolve": {
            "root": "tonalia-id",
            "nodes": [
                {
                    "id": "tonalia-id",
                    "deps": [
                        dep("tauri", None),
                        dep("tauri-build", "build"),
                        dep("tempfile", "dev"),
                    ],
                },
                {"id": "tauri-id", "deps": [dep("serde", None)]},
                {"id": "serde-id", "deps": []},
                {"id": "tauri-build-id", "deps": []},
                {"id": "tempfile-id", "deps": []},
            ],
        },
    }
    found = tp.rust_packages(metadata, {})
    assert [(p.name, p.license, p.component) for p in found] == [
        ("serde", "MIT OR Apache-2.0", "core"),
        ("tauri", "Apache-2.0 OR MIT", "core"),
    ]
    assert found[0].url == "https://example.org/serde"


# ---- Node: pnpm's production list ----


def test_node_packages_flatten_pnpm_output_and_read_license_files(tmp_path: Path) -> None:
    folder = tmp_path / "react ✨"
    folder.mkdir()
    (folder / "LICENSE").write_text("MIT License\n\nCopyright (c) Meta\n", encoding="utf-8")
    (folder / "README.md").write_text("not a license", encoding="utf-8")
    listing = {
        "MIT": [
            {
                "name": "react",
                "versions": ["18.3.1"],
                "paths": [str(folder)],
                "license": "MIT",
                "homepage": "https://react.dev/",
            }
        ],
        "Unknown": [{"name": "mystery", "versions": ["1.0.0"], "paths": [], "license": "Unknown"}],
    }
    found = tp.node_packages(listing, {"mystery": "ISC"})
    assert [(p.name, p.version, p.license) for p in found] == [
        ("mystery", "1.0.0", "ISC"),
        ("react", "18.3.1", "MIT"),
    ]
    react = found[1]
    assert react.component == "app" and react.url == "https://react.dev/"
    assert [name for name, _ in react.texts] == ["LICENSE"]
    assert "Copyright (c) Meta" in react.texts[0][1]


# ---- Output: the review check, the in-app list and the notices ----


def _package(name: str, license: str, text: str | None = None) -> object:
    return tp.Package(
        name=name,
        version="1.0",
        license=license,
        component="engine",
        texts=[("LICENSE", text)] if text else [],
    )


def test_check_lists_every_package_that_needs_review() -> None:
    tp.check([_package("ok", "MIT")])
    with pytest.raises(SystemExit) as err:
        tp.check(
            [_package("ok", "MIT"), _package("bad", "GPL-2.0-only"), _package("odd", "UNKNOWN")]
        )
    message = str(err.value)
    assert "bad 1.0 (GPL-2.0-only)" in message and "odd 1.0 (UNKNOWN)" in message
    assert "ok 1.0" not in message


def test_notices_print_each_identical_text_once() -> None:
    mit = "MIT License\r\nCopyright (c) Someone\r\n"
    notices = tp.notices_text(
        [
            _package("alpha", "MIT", mit),
            _package("beta", "MIT", mit),
            _package("gamma", "ISC", "ISC text"),
        ],
        target="aarch64-apple-darwin",
    )
    assert notices.count("Copyright (c) Someone") == 1
    assert "\r" not in notices
    assert "[engine] alpha 1.0 — MIT — text 1" in notices
    assert "[engine] beta 1.0 — MIT — text 1" in notices
    assert "[engine] gamma 1.0 — ISC — text 2" in notices
    assert "aarch64-apple-darwin" in notices


def test_listing_json_is_sorted_and_carries_the_acknowledgements() -> None:
    data = tp.listing(
        [_package("beta", "MIT"), _package("Alpha", "ISC")],
        target="x86_64-pc-windows-msvc",
        acknowledgements=[{"key": "keyProfiles"}],
    )
    assert data["target"] == "x86_64-pc-windows-msvc"
    assert [p["name"] for p in data["packages"]] == ["Alpha", "beta"]
    assert data["packages"][0] == {
        "name": "Alpha",
        "version": "1.0",
        "license": "ISC",
        "component": "engine",
        "url": "",
        "note": "",
    }
    assert data["acknowledgements"] == [{"key": "keyProfiles"}]


def test_bundled_entries_match_the_pinned_binaries() -> None:
    """The versions in licenses/bundled.json follow scripts/binaries.lock.json."""
    root = SCRIPTS.parent
    bundled = json.loads((root / "licenses" / "bundled.json").read_text(encoding="utf-8"))
    lock = json.loads((root / "scripts" / "binaries.lock.json").read_text(encoding="utf-8"))
    urls = {
        entry["name"]: entry["url"]
        for triple, entries in lock.items()
        if not triple.startswith("_")
        for entry in entries
    }
    for entry in bundled["packages"]:
        assert tp.compatible(entry["license"]), entry["name"]
        if "lock" in entry:
            assert entry["version"] in urls[entry["lock"]], entry["name"]
        for text in entry.get("texts", []):
            if not text.startswith("{binaries}"):
                assert (root / text).is_file(), text


def test_bundled_entries_are_filtered_by_target(tmp_path: Path) -> None:
    (tmp_path / "licenses").mkdir()
    (tmp_path / "licenses" / "LGPL.txt").write_text("LGPL text", encoding="utf-8")
    bins = tmp_path / "bins"
    (bins / "licenses").mkdir(parents=True)
    (bins / "licenses" / "tool.txt").write_text("tool text", encoding="utf-8")
    manual = {
        "packages": [
            {
                "name": "tool",
                "version": "1",
                "license": "GPL-2.0-or-later",
                "component": "bundled",
                "texts": ["{binaries}/licenses/tool.txt"],
            },
            {
                "name": "dll",
                "version": "",
                "license": "LGPL-2.1-or-later",
                "component": "bundled",
                "texts": ["licenses/LGPL.txt"],
                "targets": ["x86_64-pc-windows-msvc"],
                "noteKey": "windowsOnly",
            },
        ]
    }
    mac = tp.bundled_packages(manual, "aarch64-apple-darwin", tmp_path, bins)
    win = tp.bundled_packages(manual, "x86_64-pc-windows-msvc", tmp_path, bins)
    assert [p.name for p in mac] == ["tool"]
    assert mac[0].texts == [("tool.txt", "tool text")]
    assert [p.name for p in win] == ["tool", "dll"]
    assert win[1].note == "windowsOnly"


def test_packages_without_a_license_file_get_the_standard_texts(tmp_path: Path) -> None:
    (tmp_path / "MIT.txt").write_text("MIT standard", encoding="utf-8")
    (tmp_path / "Zlib.txt").write_text("Zlib standard", encoding="utf-8")
    bare = tp.Package(
        name="objc2", version="0.6", license="Zlib OR Apache-2.0 OR MIT", component="core"
    )
    kept = tp.Package(
        name="serde", version="1", license="MIT", component="core", texts=[("LICENSE-MIT", "own")]
    )
    remote = tp.Package(name="model", version="", license="MIT", component="download")
    tp.add_standard_texts([bare, kept, remote], tmp_path)
    assert [name for name, _ in bare.texts] == ["Zlib (standard text)", "MIT (standard text)"]
    assert kept.texts == [("LICENSE-MIT", "own")]
    assert remote.texts == []
