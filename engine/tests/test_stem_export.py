"""Stem export (SPEC 2.16): original or processed, WAV/AIFF/FLAC 24-bit, name template."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any

import numpy as np
import pytest

from tests.test_analysis_queue import call, wait_job
from tests.test_render import add_track, dominant_frequency, needs_rubberband, rpc_error, tone
from tonalia_engine.audio_io import decode, ffmpeg_path
from tonalia_engine.stem_export import file_name, format_bpm, sanitize, unique_path
from tonalia_engine.stems import STEMS, write_flac

SR = 44100
TEMPLATE = "{artist} - {title} ({stem}) [{key} {bpm}]"


# ---- names ----


def test_sanitize_makes_portable_file_names() -> None:
    assert sanitize("AC/DC: Back\\in <Black>?*|") == "AC-DC- Back-in Black"
    assert sanitize("  Música ñ 🎛️ .. ") == "Música ñ 🎛️"
    assert sanitize("CON") == "_CON"
    assert sanitize("lpt1") == "_lpt1"
    assert sanitize("a\x00b\tc") == "a b c"
    assert sanitize("") == "untitled"
    long = sanitize("ñ" * 300)
    assert len(long.encode()) <= 200 and long.startswith("ñ")


def test_format_bpm() -> None:
    assert format_bpm(124.0, 2) == "124"
    assert format_bpm(124.5, 2) == "124.5"
    assert format_bpm(123.456, 2) == "123.46"
    assert format_bpm(123.6, 0) == "124"
    assert format_bpm(None, 2) == ""


def test_file_name_from_the_template() -> None:
    values = {"artist": "Lumen Drift", "title": "Midnight Bloom", "stem": "Vocals",
              "key": "10A", "bpm": "126"}  # fmt: skip
    assert file_name(TEMPLATE, values) == "Lumen Drift - Midnight Bloom (Vocals) [10A 126]"
    # Missing values leave no empty brackets or dangling separators.
    assert file_name(TEMPLATE, {**values, "artist": "", "key": "", "bpm": ""}) == (
        "Midnight Bloom (Vocals)"
    )
    assert file_name("{title} {unknown}", values) == "Midnight Bloom {unknown}"


def test_unique_path_never_reuses_a_name(tmp_path: Path) -> None:
    (tmp_path / "a.wav").write_bytes(b"x")
    taken = {tmp_path / "a (2).wav"}
    assert unique_path(tmp_path, "a", ".wav", taken) == tmp_path / "a (3).wav"
    assert unique_path(tmp_path, "b", ".wav", set()) == tmp_path / "b.wav"
    # Names chosen in the same batch differ even by case (case-insensitive disks).
    assert unique_path(tmp_path, "B", ".wav", {tmp_path / "b.wav"}) == tmp_path / "B (2).wav"


# ---- through RPC ----


def probe(path: Path) -> str:
    proc = subprocess.run(
        [ffmpeg_path(), "-hide_banner", "-i", str(path)], capture_output=True, check=False
    )
    return proc.stderr.decode("utf-8", "replace")


def export(ctx: Any, **params: Any) -> dict[str, Any]:
    finished = wait_job(ctx, call(ctx, "stems.export", params)["jobId"])
    assert finished["status"] == "done", finished
    result: dict[str, Any] = finished["result"]
    return result


def with_tags(ctx: Any, track: int, **fields: Any) -> None:
    sets = ", ".join(f"{k} = ?" for k in fields)
    ctx.db.conn.execute(f"UPDATE tracks SET {sets} WHERE id = ?", (*fields.values(), track))


@needs_rubberband
@pytest.mark.parametrize(
    ("fmt", "codec"), [("wav", "pcm_s24le"), ("aiff", "pcm_s24be"), ("flac", "flac")]
)
def test_exported_plus_two_semitones_is_two_semitones_higher(
    engine_ctx: Any, tmp_path: Path, fmt: str, codec: str
) -> None:
    track = add_track(engine_ctx, tmp_path / "src", "la.flac", tone(440.0, 5.0))
    with_tags(engine_ctx, track, title="Tono La", artist="Prueba")
    engine_ctx.db.conn.execute(
        "INSERT INTO analysis (track_id, key_root, key_mode, bpm) VALUES (?, 9, 'minor', 120)",
        (track,),
    )
    dest = tmp_path / "Proyecto DAW ñ 🎚️"
    result = export(
        engine_ctx,
        items=[{"trackId": track, "source": "mix", "semitones": 2}],
        format=fmt,
        template=TEMPLATE,
        destination=str(dest),
        stemLabels={"mix": "Tema completo"},
    )
    assert result["failed"] == [] and result["folder"] == str(dest)
    path = Path(result["files"][0]["path"])
    # Am + 2 semitones = Bm = 10A; tempo unchanged.
    assert path.name == f"Prueba - Tono La (Tema completo) [10A 120].{fmt}"
    info = probe(path)
    assert codec in info and "44100 Hz" in info and "stereo" in info
    if fmt == "flac":
        assert "(24 bit)" in info
    audio = decode(path, channels=2)
    expected = 440.0 * 2 ** (2 / 12)
    assert dominant_frequency(audio[SR : 4 * SR]) == pytest.approx(expected, rel=0.002)
    assert not list(dest.glob(".*"))  # no temporary files left


def test_exports_original_stems_without_overwriting(engine_ctx: Any, tmp_path: Path) -> None:
    mix = tone(220.0, 2.0)
    track = add_track(engine_ctx, tmp_path / "src", "song.flac", mix)
    with_tags(engine_ctx, track, title="Midnight Bloom", artist="Lumen Drift")
    engine_ctx.db.conn.execute(
        "INSERT INTO analysis (track_id, key_root, key_mode, bpm, beat_grid) "
        "VALUES (?, 0, 'major', 124, ?)",
        (track, json.dumps({"kind": "constant", "bpm": 124, "first_downbeat": 0.0})),
    )
    folder = tmp_path / "stem files"
    folder.mkdir()
    paths = {}
    for i, name in enumerate(STEMS):
        paths[name] = folder / f"{name}.flac"
        write_flac((mix * (0.1 * (i + 1))).astype(np.float32), paths[name])
    file_hash = engine_ctx.db.conn.execute(
        "SELECT file_hash FROM tracks WHERE id = ?", (track,)
    ).fetchone()[0]
    engine_ctx.db.conn.execute(
        "INSERT INTO stems (track_id, model, vocals_path, drums_path, bass_path, other_path,"
        " instrumental_path, source_hash) VALUES (?, 'htdemucs_ft', ?, ?, ?, ?, ?, ?)",
        (track, *(str(paths[n]) for n in STEMS), file_hash),
    )
    dest = tmp_path / "out"
    dest.mkdir()
    existing = dest / "Lumen Drift - Midnight Bloom (Vocals) [8B 124].wav"
    existing.write_bytes(b"user file")
    call(engine_ctx, "settings.set", {"dawFolder": str(dest), "stemExportFormat": "wav"})

    names = call(
        engine_ctx,
        "stems.exportPreview",
        {"items": [{"trackId": track, "source": "vocals"}, {"trackId": track, "source": "bass"}]},
    )
    assert names["folder"] == str(dest)
    assert names["names"] == [
        "Lumen Drift - Midnight Bloom (Vocals) [8B 124] (2).wav",
        "Lumen Drift - Midnight Bloom (Bass) [8B 124].wav",
    ]

    result = export(
        engine_ctx,
        items=[
            {"trackId": track, "source": "vocals"},
            {"trackId": track, "source": "instrumental"},
            {"trackId": 999, "source": "vocals"},
        ],
    )
    assert existing.read_bytes() == b"user file"  # never overwritten
    written = [Path(f["path"]).name for f in result["files"]]
    assert written == [
        "Lumen Drift - Midnight Bloom (Vocals) [8B 124] (2).wav",
        "Lumen Drift - Midnight Bloom (Instrumental) [8B 124].wav",
    ]
    assert [f["trackId"] for f in result["failed"]] == [999]
    vocals = decode(dest / written[0], channels=2)
    np.testing.assert_allclose(vocals, decode(paths["vocals"], channels=2), atol=1e-5)
    assert "pcm_s24le" in probe(dest / written[0])


def test_missing_stems_fail_per_item(engine_ctx: Any, tmp_path: Path) -> None:
    track = add_track(engine_ctx, tmp_path / "src", "solo.flac", tone(220.0, 1.0))
    result = export(
        engine_ctx,
        items=[{"trackId": track, "source": "vocals"}, {"trackId": track, "source": "mix"}],
        destination=str(tmp_path / "dest"),
    )
    assert [f["source"] for f in result["failed"]] == ["vocals"]
    assert "stems" in result["failed"][0]["error"]
    assert Path(result["files"][0]["path"]).name == "solo (Track).wav"


def test_export_needs_a_destination(engine_ctx: Any, tmp_path: Path) -> None:
    track = add_track(engine_ctx, tmp_path / "src", "x.flac", tone(220.0, 1.0))
    error = rpc_error(engine_ctx, "stems.export", {"items": [{"trackId": track}]})
    assert error["code"] == -32602 and "destination" in error["message"]
    error = rpc_error(
        engine_ctx, "stems.export", {"items": [{"trackId": track}], "destination": "relative"}
    )
    assert error["code"] == -32602
    error = rpc_error(engine_ctx, "settings.set", {"dawFolder": "not/absolute"})
    assert error["code"] == -32602
    assert call(engine_ctx, "settings.set", {"dawFolder": ""})["dawFolder"] == ""
