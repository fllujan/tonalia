"""Release tooling (SPEC 10.2): the updater manifest and the signed bundle config."""

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


manifest = _load("updater_manifest")

BASE = "https://github.com/fllujan/tonalia/releases/download/v0.2.0"


def _artifact(folder: Path, name: str, signature: str) -> Path:
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / name
    path.write_bytes(b"bundle " + name.encode())
    (folder / f"{name}.sig").write_text(signature + "\n", encoding="utf-8")
    return path


def test_manifest_lists_each_platform_with_unique_names(tmp_path: Path) -> None:
    arm = _artifact(tmp_path / "arm" / "macos", "Tonalia.app.tar.gz", "SIG-ARM")
    intel = _artifact(tmp_path / "intel" / "macos", "Tonalia.app.tar.gz", "SIG-INTEL")
    win = _artifact(tmp_path / "win" / "nsis", "Tonalia_0.2.0_x64-setup.exe", "SIG-WIN")
    out = tmp_path / "Release ✨"
    data = manifest.build_manifest(
        version="v0.2.0",
        notes="Novedades: atajos de teclado.",
        base_url=BASE,
        artifacts={"darwin-aarch64": arm, "darwin-x86_64": intel, "windows-x86_64": win},
        out=out,
        pub_date="2026-10-12T12:00:00Z",
    )
    assert data["version"] == "0.2.0"
    assert data["notes"] == "Novedades: atajos de teclado."
    assert data["pub_date"] == "2026-10-12T12:00:00Z"
    platforms = data["platforms"]
    assert platforms["darwin-aarch64"] == {
        "signature": "SIG-ARM",
        "url": f"{BASE}/Tonalia_0.2.0_aarch64.app.tar.gz",
    }
    assert platforms["darwin-x86_64"]["url"] == f"{BASE}/Tonalia_0.2.0_x64.app.tar.gz"
    assert platforms["windows-x86_64"] == {
        "signature": "SIG-WIN",
        "url": f"{BASE}/Tonalia_0.2.0_x64-setup.exe",
    }
    # The two macOS archives no longer collide; latest.json sits next to them.
    files = sorted(p.name for p in out.iterdir())
    assert files == [
        "Tonalia_0.2.0_aarch64.app.tar.gz",
        "Tonalia_0.2.0_x64-setup.exe",
        "Tonalia_0.2.0_x64.app.tar.gz",
        "latest.json",
    ]
    assert json.loads((out / "latest.json").read_text(encoding="utf-8")) == data


def test_manifest_refuses_unsigned_or_unknown_artifacts(tmp_path: Path) -> None:
    unsigned = tmp_path / "Tonalia.app.tar.gz"
    unsigned.write_bytes(b"x")
    with pytest.raises(SystemExit, match="signature"):
        manifest.build_manifest("0.2.0", "", BASE, {"darwin-aarch64": unsigned}, tmp_path / "o")
    signed = _artifact(tmp_path / "s", "a.tar.gz", "SIG")
    with pytest.raises(SystemExit, match="platform"):
        manifest.build_manifest("0.2.0", "", BASE, {"linux-x86_64": signed}, tmp_path / "o")
    with pytest.raises(SystemExit, match="version"):
        manifest.build_manifest("latest", "", BASE, {"darwin-aarch64": signed}, tmp_path / "o")


def test_parse_artifact_arguments(tmp_path: Path) -> None:
    assert manifest.parse_artifact("darwin-aarch64=/tmp/a b/Tonalia.app.tar.gz") == (
        "darwin-aarch64",
        Path("/tmp/a b/Tonalia.app.tar.gz"),
    )
    with pytest.raises(SystemExit):
        manifest.parse_artifact("no-equals-sign")


def test_bundle_config_creates_updater_artifacts_only_when_signing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    build = _load("build_engine")
    monkeypatch.delenv("TAURI_SIGNING_PRIVATE_KEY", raising=False)
    assert "createUpdaterArtifacts" not in build.release_options()
    monkeypatch.setenv("TAURI_SIGNING_PRIVATE_KEY", "untrusted comment: key")
    assert build.release_options() == {"createUpdaterArtifacts": True}
