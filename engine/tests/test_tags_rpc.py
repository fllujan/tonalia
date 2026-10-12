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


def _tag(path: Path, title: str, artist: str, comment: str) -> None:
    audio = mutagen.File(path)
    if audio.tags is None:
        audio.add_tags()
    if type(audio).__name__ == "MP4":
        audio.tags.update({"\xa9nam": [title], "\xa9ART": [artist], "\xa9cmt": [comment]})
    elif hasattr(audio.tags, "getall"):
        from mutagen.id3 import COMM, TPE1

        audio.tags.add(TIT2(encoding=3, text=title))
        audio.tags.add(TPE1(encoding=3, text=artist))
        audio.tags.add(COMM(encoding=3, lang="eng", desc="", text=comment))
    else:
        audio.tags.update({"title": [title], "artist": [artist], "comment": [comment]})
    audio.save()


def test_clean_preview_write_and_undo(
    ctx: EngineContext, library: dict[str, tuple[int, Path]]
) -> None:
    for _, path in library.values():
        _tag(
            path,
            "01 - MIDNIGHT  BLOOM [Free Download]",
            "Lumen Drift ft Ines Halo",
            "www.promo.com",
        )
    # Re-read the new tags into the library before cleaning.
    folder = next(iter(library.values()))[1].parent
    wait_job(
        ctx, call(ctx, "library.addPaths", {"paths": [str(folder)], "analyze": False})["jobId"]
    )
    originals = {fmt: p.read_bytes() for fmt, (_, p) in library.items()}
    ids = [tid for tid, _ in library.values()]

    preview = call(ctx, "tags.cleanPreview", {"trackIds": ids})["items"]
    changes = {c["field"]: c for c in preview[0]["changes"]}
    assert changes["title"]["after"] == "Midnight Bloom (feat. Ines Halo)"
    assert changes["artist"]["after"] == "Lumen Drift"
    assert changes["comment"]["after"] == ""

    result = wait_job(ctx, call(ctx, "tags.clean", {"trackIds": ids})["jobId"])["result"]
    assert result["written"] == len(ids) and result["failed"] == []
    for fmt, (tid, path) in library.items():
        meta = read_metadata(path)
        assert (meta.title, meta.artist, meta.comment) == (
            "Midnight Bloom (feat. Ines Halo)",
            "Lumen Drift",
            None,
        ), fmt
        detail = call(ctx, "library.get", {"trackId": tid})
        assert (
            detail["title"] == "Midnight Bloom (feat. Ines Halo)"
            and detail["artist"] == "Lumen Drift"
        )
    assert call(ctx, "library.list", {"search": "ines halo midnight"})["total"] == len(ids)

    undo = wait_job(ctx, call(ctx, "tags.undo", {"batchId": result["batchId"]})["jobId"])["result"]
    assert undo["restored"] == len(ids)
    assert {fmt: p.read_bytes() for fmt, (_, p) in library.items()} == originals
    assert call(ctx, "library.get", {"trackId": ids[0]})["artist"] == "Lumen Drift ft Ines Halo"


def test_mass_edit_any_field(ctx: EngineContext, library: dict[str, tuple[int, Path]]) -> None:
    ids = [tid for tid, _ in library.values()]
    values = {"genre": "Melodic House", "album": "Warm-up Ibiza 🌅", "year": "2026"}
    preview = call(ctx, "tags.editPreview", {"trackIds": ids, "values": values})["items"]
    assert {c["field"] for c in preview[0]["changes"]} == {"genre", "album", "year"}
    result = wait_job(ctx, call(ctx, "tags.edit", {"trackIds": ids, "values": values})["jobId"])[
        "result"
    ]
    assert result["written"] == len(ids)
    for fmt, (tid, path) in library.items():
        meta = read_metadata(path)
        assert (meta.genre, meta.album, meta.year) == ("Melodic House", "Warm-up Ibiza 🌅", 2026), (
            fmt
        )
        assert call(ctx, "library.get", {"trackId": tid})["genre"] == "Melodic House"
    assert (
        call_error(ctx, "tags.edit", {"trackIds": ids, "values": {"key": "8A"}})["code"] == -32602
    )


def test_history_lists_batches_and_survives_undo(
    ctx: EngineContext, library: dict[str, tuple[int, Path]]
) -> None:
    """Every write stays findable and undoable after its toast is gone (SPEC 2.9)."""
    ids = [tid for tid, _ in library.values()]
    results = wait_job(ctx, call(ctx, "tags.write", {"trackIds": ids})["jobId"])["result"]
    first_id = ids[0]
    edit = wait_job(
        ctx,
        call(ctx, "tags.edit", {"trackIds": [first_id], "values": {"genre": "Deep House"}})[
            "jobId"
        ],
    )["result"]
    # Writing the same results again changes nothing: no empty batch in the history.
    wait_job(ctx, call(ctx, "tags.write", {"trackIds": ids})["jobId"])

    items = call(ctx, "tags.history", {})["items"]
    assert [i["batchId"] for i in items] == [edit["batchId"], results["batchId"]]
    newest, older = items
    assert newest["kind"] == "edit" and newest["written"] == 1 and newest["undoable"] == 1
    assert newest["fields"] == ["genre"] and newest["undoneAt"] is None
    assert len(newest["titles"]) == 1
    assert older["kind"] == "results" and older["written"] == len(ids)
    assert {"key", "bpm", "comment"} <= set(older["fields"])
    assert 1 <= len(older["titles"]) <= 3
    assert newest["createdAt"] >= older["createdAt"]

    # Undo newest first: the edit touched a file after the results batch did.
    wait_job(ctx, call(ctx, "tags.undo", {"batchId": edit["batchId"]})["jobId"])
    wait_job(ctx, call(ctx, "tags.undo", {"batchId": results["batchId"]})["jobId"])
    undone = next(i for i in call(ctx, "tags.history", {})["items"] if i["kind"] == "results")
    assert undone["undoneAt"] is not None and undone["undoable"] == 0
    # The summary is kept with the batch, so it still says what was written.
    assert {"key", "bpm", "comment"} <= set(undone["fields"]) and undone["titles"]

    assert len(call(ctx, "tags.history", {"limit": 1})["items"]) == 1
    assert call_error(ctx, "tags.history", {"limit": 0})["code"] == -32602
