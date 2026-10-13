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


def test_bundle_config_creates_updater_artifacts_only_for_releases(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    build = _load("build_engine")
    monkeypatch.delenv("TONALIA_UPDATER_ARTIFACTS", raising=False)
    # The signing key alone does not switch it on: the engine build never needs the key.
    monkeypatch.setenv("TAURI_SIGNING_PRIVATE_KEY", "untrusted comment: key")
    assert "createUpdaterArtifacts" not in build.release_options()
    monkeypatch.setenv("TONALIA_UPDATER_ARTIFACTS", "1")
    assert build.release_options() == {"createUpdaterArtifacts": True}


# ---- macOS: ad-hoc signature and minimum version (SPEC 10.3) ----

OTOOL = """
Load command 9
      cmd LC_BUILD_VERSION
  cmdsize 32
 platform 1
    minos 14.0
      sdk 15.0
"""
OTOOL_OLD = """
Load command 8
      cmd LC_VERSION_MIN_MACOSX
  cmdsize 16
  version 10.13
      sdk 10.14
"""


def test_minimum_macos_from_otool() -> None:
    build = _load("build_engine")
    assert build.parse_minos(OTOOL) == (14, 0)
    assert build.parse_minos(OTOOL_OLD) == (10, 13)
    assert build.parse_minos("no load commands") is None
    assert build.format_version(max([(11, 0), (14, 0), (10, 13)])) == "14.0"


def test_macho_detection(tmp_path: Path) -> None:
    build = _load("build_engine")
    (tmp_path / "lib.dylib").write_bytes(bytes.fromhex("cffaedfe") + b"\0" * 28)
    (tmp_path / "fat").write_bytes(bytes.fromhex("cafebabe") + b"\0" * 28)
    (tmp_path / "script.py").write_text("print('hi')\n", encoding="utf-8")
    (tmp_path / "tiny").write_bytes(b"\xcf")
    (tmp_path / "link.dylib").symlink_to(tmp_path / "lib.dylib")
    assert sorted(p.name for p in build.macho_files(tmp_path)) == ["fat", "lib.dylib"]


def test_bundle_config_declares_the_minimum_macos(tmp_path: Path) -> None:
    build = _load("build_engine")
    triple = "aarch64-apple-darwin"
    lock = json.loads((SCRIPTS / "binaries.lock.json").read_text(encoding="utf-8"))[triple]
    for entry in lock:
        (tmp_path / build.output_name(entry, triple)).write_bytes(b"x")
    config = build.bundle_config(triple, tmp_path, macos_minimum="14.0")
    assert config["bundle"]["macOS"] == {"minimumSystemVersion": "14.0"}
    assert "macOS" not in build.bundle_config(triple, tmp_path)["bundle"]


@pytest.mark.skipif(sys.platform != "darwin", reason="codesign is macOS-only")
def test_adhoc_signature_is_valid(tmp_path: Path) -> None:
    import shutil
    import subprocess

    build = _load("build_engine")
    exe = tmp_path / "Carpeta ✨" / "tool"
    exe.parent.mkdir()
    shutil.copyfile("/usr/bin/true", exe)
    exe.chmod(0o755)
    build.adhoc_sign([exe])
    check = subprocess.run(
        ["codesign", "--verify", "--strict", "--verbose=2", str(exe)],
        capture_output=True,
        text=True,
    )
    assert check.returncode == 0, check.stderr
    info = subprocess.run(["codesign", "-dv", str(exe)], capture_output=True, text=True)
    assert "Signature=adhoc" in info.stderr
    assert build.macos_minimum([exe]) is not None


def test_developer_id_signing_uses_hardened_runtime_and_entitlements(tmp_path: Path) -> None:
    build = _load("build_engine")
    exe = tmp_path / "tool"
    identity = "Developer ID Application: Someone (TEAM123456)"
    cmd = build.sign_command(exe, identity)
    assert cmd[:4] == ["codesign", "--force", "--sign", identity]
    assert {"--timestamp", "--options"} <= set(cmd) and cmd[cmd.index("--options") + 1] == "runtime"
    assert cmd[cmd.index("--entitlements") + 1] == str(build.ENTITLEMENTS) and cmd[-1] == str(exe)
    # Without an identity: the ad-hoc signature, no runtime, no timestamp.
    assert build.sign_command(exe, None) == [
        "codesign", "--force", "--sign", "-", "--timestamp=none", str(exe)
    ]  # fmt: skip
    text = build.ENTITLEMENTS.read_text(encoding="utf-8")
    for key in ("cs.disable-library-validation", "cs.allow-unsigned-executable-memory"):
        assert f"com.apple.security.{key}" in text


def test_signing_identity_comes_from_the_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    build = _load("build_engine")
    monkeypatch.delenv("APPLE_SIGNING_IDENTITY", raising=False)
    assert build.signing_identity() is None
    monkeypatch.setenv("APPLE_SIGNING_IDENTITY", "  ")
    assert build.signing_identity() is None
    monkeypatch.setenv("APPLE_SIGNING_IDENTITY", "Developer ID Application: X (T)")
    assert build.signing_identity() == "Developer ID Application: X (T)"


def test_bundle_config_signs_with_the_developer_id(tmp_path: Path) -> None:
    build = _load("build_engine")
    triple = "aarch64-apple-darwin"
    lock = json.loads((SCRIPTS / "binaries.lock.json").read_text(encoding="utf-8"))[triple]
    for entry in lock:
        (tmp_path / build.output_name(entry, triple)).write_bytes(b"x")
    identity = "Developer ID Application: X (T)"
    config = build.bundle_config(triple, tmp_path, macos_minimum="14.0", signing_identity=identity)
    assert config["bundle"]["macOS"] == {
        "minimumSystemVersion": "14.0",
        "signingIdentity": identity,
        "hardenedRuntime": True,
        "entitlements": "Entitlements.plist",
    }


# ---- one version everywhere (SPEC 10.3) ----

FILES = {
    "app/src-tauri/tauri.conf.json": '{\n  "productName": "Tonalia",\n  "version": "0.1.0"\n}\n',
    "app/package.json": (
        '{\n  "name": "tonalia-app",\n  "version": "0.1.0",\n  "deps": {"x": "0.1.0"}\n}\n'
    ),
    "app/src-tauri/Cargo.toml": (
        '[package]\nname = "tonalia"\nversion = "0.1.0"\n\n'
        '[dependencies]\nserde = { version = "0.1.0" }\n'
    ),
    "app/src-tauri/Cargo.lock": (
        '[[package]]\nname = "serde"\nversion = "0.1.0"\n\n'
        '[[package]]\nname = "tonalia"\nversion = "0.1.0"\n'
    ),
    "engine/pyproject.toml": '[project]\nname = "tonalia-engine"\nversion = "0.1.0"\n',
    "engine/uv.lock": (
        '[[package]]\nname = "numpy"\nversion = "0.1.0"\n\n'
        '[[package]]\nname = "tonalia-engine"\nversion = "0.1.0"\n'
    ),
    "engine/tonalia_engine/__init__.py": '"""Tonalia."""\n\n__version__ = "0.1.0"\n',
}


def _repo(tmp_path: Path) -> Path:
    for rel, text in FILES.items():
        path = tmp_path / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
    return tmp_path


def test_bump_version_changes_only_tonalia_versions(tmp_path: Path) -> None:
    bump = _load("bump_version")
    root = _repo(tmp_path)
    assert bump.current_versions(root) == {rel: "0.1.0" for rel in FILES}
    bump.set_version(root, "0.2.0")
    assert bump.current_versions(root) == {rel: "0.2.0" for rel in FILES}
    # Dependencies that happen to share the old number are left alone.
    assert '"x": "0.1.0"' in (root / "app/package.json").read_text(encoding="utf-8")
    assert 'serde = { version = "0.1.0" }' in (root / "app/src-tauri/Cargo.toml").read_text(
        encoding="utf-8"
    )
    lock = (root / "app/src-tauri/Cargo.lock").read_text(encoding="utf-8")
    assert 'name = "serde"\nversion = "0.1.0"' in lock
    assert 'name = "tonalia"\nversion = "0.2.0"' in lock
    assert 'name = "numpy"\nversion = "0.1.0"' in (root / "engine/uv.lock").read_text(
        encoding="utf-8"
    )


def test_bump_version_rejects_bad_versions_and_detects_drift(tmp_path: Path) -> None:
    bump = _load("bump_version")
    root = _repo(tmp_path)
    with pytest.raises(SystemExit, match="semantic"):
        bump.set_version(root, "2")
    (root / "engine/pyproject.toml").write_text(
        '[project]\nname = "tonalia-engine"\nversion = "0.1.1"\n', encoding="utf-8"
    )
    assert bump.check(root) == ["engine/pyproject.toml: 0.1.1"]


def test_the_repository_versions_agree() -> None:
    bump = _load("bump_version")
    assert bump.check(SCRIPTS.parent) == []
