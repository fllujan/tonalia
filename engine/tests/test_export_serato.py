"""Serato Markers2 (SPEC 2.12): binary codec, file storage and round trips."""

import base64
import shutil
import struct
from pathlib import Path
from typing import Any

import pytest

from tests.fixtures.generate import make_all
from tests.test_analysis_queue import call, wait_job
from tonalia_engine.export.serato_markers import (
    SERATO_FORMATS,
    CueMarker,
    Entry,
    decode_geob,
    decode_vorbis,
    encode_geob,
    encode_vorbis,
    merge_cues,
    nearest_color,
    parse_cue,
    read_entries,
    write_entries,
)
from tonalia_engine.server import EngineContext

# The documented example payload: COLOR white + BPMLOCK unlocked.
SAMPLE = (
    b"\x01\x01"
    + b"COLOR\x00" + struct.pack(">I", 4) + b"\x00\xff\xff\xff"
    + b"BPMLOCK\x00" + struct.pack(">I", 1) + b"\x00"
    + b"\x00"
)  # fmt: skip


def cue_bytes(index: int, ms: int, rgb: bytes, name: str) -> bytes:
    return (
        b"\x00"
        + struct.pack(">BI", index, ms)
        + b"\x00"
        + rgb
        + b"\x00\x00"
        + name.encode()
        + b"\x00"
    )


# ---- codec ----


def test_decodes_the_documented_example() -> None:
    body = base64.b64encode(SAMPLE).rstrip(b"=")
    geob = b"\x01\x01" + body + b"\x00" * (470 - 2 - len(body))
    entries = decode_geob(geob)
    assert entries == [Entry("COLOR", b"\x00\xff\xff\xff"), Entry("BPMLOCK", b"\x00")]
    assert encode_geob(entries) == geob


def test_tolerates_serato_quirks() -> None:
    # Line breaks every 72 base64 characters and a body one byte too long for base64.
    payload = (
        SAMPLE[:-1]
        + b"".join(
            b"CUE\x00"
            + struct.pack(">I", len(cue_bytes(i, 1000 * i, b"\xcc\x00\x00", "Hot cue")))
            + cue_bytes(i, 1000 * i, b"\xcc\x00\x00", "Hot cue")
            for i in range(6)
        )
        + b"\x00"
    )
    body = base64.b64encode(payload).rstrip(b"=")
    if len(body) % 4 != 1:
        body += b"A"
    wrapped = b"\n".join(body[i : i + 72] for i in range(0, len(body), 72))
    entries = decode_geob(b"\x01\x01" + wrapped + b"\x00" * 10)
    cues = [parse_cue(e) for e in entries if e.name == "CUE"]
    assert [(c.index, c.position_ms, c.color, c.name) for c in cues][:2] == [
        (0, 0, "#CC0000", "Hot cue"),
        (1, 1000, "#CC0000", "Hot cue"),
    ]


def test_long_payloads_are_wrapped_and_at_least_470_bytes() -> None:
    entries = [Entry("COLOR", b"\x00\xff\xff\xff")]
    short = encode_geob(entries)
    assert len(short) == 470 and short.endswith(b"\x00")
    many = [CueMarker(i % 8, i * 1000, "#CC0000", "x" * 40).entry() for i in range(20)]
    long = encode_geob(many)
    body = long[2:].rstrip(b"\x00")
    assert all(len(line) <= 72 for line in body.split(b"\n"))
    assert decode_geob(long) == many


def test_cue_entry_layout_and_names() -> None:
    cue = CueMarker(3, 31234, "#FF5F8A", "Drop ñ")
    assert cue.entry().data == cue_bytes(3, 31234, b"\xff\x5f\x8a", "Drop ñ")
    assert parse_cue(cue.entry()) == cue
    # Names are capped to Serato's limit without splitting a UTF-8 character.
    long = CueMarker(0, 0, "#CC0000", "ñ" * 40).entry()
    name = long.data[12:-1]
    assert len(name) <= 50 and name.decode("utf-8")


def test_vorbis_and_mp4_wrapper() -> None:
    geob = encode_geob([Entry("COLOR", b"\x00\xff\xff\xff")])
    text = encode_vorbis(geob)
    assert "=" not in text and all(len(line) <= 72 for line in text.split("\n"))
    raw = base64.b64decode(text.replace("\n", "") + "==")
    assert raw.startswith(b"application/octet-stream\x00\x00Serato Markers2\x00")
    assert decode_vorbis(text) == geob


def test_merge_keeps_loops_and_other_slots_and_snaps_colours() -> None:
    loop = Entry("LOOP", b"\x00" * 21 + b"Loop\x00")
    existing = [
        Entry("COLOR", b"\x00\x99\xff\x99"),
        CueMarker(1, 5000, "#CC8800", "Old").entry(),
        CueMarker(5, 9000, "#0044CC", "Mine").entry(),
        loop,
        Entry("BPMLOCK", b"\x01"),
    ]
    merged = merge_cues(
        existing, [CueMarker(1, 7000, "#FF5F8A", "Drop"), CueMarker(0, 0, "#4CC3FF", "Intro")]
    )
    assert [e.name for e in merged] == ["COLOR", "CUE", "CUE", "CUE", "LOOP", "BPMLOCK"]
    cues = [parse_cue(e) for e in merged if e.name == "CUE"]
    assert [(c.index, c.position_ms, c.name) for c in cues] == [
        (0, 0, "Intro"), (1, 7000, "Drop"), (5, 9000, "Mine"),
    ]  # fmt: skip
    assert merged[0].data == b"\x00\x99\xff\x99" and merged[-1].data == b"\x01"
    # Without an existing tag Serato's defaults are created.
    fresh = merge_cues([], [CueMarker(0, 0, "#4CC3FF", "Intro")])
    assert [e.name for e in fresh] == ["COLOR", "CUE", "BPMLOCK"]
    assert nearest_color("#FF5F8A") in {"#CC0044", "#CC0088", "#CC0000"}
    assert nearest_color("#CC0000") == "#CC0000"


# ---- files ----


@pytest.fixture(scope="module")
def originals(tmp_path_factory: pytest.TempPathFactory) -> dict[str, Path]:
    return make_all(tmp_path_factory.mktemp("serato ñ 🎧"))


@pytest.mark.parametrize("fmt", sorted(SERATO_FORMATS))
def test_file_round_trip(originals: dict[str, Path], tmp_path: Path, fmt: str) -> None:
    path = tmp_path / originals[fmt].name
    shutil.copy2(originals[fmt], path)
    assert read_entries(path) == []
    entries = merge_cues(
        [], [CueMarker(0, 250, "#4CC3FF", "Intro"), CueMarker(2, 31234, "#FF5F8A", "Drop")]
    )
    write_entries(path, entries)
    assert read_entries(path) == entries
    first = path.read_bytes()
    write_entries(path, read_entries(path))  # read → write → read is identical
    assert read_entries(path) == entries
    assert path.read_bytes() == first


# ---- through the engine ----


def add_track(ctx: EngineContext, path: Path, cues: list[tuple[int, float, str, str]]) -> int:
    conn = ctx.db.conn
    cur = conn.execute(
        "INSERT INTO tracks (path, title, format, status, display_title, search_text, size, mtime)"
        " VALUES (?, ?, ?, 'ready', ?, '', ?, ?)",
        (str(path), path.stem, path.suffix.lstrip("."), path.stem, path.stat().st_size,
         path.stat().st_mtime),
    )  # fmt: skip
    tid = int(cur.lastrowid or 0)
    conn.execute(
        "INSERT INTO analysis (track_id, key_root, key_mode, bpm) VALUES (?, 9, 'minor', 124)",
        (tid,),
    )
    for slot, pos, label, color in cues:
        conn.execute(
            "INSERT INTO cues (track_id, slot, position_sec, label, color, source)"
            " VALUES (?, ?, ?, ?, ?, 'auto')",
            (tid, slot, pos, label, color),
        )
    return tid


def export(ctx: EngineContext, **options: Any) -> dict[str, Any]:
    finished = wait_job(ctx, call(ctx, "export.serato", options)["jobId"])
    assert finished["status"] == "done", finished
    result: dict[str, Any] = finished["result"]
    return result


def test_export_writes_markers_and_tags_undo_restores_bytes(
    engine_ctx: EngineContext, originals: dict[str, Path], tmp_path: Path
) -> None:
    folder = tmp_path / "Serato 🎛️"
    folder.mkdir()
    ids = {}
    for fmt in ("mp3", "flac", "m4a", "aiff", "wav", "ogg"):
        path = folder / originals[fmt].name
        shutil.copy2(originals[fmt], path)
        ids[fmt] = add_track(
            engine_ctx, path, [(0, 0.25, "intro", "#4CC3FF"), (1, 31.234, "drop", "#FF5F8A")]
        )
    before = {fmt: Path(folder / originals[fmt].name).read_bytes() for fmt in ids}

    simulated = export(engine_ctx)
    assert simulated["simulated"] is True and simulated["target"] == "serato"
    assert (simulated["tracks"], simulated["cues"], simulated["skipped"]) == (4, 8, 2)
    assert {w["code"] for w in simulated["warnings"]} == {"unsupported_format"}
    assert all((folder / originals[f].name).read_bytes() == before[f] for f in ids)

    result = export(engine_ctx, simulate=False, language="es")
    assert result["batchId"]
    for fmt in ("mp3", "flac", "m4a", "aiff"):
        cues = [parse_cue(e) for e in read_entries(folder / originals[fmt].name) if e.name == "CUE"]
        assert [(c.index, c.position_ms, c.name) for c in cues] == [
            (0, 250, "Intro"),
            (1, 31234, "Drop"),
        ]
    # A second export changes nothing, and says so: the cues are in place, untouched.
    again = export(engine_ctx, simulate=False)
    assert (again["tracks"], again["cues"], again["batchId"]) == (4, 8, None)
    assert {i["action"] for i in again["items"]} == {"unchanged"}

    undone = wait_job(
        engine_ctx, call(engine_ctx, "tags.undo", {"batchId": result["batchId"]})["jobId"]
    )
    assert undone["status"] == "done" and undone["result"]["restored"] == 4
    assert all((folder / originals[f].name).read_bytes() == before[f] for f in ids)
