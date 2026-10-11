import hashlib
import importlib.util
import io
import json
import sys
import tarfile
import zipfile
from pathlib import Path
from types import ModuleType

import pytest

SCRIPTS = Path(__file__).resolve().parents[2] / "scripts"


def _load() -> ModuleType:
    spec = importlib.util.spec_from_file_location("fetch_binaries", SCRIPTS / "fetch_binaries.py")
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    sys.modules["fetch_binaries"] = mod
    spec.loader.exec_module(mod)
    return mod


fb = _load()


def test_lock_covers_ci_targets() -> None:
    table = json.loads((SCRIPTS / "binaries.lock.json").read_text(encoding="utf-8"))
    for triple in ("aarch64-apple-darwin", "x86_64-apple-darwin", "x86_64-pc-windows-msvc"):
        names = {e["name"] for e in table[triple]}
        assert {"ffmpeg", "rubberband"} <= names
        for e in table[triple]:
            assert len(e["sha256"]) == 64
            assert e["url"].startswith("https://")


def test_output_names() -> None:
    assert fb.output_name({"name": "ffmpeg", "sidecar": True}, "aarch64-apple-darwin") == (
        "ffmpeg-aarch64-apple-darwin"
    )
    assert fb.output_name({"name": "ffmpeg", "sidecar": True}, "x86_64-pc-windows-msvc") == (
        "ffmpeg-x86_64-pc-windows-msvc.exe"
    )
    assert fb.output_name({"name": "sndfile.dll"}, "x86_64-pc-windows-msvc") == "sndfile.dll"


def _zip_bytes() -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("pkg/bin/tool", b"#!/bin/sh\necho hi\n")
    return buf.getvalue()


def _tar_bytes() -> bytes:
    buf = io.BytesIO()
    data = b"binary"
    with tarfile.open(fileobj=buf, mode="w:bz2") as tf:
        info = tarfile.TarInfo("pkg/tool")
        info.size = len(data)
        tf.addfile(info, io.BytesIO(data))
    return buf.getvalue()


@pytest.mark.parametrize(
    ("payload", "member"), [(_zip_bytes(), "pkg/bin/tool"), (_tar_bytes(), "pkg/tool")]
)
def test_extract_member(tmp_path: Path, payload: bytes, member: str) -> None:
    archive = tmp_path / "a"
    archive.write_bytes(payload)
    dest = tmp_path / "out dir ñ 🎧" / "tool"
    fb.extract_member(archive, member, dest)
    assert dest.read_bytes()
    assert dest.stat().st_mode & 0o100 or sys.platform == "win32"


def test_download_rejects_bad_checksum(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    payload = b"tampered"

    class Resp(io.BytesIO):
        def __enter__(self) -> "Resp":
            return self

        def __exit__(self, *a: object) -> None:
            pass

    monkeypatch.setattr(fb.urllib.request, "urlopen", lambda *a, **k: Resp(payload))
    with pytest.raises(fb.ChecksumError):
        fb.download("https://example.invalid/x.zip", "0" * 64, tmp_path)
    assert not list(tmp_path.iterdir())

    good = hashlib.sha256(payload).hexdigest()
    path = fb.download("https://example.invalid/x.zip", good, tmp_path)
    assert path.read_bytes() == payload
