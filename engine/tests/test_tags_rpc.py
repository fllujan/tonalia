"""tags.preview / tags.write / tags.undo through RPC (SPEC 2.9 and phase 4 acceptance)."""

from pathlib import Path

import mutagen
import pytest
from mutagen.id3 import TIT2

from tests.fixtures.generate import make_all
from tests.test_analysis_queue import call, ctx, import_folder, wait_job
from tests.test_track_update import call_error
from tonalia_engine.metadata import read_metadata
from tonalia_engine.server import EngineContext

__all__ = ["ctx"]


@pytest.fixture
def library(ctx: EngineContext, tmp_path: Path) -> dict[str, tuple[int, Path]]:
    folder = tmp_path / "Mis temas 🎧"
    files = make_all(folder, stem="tema ñ")
    (folder / "tema ñ.source.wav").unlink()
    import_folder(ctx, folder)
    out = {}
    for fmt, path in files.items():
        page = call(ctx, "library.list", {"search": path.name})
        tid = next(i["id"] for i in page["items"] if i["path"] == str(path))
        call(
            ctx,
            "track.update",
            {"trackId": tid, "key": {"root": 9, "mode": "minor"}, "bpm": 124.0, "energy": 7},
        )
        out[fmt] = (tid, path)
    return out


def test_preview_does_not_touch_files(
    ctx: EngineContext, library: dict[str, tuple[int, Path]]
) -> None:
    before = {fmt: p.read_bytes() for fmt, (_, p) in library.items()}
    ids = [tid for tid, _ in library.values()]
    preview = call(ctx, "tags.preview", {"trackIds": ids})
    assert len(preview["items"]) == len(ids)
    first = preview["items"][0]
    fields = {c["field"]: c for c in first["changes"]}
    assert fields["key"]["after"] == "8A" and fields["comment"]["after"] == "8A - Energy 7"
    assert {fmt: p.read_bytes() for fmt, (_, p) in library.items()} == before


def test_write_then_undo_restores_every_file(
    ctx: EngineContext, library: dict[str, tuple[int, Path]]
) -> None:
    originals = {fmt: p.read_bytes() for fmt, (_, p) in library.items()}
    ids = [tid for tid, _ in library.values()]
    job = call(ctx, "tags.write", {"trackIds": ids, "options": {"notation": "classical"}})
    result = wait_job(ctx, job["jobId"])["result"]
    assert result["written"] == len(ids) and result["failed"] == []
    batch = result["batchId"]
    for fmt, (tid, path) in library.items():
        assert read_metadata(path).key_tag == "Am", fmt
        detail = call(ctx, "library.get", {"trackId": tid})
        assert detail["comment"] == "Am - Energy 7"
        assert detail["status"] == "pending"  # not flagged for reanalysis by the write
    # Re-importing sees the files as unchanged (size, mtime and hash were updated).
    rescan = wait_job(
        ctx,
        call(
            ctx,
            "library.addPaths",
            {"paths": [str(next(iter(library.values()))[1].parent)], "analyze": False},
        )["jobId"],
    )
    assert rescan["result"]["updated"] == 0

    undo = wait_job(ctx, call(ctx, "tags.undo", {"batchId": batch})["jobId"])["result"]
    assert undo["restored"] == len(ids) and undo["skipped"] == []
    assert {fmt: p.read_bytes() for fmt, (_, p) in library.items()} == originals
    assert call(ctx, "library.get", {"trackId": ids[0]})["comment"] is None
    # A batch can only be undone once.
    again = wait_job(ctx, call(ctx, "tags.undo", {"batchId": batch})["jobId"])["result"]
    assert again["restored"] == 0


def test_undo_skips_files_changed_since(
    ctx: EngineContext, library: dict[str, tuple[int, Path]]
) -> None:
    tid, path = library["mp3"]
    batch = wait_job(ctx, call(ctx, "tags.write", {"trackIds": [tid]})["jobId"])["result"][
        "batchId"
    ]
    audio = mutagen.File(path)
    audio.tags.add(TIT2(encoding=3, text="Edited in another app"))
    audio.save()
    edited = path.read_bytes()
    undo = wait_job(ctx, call(ctx, "tags.undo", {"batchId": batch})["jobId"])["result"]
    assert undo["restored"] == 0 and len(undo["skipped"]) == 1
    assert path.read_bytes() == edited


def test_default_template_comes_from_settings(
    ctx: EngineContext, library: dict[str, tuple[int, Path]]
) -> None:
    tid, _ = library["flac"]
    call(
        ctx,
        "settings.set",
        {
            "tagOptions": {"commentTemplate": "{bpm} · {key}", "commentPosition": "replace"},
            "bpmDecimals": 0,
        },
    )
    item = call(ctx, "tags.preview", {"trackIds": [tid]})["items"][0]
    comment = next(c for c in item["changes"] if c["field"] == "comment")
    assert comment["after"] == "124 · 8A"


def test_validation(ctx: EngineContext) -> None:
    assert call_error(ctx, "tags.preview", {"trackIds": []})["code"] == -32602
    bad = {"trackIds": [1], "options": {"commentPosition": "middle"}}
    assert call_error(ctx, "tags.write", bad)["code"] == -32602
    assert call_error(ctx, "tags.undo", {"batchId": "nope"})["code"] == -32602
