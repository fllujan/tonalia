"""Serato crates (SPEC 2.12): playlists as a "Tonalia" crate, in Serato DJ's own format."""

import os
import struct
from pathlib import Path
from typing import Any

import pytest

from tests.test_analysis_queue import call, wait_job
from tests.test_export_rekordbox import library
from tonalia_engine.export import serato_crates
from tonalia_engine.export.serato_crates import crate_bytes, crate_names, read_crate
from tonalia_engine.server import EngineContext

__all__ = ["library"]


def records(data: bytes) -> list[tuple[bytes, bytes]]:
    out, i = [], 0
    while i < len(data):
        (n,) = struct.unpack(">I", data[i + 4 : i + 8])
        out.append((data[i : i + 4], data[i + 8 : i + 8 + n]))
        i += 8 + n
    assert i == len(data)
    return out


# The start of a crate as Serato DJ Lite 4 writes it (version and the seven columns).
SERATO_HEADER = bytes.fromhex(
    "7672736e00000038" + "1.0/Serato ScratchLive Crate".encode("utf-16-be").hex()
) + b"".join(
    b"ovct"
    + struct.pack(">I", 16 + 2 * (len(name) + len(width)))
    + b"tvcn" + struct.pack(">I", 2 * len(name)) + name.encode("utf-16-be")
    + b"tvcw" + struct.pack(">I", 2 * len(width)) + width.encode("utf-16-be")
    for name, width in [
        ("song", "250"), ("artist", "250"), ("bpm", "30"), ("key", "30"),
        ("album", "250"), ("length", "250"), ("comment", "250"),
    ]
)  # fmt: skip


def test_crate_layout_matches_serato() -> None:
    data = crate_bytes(["/Users/dj/Música/a & b.mp3", "/Users/dj/x.flac"])
    assert data.startswith(SERATO_HEADER)
    tracks = records(data[len(SERATO_HEADER) :])
    assert [tag for tag, _ in tracks] == [b"otrk", b"otrk"]
    assert records(tracks[0][1]) == [(b"ptrk", "Users/dj/Música/a & b.mp3".encode("utf-16-be"))]
    assert read_crate(data) == ["Users/dj/Música/a & b.mp3", "Users/dj/x.flac"]
    assert crate_bytes([]) == SERATO_HEADER


def test_crate_names_are_safe() -> None:
    # "%%" separates a subcrate from its parent in Serato's file names.
    assert crate_names(["Mias", "A/B: C?", "mias", "50%%", ""]) == [
        "Mias", "A_B_ C_", "mias (2)", "50%", "Playlist",
    ]  # fmt: skip


def export(ctx: EngineContext, **options: Any) -> dict[str, Any]:
    # The shared library's files are not real audio: only the crates are tested here
    # (test_export_serato covers the cues written into the files).
    options = {"cues": False, **options}
    finished = wait_job(ctx, call(ctx, "export.serato", options)["jobId"])
    assert finished["status"] == "done", finished
    result: dict[str, Any] = finished["result"]
    return result


def neworder(folder: Path) -> list[str]:
    raw = (folder / "neworder.pref").read_bytes()
    text = raw.decode("utf-16-be")
    assert "\r" not in text and text.endswith("\n")
    return text.splitlines()


SERATO_ORDER = ("[begin record]\n[crate]Serato Demo Tracks\n[crate]Mine\n[end record]\n").encode(
    "utf-16-be"
)


def test_playlists_become_a_tonalia_crate(
    engine_ctx: EngineContext, library: dict[str, int], isolated_serato: Path
) -> None:
    subcrates = isolated_serato / "Subcrates"
    subcrates.mkdir(parents=True)
    (isolated_serato / "neworder.pref").write_bytes(SERATO_ORDER)
    (subcrates / "Mine.crate").write_bytes(crate_bytes(["/Users/dj/mine.mp3"]))
    (subcrates / "Tonalia%%Gone.crate").write_bytes(crate_bytes([]))  # an earlier export

    simulated = export(engine_ctx)
    assert simulated["playlists"] == 2
    assert sorted(p.name for p in subcrates.iterdir()) == ["Mine.crate", "Tonalia%%Gone.crate"]

    result = export(engine_ctx, simulate=False)
    assert result["playlists"] == 2
    export(engine_ctx, simulate=False)
    assert sorted(p.name for p in subcrates.iterdir()) == [
        "Mine.crate",
        "Tonalia%%Alta.crate",
        "Tonalia%%📁 Bolos%%🌅 Warm-up.crate",
        "Tonalia%%📁 Bolos.crate",
        "Tonalia.crate",
    ]
    assert read_crate((subcrates / "Mine.crate").read_bytes()) == ["Users/dj/mine.mp3"]
    warm = read_crate((subcrates / "Tonalia%%📁 Bolos%%🌅 Warm-up.crate").read_bytes())
    assert [Path(p).name for p in warm] == ["Neon & Cathedral.flac", "01 Midnight Bloom.mp3"]
    assert all(not p.startswith("/") and Path("/" + p).is_file() for p in warm)
    assert read_crate((subcrates / "Tonalia.crate").read_bytes()) == []
    if os.name != "nt":  # readable like Serato's own crates, not private to Tonalia
        assert {(p.stat().st_mode & 0o777) for p in subcrates.glob("Tonalia*")} == {0o644}
    # Serato's order keeps the DJ's crates and lists Tonalia's once, parents first.
    assert neworder(isolated_serato) == [
        "[begin record]",
        "[crate]Serato Demo Tracks",
        "[crate]Mine",
        "[crate]Tonalia",
        "[crate]Tonalia%%📁 Bolos",
        "[crate]Tonalia%%📁 Bolos%%🌅 Warm-up",
        "[crate]Tonalia%%Alta",
        "[end record]",
    ]
    backups = engine_ctx.data_dir / "backups" / "serato"
    assert any((b / "Tonalia%%Gone.crate").is_file() for b in backups.glob("*-Subcrates-Tonalia"))
    assert any((b / "neworder.pref").read_bytes() == SERATO_ORDER for b in backups.glob("*"))


def test_no_serato_folder_or_no_playlists(
    engine_ctx: EngineContext, library: dict[str, int], isolated_serato: Path
) -> None:
    # Serato never ran here: cues still go into the files, no crate folder is made up.
    export(engine_ctx, simulate=False)
    assert not isolated_serato.exists()
    isolated_serato.mkdir(parents=True)
    result = export(engine_ctx, simulate=False, includePlaylists=False)
    assert result["playlists"] == 0
    assert list(isolated_serato.iterdir()) == []


def test_while_serato_runs_only_the_cues_are_written(
    engine_ctx: EngineContext,
    library: dict[str, int],
    isolated_serato: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Serato rewrites its crates when it quits: writing them now would be lost.
    isolated_serato.mkdir(parents=True)
    monkeypatch.setattr(serato_crates, "serato_running", lambda: True)
    result = export(engine_ctx, simulate=False)
    assert result["playlists"] == 0
    assert "app_running" in {w["code"] for w in result["warnings"]}
    assert list(isolated_serato.iterdir()) == []


def test_new_order_file_when_serato_has_none(
    engine_ctx: EngineContext, library: dict[str, int], isolated_serato: Path
) -> None:
    isolated_serato.mkdir(parents=True)
    export(engine_ctx, simulate=False, playlistIds=[2])
    assert neworder(isolated_serato) == [
        "[begin record]",
        "[crate]Tonalia",
        "[crate]Tonalia%%🌅 Warm-up",
        "[end record]",
    ]
